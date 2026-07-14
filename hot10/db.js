// hot10(buzzAnalysis) 전용 DB — data/hot10.db (src/db.js·buzz/db.js와 완전 분리, 격리 원칙 §1)
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';
import { mkdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, '..', 'data', 'hot10.db');

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
// initDB — 스키마 정의 (docs/hot10-design.md §3)
// ---------------------------------------------------------------------------
export function initDB() {
  const d = getDB();

  d.exec(`
    CREATE TABLE IF NOT EXISTS hot10_raw (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      region TEXT NOT NULL,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      best_rank INTEGER NOT NULL,
      traffic_hint TEXT,
      url TEXT,
      collected_date TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      seen_count INTEGER DEFAULT 1,
      last_round_bucket TEXT,
      UNIQUE(region, source, collected_date, title)
    );

    CREATE TABLE IF NOT EXISTS hot10_topics (
      region TEXT NOT NULL,
      date TEXT NOT NULL,
      rank INTEGER NOT NULL,
      topic TEXT NOT NULL,
      category TEXT,
      reason TEXT,
      sources TEXT DEFAULT '[]',
      score REAL,
      url TEXT,
      PRIMARY KEY (region, date, rank)
    );

    CREATE TABLE IF NOT EXISTS hot10_topic_history (
      region TEXT NOT NULL,
      topic_key TEXT NOT NULL,
      date TEXT NOT NULL,
      in_top10 INTEGER DEFAULT 0,
      PRIMARY KEY (region, topic_key, date)
    );

    CREATE INDEX IF NOT EXISTS idx_hr_region_date ON hot10_raw(region, collected_date);
    CREATE INDEX IF NOT EXISTS idx_ht_region_date ON hot10_topics(region, date);
    CREATE INDEX IF NOT EXISTS idx_hth_region_topic ON hot10_topic_history(region, topic_key);
  `);

  return d;
}

// ---------------------------------------------------------------------------
// hot10_raw — STEP C1~C2 수집 (docs/hot10-design.md §3, §6 HT-1)
// ---------------------------------------------------------------------------
// 6시간 라운드 버킷 — 하루 4회 수집(KST 12/18/24/06시)이 같은 버킷 안에서 재실행돼도
// seen_count가 부풀지 않도록 UTC epoch 기준 6시간 단위로 절사한다(타임존 이슈 회피).
function roundBucket(now) {
  const sixHoursMs = 6 * 60 * 60 * 1000;
  return String(Math.floor(now.getTime() / sixHoursMs));
}

// 같은 (region,source,date,title) 재관측 시 best_rank=min으로 갱신하고, 새 라운드일 때만
// seen_count를 올린다(당일 지속성 지표의 원천 — docs/hot10-design.md §4.3).
// now는 테스트에서 라운드를 결정론적으로 시뮬레이션하기 위한 오버라이드(기본 실제 시각).
export function upsertRawTopic({ region, source, title, rank, trafficHint = null, url = null, now = new Date() }) {
  const d = getDB();
  const nowIso = now.toISOString();
  const date = nowIso.slice(0, 10);
  const bucket = roundBucket(now);

  const existing = d.prepare(`
    SELECT best_rank, seen_count, last_round_bucket FROM hot10_raw
    WHERE region = ? AND source = ? AND collected_date = ? AND title = ?
  `).get(region, source, date, title);

  if (!existing) {
    d.prepare(`
      INSERT INTO hot10_raw
        (region, source, title, best_rank, traffic_hint, url, collected_date, first_seen_at, last_seen_at, seen_count, last_round_bucket)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(region, source, title, rank, trafficHint, url, date, nowIso, nowIso, bucket);
    return;
  }

  const bestRank = Math.min(existing.best_rank, rank);
  const sameRound = existing.last_round_bucket === bucket;
  const seenCount = sameRound ? existing.seen_count : existing.seen_count + 1;

  d.prepare(`
    UPDATE hot10_raw
    SET best_rank = ?, traffic_hint = ?, url = ?, last_seen_at = ?, seen_count = ?, last_round_bucket = ?
    WHERE region = ? AND source = ? AND collected_date = ? AND title = ?
  `).run(bestRank, trafficHint, url, nowIso, seenCount, bucket, region, source, date, title);
}

export function getRawTopicsForDate(region, date) {
  const d = getDB();
  const rows = d.prepare(`
    SELECT source, title, best_rank, traffic_hint, url, seen_count, first_seen_at, last_seen_at
    FROM hot10_raw WHERE region = ? AND collected_date = ?
    ORDER BY source, best_rank ASC
  `).all(region, date);

  return rows.map((r) => ({
    source: r.source,
    title: r.title,
    bestRank: r.best_rank,
    trafficHint: r.traffic_hint,
    url: r.url,
    seenCount: r.seen_count,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
  }));
}

export function getRawTopic(region, source, date, title) {
  const d = getDB();
  const r = d.prepare(`
    SELECT best_rank, seen_count, last_round_bucket FROM hot10_raw
    WHERE region = ? AND source = ? AND collected_date = ? AND title = ?
  `).get(region, source, date, title);
  return r ? { bestRank: r.best_rank, seenCount: r.seen_count, lastRoundBucket: r.last_round_bucket } : null;
}
