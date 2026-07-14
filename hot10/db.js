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
