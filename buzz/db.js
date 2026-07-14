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
