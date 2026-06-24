import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';
import { mkdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, '..', 'data', 'trend.db');

mkdirSync(path.dirname(DB_PATH), { recursive: true });

let db;

function getDB() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

// ---------------------------------------------------------------------------
// initDB
// ---------------------------------------------------------------------------
export function initDB() {
  const d = getDB();

  d.exec(`
    CREATE TABLE IF NOT EXISTS raw_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account TEXT NOT NULL,
      caption TEXT,
      comments_text TEXT,
      collected_at TEXT NOT NULL,
      source_url TEXT,
      source TEXT DEFAULT 'unknown',
      collect_date TEXT
    );

    CREATE TABLE IF NOT EXISTS daily_collection_stats (
      date TEXT PRIMARY KEY,
      total_posts INTEGER DEFAULT 0,
      naver_blog INTEGER DEFAULT 0,
      naver_news INTEGER DEFAULT 0,
      naver_datalab INTEGER DEFAULT 0,
      hackernews INTEGER DEFAULT 0,
      producthunt INTEGER DEFAULT 0,
      x_twitter INTEGER DEFAULT 0,
      instagram INTEGER DEFAULT 0,
      keywords_extracted INTEGER DEFAULT 0,
      probe_spikes INTEGER DEFAULT 0,
      digest_sent INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS extracted_keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword TEXT NOT NULL,
      category TEXT,
      region TEXT,
      reason TEXT,
      confidence_score INTEGER DEFAULT 3,
      extracted_at TEXT NOT NULL,
      post_id INTEGER,
      FOREIGN KEY (post_id) REFERENCES raw_posts(id)
    );

    CREATE TABLE IF NOT EXISTS keyword_daily_stats (
      keyword TEXT NOT NULL,
      date TEXT NOT NULL,
      mention_count INTEGER DEFAULT 0,
      unique_accounts INTEGER DEFAULT 0,
      co_keywords TEXT DEFAULT '[]',
      PRIMARY KEY (keyword, date)
    );

    CREATE TABLE IF NOT EXISTS blacklist (
      keyword TEXT PRIMARY KEY,
      added_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alerts_sent (
      keyword TEXT NOT NULL,
      alerted_at TEXT NOT NULL,
      channel TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_kds_keyword_date ON keyword_daily_stats(keyword, date);
    CREATE INDEX IF NOT EXISTS idx_ek_post_id ON extracted_keywords(post_id);
    CREATE INDEX IF NOT EXISTS idx_ek_keyword ON extracted_keywords(keyword);
    CREATE INDEX IF NOT EXISTS idx_alerts_keyword_at ON alerts_sent(keyword, alerted_at);
    CREATE INDEX IF NOT EXISTS idx_rp_collect_date ON raw_posts(collect_date);
    CREATE INDEX IF NOT EXISTS idx_rp_source ON raw_posts(source);
  `);

  return d;
}

// ---------------------------------------------------------------------------
// raw_posts
// ---------------------------------------------------------------------------
export function insertRawPost(post) {
  const d = getDB();
  const stmt = d.prepare(`
    INSERT INTO raw_posts (account, caption, comments_text, collected_at, source_url, source, collect_date)
    VALUES (@account, @caption, @comments_text, @collected_at, @source_url, @source, @collect_date)
  `);
  const info = stmt.run({
    account: post.account,
    caption: post.caption ?? null,
    comments_text: post.comments_text ?? null,
    collected_at: post.collected_at ?? new Date().toISOString(),
    source_url: post.source_url ?? null,
    source: post.source ?? 'unknown',
    collect_date: new Date().toISOString().slice(0, 10),
  });
  return info.lastInsertRowid;
}

export function upsertDailyCollectionStats(stats) {
  const d = getDB();
  const today = new Date().toISOString().slice(0, 10);
  d.prepare(`
    INSERT INTO daily_collection_stats (date, total_posts, naver_blog, naver_news, naver_datalab, hackernews, producthunt, x_twitter, instagram, keywords_extracted, probe_spikes, digest_sent)
    VALUES (@date, @total_posts, @naver_blog, @naver_news, @naver_datalab, @hackernews, @producthunt, @x_twitter, @instagram, @keywords_extracted, @probe_spikes, @digest_sent)
    ON CONFLICT(date) DO UPDATE SET
      total_posts = @total_posts,
      naver_blog = @naver_blog,
      naver_news = @naver_news,
      naver_datalab = @naver_datalab,
      hackernews = @hackernews,
      producthunt = @producthunt,
      x_twitter = @x_twitter,
      instagram = @instagram,
      keywords_extracted = @keywords_extracted,
      probe_spikes = @probe_spikes,
      digest_sent = @digest_sent
  `).run({ date: today, ...stats });
}

export function getDailyCollectionStats(days = 30) {
  const d = getDB();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return d.prepare('SELECT * FROM daily_collection_stats WHERE date >= ? ORDER BY date DESC').all(cutoff.toISOString().slice(0, 10));
}

// ---------------------------------------------------------------------------
// extracted_keywords
// ---------------------------------------------------------------------------
export function insertExtractedKeywords(keywords, postId) {
  const d = getDB();
  const stmt = d.prepare(`
    INSERT INTO extracted_keywords (keyword, category, region, reason, confidence_score, extracted_at, post_id)
    VALUES (@keyword, @category, @region, @reason, @confidence_score, @extracted_at, @post_id)
  `);

  const insertMany = d.transaction((rows) => {
    for (const kw of rows) {
      stmt.run({
        keyword: kw.keyword,
        category: kw.category ?? null,
        region: kw.region ?? null,
        reason: kw.reason ?? null,
        confidence_score: kw.confidence_score ?? 3,
        extracted_at: kw.extracted_at ?? new Date().toISOString(),
        post_id: postId,
      });
    }
  });

  insertMany(keywords);
}

// ---------------------------------------------------------------------------
// keyword_daily_stats  — upsert
// ---------------------------------------------------------------------------
export function upsertDailyStats(keyword, date, accountName, coKeywords = []) {
  const d = getDB();
  const normalized = keyword.trim().toLowerCase();

  // Try to fetch existing row
  const existing = d.prepare(
    'SELECT mention_count, unique_accounts, co_keywords FROM keyword_daily_stats WHERE keyword = ? AND date = ?'
  ).get(normalized, date);

  if (!existing) {
    d.prepare(`
      INSERT INTO keyword_daily_stats (keyword, date, mention_count, unique_accounts, co_keywords)
      VALUES (?, ?, 1, 1, ?)
    `).run(normalized, date, JSON.stringify(coKeywords));
    return;
  }

  // Track unique accounts via a helper query on extracted_keywords + raw_posts
  const uniqueAccounts = d.prepare(`
    SELECT COUNT(DISTINCT rp.account) as cnt
    FROM extracted_keywords ek
    JOIN raw_posts rp ON rp.id = ek.post_id
    WHERE LOWER(ek.keyword) = ? AND rp.collected_at LIKE ?
  `).get(normalized, `${date}%`);

  // Merge co_keywords
  const existingCo = JSON.parse(existing.co_keywords || '[]');
  const mergedCo = [...new Set([...existingCo, ...coKeywords])];

  d.prepare(`
    UPDATE keyword_daily_stats
    SET mention_count = mention_count + 1,
        unique_accounts = ?,
        co_keywords = ?
    WHERE keyword = ? AND date = ?
  `).run(
    uniqueAccounts?.cnt ?? existing.unique_accounts + 1,
    JSON.stringify(mergedCo),
    normalized,
    date,
  );
}

// ---------------------------------------------------------------------------
// getKeywordStats — last N days
// ---------------------------------------------------------------------------
export function getKeywordStats(keyword, days = 7) {
  const d = getDB();
  const normalized = keyword.trim().toLowerCase();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  return d.prepare(`
    SELECT keyword, date, mention_count, unique_accounts, co_keywords
    FROM keyword_daily_stats
    WHERE keyword = ? AND date >= ?
    ORDER BY date DESC
  `).all(normalized, cutoffStr);
}

// ---------------------------------------------------------------------------
// getAllRecentKeywords — for scoring
// ---------------------------------------------------------------------------
export function getAllRecentKeywords(days = 7) {
  const d = getDB();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  return d.prepare(`
    SELECT keyword,
           SUM(mention_count) as total_mentions,
           SUM(unique_accounts) as total_unique_accounts,
           MAX(date) as latest_date,
           COUNT(*) as active_days
    FROM keyword_daily_stats
    WHERE date >= ?
    GROUP BY keyword
    ORDER BY total_mentions DESC
  `).all(cutoffStr);
}

// ---------------------------------------------------------------------------
// blacklist
// ---------------------------------------------------------------------------
export function addToBlacklist(keyword) {
  const d = getDB();
  const normalized = keyword.trim().toLowerCase();
  d.prepare(`
    INSERT OR IGNORE INTO blacklist (keyword, added_at) VALUES (?, ?)
  `).run(normalized, new Date().toISOString());
}

export function isBlacklisted(keyword) {
  const d = getDB();
  const normalized = keyword.trim().toLowerCase();
  const row = d.prepare('SELECT keyword FROM blacklist WHERE keyword = ?').get(normalized);
  return !!row;
}

export function getBlacklist() {
  const d = getDB();
  return d.prepare('SELECT keyword, added_at FROM blacklist ORDER BY added_at DESC').all();
}

// ---------------------------------------------------------------------------
// alerts
// ---------------------------------------------------------------------------
export function logAlert(keyword, channel) {
  const d = getDB();
  d.prepare(`
    INSERT INTO alerts_sent (keyword, alerted_at, channel) VALUES (?, ?, ?)
  `).run(keyword.trim().toLowerCase(), new Date().toISOString(), channel);
}

export function getRecentAlerts(hours = 24) {
  const d = getDB();
  const cutoff = new Date();
  cutoff.setTime(cutoff.getTime() - hours * 60 * 60 * 1000);
  const cutoffStr = cutoff.toISOString();

  return d.prepare(`
    SELECT keyword, alerted_at, channel
    FROM alerts_sent
    WHERE alerted_at >= ?
    ORDER BY alerted_at DESC
  `).all(cutoffStr);
}
