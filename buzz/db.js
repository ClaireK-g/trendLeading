// buzzAnalysis 전용 DB — data/buzz.db (src/db.js·data/trend.db와 완전 분리, 격리 원칙 §1)
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';
import { mkdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, '..', 'data', 'buzz.db');

mkdirSync(path.dirname(DB_PATH), { recursive: true });

let db;

export function getDB() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

// ---------------------------------------------------------------------------
// initDB — 스키마 정의 (docs/buzz-analysis-design.md §3)
// ---------------------------------------------------------------------------
export function initDB() {
  const d = getDB();

  d.exec(`
    CREATE TABLE IF NOT EXISTS buzz_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target TEXT NOT NULL,
      channel TEXT NOT NULL,
      url TEXT NOT NULL,
      title TEXT,
      description TEXT,
      published_at TEXT,
      collected_at TEXT NOT NULL,
      is_noise INTEGER DEFAULT 0,
      noise_reason TEXT,
      sentiment TEXT,
      UNIQUE(target, url)
    );

    CREATE TABLE IF NOT EXISTS buzz_daily_stats (
      target TEXT NOT NULL,
      date TEXT NOT NULL,
      channel TEXT NOT NULL,
      volume INTEGER DEFAULT 0,
      total_hint INTEGER,
      pos_count INTEGER DEFAULT 0,
      neg_count INTEGER DEFAULT 0,
      neu_count INTEGER DEFAULT 0,
      PRIMARY KEY (target, date, channel)
    );

    CREATE TABLE IF NOT EXISTS buzz_assoc_words (
      target TEXT NOT NULL,
      date TEXT NOT NULL,
      word TEXT NOT NULL,
      count INTEGER DEFAULT 0,
      PRIMARY KEY (target, date, word)
    );

    CREATE TABLE IF NOT EXISTS buzz_spikes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target TEXT NOT NULL,
      date TEXT NOT NULL,
      ratio REAL,
      trigger_urls TEXT,
      trigger_summary TEXT,
      UNIQUE(target, date)
    );

    CREATE INDEX IF NOT EXISTS idx_bp_target_collected ON buzz_posts(target, collected_at);
    CREATE INDEX IF NOT EXISTS idx_bp_target_published ON buzz_posts(target, published_at);
    CREATE INDEX IF NOT EXISTS idx_bds_target_date ON buzz_daily_stats(target, date);
    CREATE INDEX IF NOT EXISTS idx_baw_target_date ON buzz_assoc_words(target, date);
  `);

  return d;
}

// ---------------------------------------------------------------------------
// buzz_posts
// ---------------------------------------------------------------------------
// 크로스데이 URL dedup — UNIQUE(target,url) 위반 시 조용히 무시(INSERT OR IGNORE),
// 신규 삽입 여부를 반환해 당일 volume 집계에 사용한다.
export function insertBuzzPost(post) {
  const d = getDB();
  const info = d.prepare(`
    INSERT OR IGNORE INTO buzz_posts (target, channel, url, title, description, published_at, collected_at)
    VALUES (@target, @channel, @url, @title, @description, @published_at, @collected_at)
  `).run({
    target: post.target,
    channel: post.channel,
    url: post.url,
    title: post.title ?? null,
    description: post.description ?? null,
    published_at: post.publishedAt ?? null,
    collected_at: post.collectedAt ?? new Date().toISOString(),
  });
  return info.changes > 0;
}

// ---------------------------------------------------------------------------
// buzz_daily_stats
// ---------------------------------------------------------------------------
// 파이프라인은 하루 1회 실행되므로 누적(+=)이 아니라 당일 최종값으로 덮어쓴다(재실행 시 멱등).
export function upsertDailyStat({ target, date, channel, volume = 0, totalHint = null }) {
  const d = getDB();
  d.prepare(`
    INSERT INTO buzz_daily_stats (target, date, channel, volume, total_hint)
    VALUES (@target, @date, @channel, @volume, @total_hint)
    ON CONFLICT(target, date, channel) DO UPDATE SET
      volume = @volume,
      total_hint = @total_hint
  `).run({ target, date, channel, volume, total_hint: totalHint });
}

export function getDailyStatsForTarget(target, days = 14) {
  const d = getDB();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const rows = d.prepare(`
    SELECT date, channel, volume, total_hint, pos_count, neg_count, neu_count
    FROM buzz_daily_stats
    WHERE target = ? AND date >= ?
    ORDER BY date ASC
  `).all(target, cutoffStr);

  return rows.map(r => ({
    date: r.date,
    channel: r.channel,
    volume: r.volume,
    totalHint: r.total_hint,
    posCount: r.pos_count,
    negCount: r.neg_count,
    neuCount: r.neu_count,
  }));
}

// STEP 3(cleaner.js) 정제 후 채널별 클린/노이즈 게시물 수 — buzz_posts가 진실 원천(source of truth)
export function getPostChannelCounts(targetId, date) {
  const d = getDB();
  const rows = d.prepare(`
    SELECT channel,
           SUM(CASE WHEN is_noise = 0 THEN 1 ELSE 0 END) as clean_count,
           SUM(CASE WHEN is_noise = 1 THEN 1 ELSE 0 END) as noise_count
    FROM buzz_posts
    WHERE target = ? AND (published_at = ? OR (published_at IS NULL AND collected_at LIKE ?))
    GROUP BY channel
  `).all(targetId, date, `${date}%`);
  return rows.map((r) => ({ channel: r.channel, cleanCount: r.clean_count, noiseCount: r.noise_count }));
}

export function getNoiseCountForDate(targetId, date) {
  const d = getDB();
  const row = d.prepare(`
    SELECT COUNT(*) as cnt FROM buzz_posts
    WHERE target = ? AND is_noise = 1 AND (published_at = ? OR (published_at IS NULL AND collected_at LIKE ?))
  `).get(targetId, date, `${date}%`);
  return row?.cnt ?? 0;
}

// 정제 후 클린 volume으로 덮어쓴다(total_hint 등 나머지 컬럼은 건드리지 않는 타깃 UPDATE —
// src/db.js setSearchability()와 동일 패턴).
export function updateCleanVolume(target, date, channel, volume) {
  const d = getDB();
  d.prepare(`
    UPDATE buzz_daily_stats SET volume = ? WHERE target = ? AND date = ? AND channel = ?
  `).run(volume, target, date, channel);
}

export function getPostByUrl(targetId, url) {
  const d = getDB();
  return d.prepare('SELECT * FROM buzz_posts WHERE target = ? AND url = ?').get(targetId, url) || null;
}

// ---------------------------------------------------------------------------
// 감성(STEP 4 analyzer.js)
// ---------------------------------------------------------------------------
export function setPostSentiment(id, sentiment) {
  const d = getDB();
  d.prepare('UPDATE buzz_posts SET sentiment = ? WHERE id = ?').run(sentiment, id);
}

// STEP 2가 미리 만들어둔 (target,date,channel) 행이 있어야 반영된다(없으면 조용히 무시 — fail-open,
// src/db.js setSearchability()와 동일 순서 의존성).
export function updateSentimentCounts(target, date, channel, { pos = 0, neg = 0, neu = 0 } = {}) {
  const d = getDB();
  d.prepare(`
    UPDATE buzz_daily_stats SET pos_count = ?, neg_count = ?, neu_count = ?
    WHERE target = ? AND date = ? AND channel = ?
  `).run(pos, neg, neu, target, date, channel);
}

// 리스크 감지 시 리포트에 붙일 대표 부정 게시물 1건
export function getRepresentativeNegativePost(targetId, date) {
  const d = getDB();
  const row = d.prepare(`
    SELECT url, title FROM buzz_posts
    WHERE target = ? AND sentiment = 'negative' AND is_noise = 0
      AND (published_at = ? OR (published_at IS NULL AND collected_at LIKE ?))
    ORDER BY collected_at DESC LIMIT 1
  `).get(targetId, date, `${date}%`);
  return row || null;
}

// ---------------------------------------------------------------------------
// buzz_assoc_words (STEP 4 analyzer.js — 연관어)
// ---------------------------------------------------------------------------
export function upsertAssocWord(target, date, word, count) {
  const d = getDB();
  d.prepare(`
    INSERT INTO buzz_assoc_words (target, date, word, count)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(target, date, word) DO UPDATE SET count = excluded.count
  `).run(target, date, word, count);
}

export function getAssocWordsForDate(targetId, date, limit = 15) {
  const d = getDB();
  return d.prepare(`
    SELECT word, count FROM buzz_assoc_words WHERE target = ? AND date = ? ORDER BY count DESC LIMIT ?
  `).all(targetId, date, limit);
}

// [startDate, endDate) 범위의 날짜별 count를 단어별로 합산해 상위 N개 단어 집합을 반환 —
// "직전 7일 톱10" 기준선(신규 진입어 판정용)
export function getTopAssocWordsInRange(targetId, startDate, endDate, limit = 10) {
  const d = getDB();
  const rows = d.prepare(`
    SELECT word, SUM(count) as total FROM buzz_assoc_words
    WHERE target = ? AND date >= ? AND date < ?
    GROUP BY word ORDER BY total DESC LIMIT ?
  `).all(targetId, startDate, endDate, limit);
  return new Set(rows.map((r) => r.word));
}

// ---------------------------------------------------------------------------
// buzz_spikes (STEP 5 — 스파이크 감지 + 트리거 역추적)
// ---------------------------------------------------------------------------
// UNIQUE(target,date) 위반 시 조용히 무시 — 같은 날 재실행 시 중복 저장/재알림 방지(쿨다운 역할).
export function insertSpike({ target, date, ratio, triggerUrls, triggerSummary }) {
  const d = getDB();
  const info = d.prepare(`
    INSERT OR IGNORE INTO buzz_spikes (target, date, ratio, trigger_urls, trigger_summary)
    VALUES (?, ?, ?, ?, ?)
  `).run(target, date, ratio ?? null, JSON.stringify(triggerUrls || []), triggerSummary || null);
  return info.changes > 0;
}

export function getSpikeForDate(targetId, date) {
  const d = getDB();
  const row = d.prepare('SELECT * FROM buzz_spikes WHERE target = ? AND date = ?').get(targetId, date);
  if (!row) return null;
  return {
    ratio: row.ratio,
    triggerUrls: JSON.parse(row.trigger_urls || '[]'),
    triggerSummary: row.trigger_summary,
  };
}

// ---------------------------------------------------------------------------
// 데이터 보존 — buzz_posts는 90일 경과분 정리(DB 비대화 방지). 지표 테이블
// (buzz_daily_stats/buzz_assoc_words/buzz_spikes)은 영구 보존 (docs/buzz-analysis-design.md §4 BZ-7)
// ---------------------------------------------------------------------------
export function pruneOldPosts(days = 90) {
  const d = getDB();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const info = d.prepare('DELETE FROM buzz_posts WHERE collected_at < ?').run(cutoff.toISOString());
  return info.changes;
}
