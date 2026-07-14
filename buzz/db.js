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
