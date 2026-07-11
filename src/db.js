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
    CREATE INDEX IF NOT EXISTS idx_rp_url ON raw_posts(source_url);
  `);

  // 기존 DB 마이그레이션 — 새 컬럼이 없으면 추가
  const cols = d.prepare("PRAGMA table_info(raw_posts)").all().map(c => c.name);
  if (!cols.includes('source')) d.exec("ALTER TABLE raw_posts ADD COLUMN source TEXT DEFAULT 'unknown'");
  if (!cols.includes('collect_date')) d.exec("ALTER TABLE raw_posts ADD COLUMN collect_date TEXT");

  // 검색가능형 키워드(Phase 1) — 단독 검색으로 의미가 통하는 키워드 형태 (blog-traffic-dev 스킬 §3)
  const ekCols = d.prepare("PRAGMA table_info(extracted_keywords)").all().map(c => c.name);
  if (!ekCols.includes('search_keyword')) d.exec("ALTER TABLE extracted_keywords ADD COLUMN search_keyword TEXT");
  // 소재 유형(Phase 2) — 방송미디어/신메뉴출시/지역맛집/식문화현상/시즌성 (blog-traffic-dev 스킬 §5)
  if (!ekCols.includes('content_type')) d.exec("ALTER TABLE extracted_keywords ADD COLUMN content_type TEXT");

  // 검색가능성 검증 결과(Phase 1 STEP 4.5) — doc_count: 경쟁 블로그 문서 수(공급 지표), searchable: 0=검증 실패
  const kdsCols = d.prepare("PRAGMA table_info(keyword_daily_stats)").all().map(c => c.name);
  if (!kdsCols.includes('doc_count')) d.exec("ALTER TABLE keyword_daily_stats ADD COLUMN doc_count INTEGER");
  if (!kdsCols.includes('searchable')) d.exec("ALTER TABLE keyword_daily_stats ADD COLUMN searchable INTEGER");

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

// 최근 N일 내 이미 수집한 URL 집합 — 크로스데이 중복 수집 방지 (같은 기사 재수집 차단)
export function getRecentSourceUrls(days = 14) {
  const d = getDB();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const rows = d.prepare(
    'SELECT DISTINCT source_url FROM raw_posts WHERE source_url IS NOT NULL AND collected_at >= ?'
  ).all(cutoff.toISOString());
  return new Set(rows.map((r) => r.source_url));
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
// 최근 N일 내 이미 추출된 키워드 목록 — Generator 프롬프트의 제외 목록으로 주입 (반복 보고 방지)
export function getRecentExtractedKeywords(days = 7, limit = 40) {
  const d = getDB();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const rows = d.prepare(`
    SELECT keyword, COUNT(*) AS cnt, MAX(extracted_at) AS last_seen
    FROM extracted_keywords
    WHERE extracted_at >= ?
    GROUP BY keyword
    ORDER BY cnt DESC, last_seen DESC
    LIMIT ?
  `).all(cutoff.toISOString(), limit);
  return rows.map((r) => r.keyword);
}

export function insertExtractedKeywords(keywords, postId) {
  const d = getDB();
  const stmt = d.prepare(`
    INSERT INTO extracted_keywords (keyword, category, region, reason, confidence_score, extracted_at, post_id, search_keyword, content_type)
    VALUES (@keyword, @category, @region, @reason, @confidence_score, @extracted_at, @post_id, @search_keyword, @content_type)
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
        search_keyword: kw.search_keyword ?? null,
        content_type: kw.content_type ?? null,
      });
    }
  });

  insertMany(keywords);
}

// STEP 4.5(searchability.js)의 검증 결과를 keyword_daily_stats에 반영.
// upsertDailyStats로 당일 행이 이미 생성돼 있어야 반영된다(없으면 조용히 무시 — fail-open).
export function setSearchability(keyword, date, { docCount = null, searchable = null } = {}) {
  const d = getDB();
  const normalized = keyword.trim().toLowerCase();
  d.prepare(`
    UPDATE keyword_daily_stats SET doc_count = ?, searchable = ?
    WHERE keyword = ? AND date = ?
  `).run(docCount, searchable === null ? null : (searchable ? 1 : 0), normalized, date);
}

// 최근 N일 내 언급된 키워드들의 co_keywords를 빈도순으로 집계 — 동적 탐색 쿼리 생성용 (Phase 3)
export function getRecentTopCoKeywords(days = 3, limit = 4) {
  const d = getDB();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const rows = d.prepare(
    'SELECT co_keywords FROM keyword_daily_stats WHERE date >= ? ORDER BY mention_count DESC LIMIT 30'
  ).all(cutoffStr);

  const freq = new Map();
  for (const r of rows) {
    let arr;
    try { arr = JSON.parse(r.co_keywords || '[]'); } catch { arr = []; }
    for (const kw of arr) {
      if (!kw || kw.length < 2) continue;
      freq.set(kw, (freq.get(kw) || 0) + 1);
    }
  }

  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([kw]) => kw);
}

// 최근 N일 내 keyword_daily_stats에 기록이 있는 키워드 집합 — 탐침 풀 활동 여부 확인용 (Phase 3)
export function getKeywordSpikeHistory(keywords, days = 14) {
  const d = getDB();
  if (!keywords.length) return new Set();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const normalized = keywords.map(k => k.trim().toLowerCase());
  const placeholders = normalized.map(() => '?').join(',');
  const rows = d.prepare(
    `SELECT DISTINCT keyword FROM keyword_daily_stats WHERE date >= ? AND keyword IN (${placeholders})`
  ).all(cutoffStr, ...normalized);
  return new Set(rows.map(r => r.keyword));
}

// 최근 N일 내 다이제스트 "황금 소재" 섹션에 이미 노출된 키워드 — 다이제스트 쿨다운용 (Phase 3)
export function getRecentDigestTopKeywords(days = 7) {
  const d = getDB();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const rows = d.prepare(
    "SELECT DISTINCT keyword FROM alerts_sent WHERE channel = 'digest_top' AND alerted_at >= ?"
  ).all(cutoff.toISOString());
  return new Set(rows.map(r => r.keyword));
}

// 최근 N일 내 다이제스트 "데이터랩 급등" 섹션에 이미 노출된 탐침 키워드 — 급등 반복 노출 방지 쿨다운.
// 데이터랩 급등 판정 윈도(최근 3일 vs 이전 7일)가 롤링이라 한 번의 급등이 며칠씩 재감지되는 것을 막는다.
export function getRecentProbeSpikeKeywords(days = 3) {
  const d = getDB();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const rows = d.prepare(
    "SELECT DISTINCT keyword FROM alerts_sent WHERE channel = 'probe_spike' AND alerted_at >= ?"
  ).all(cutoff.toISOString());
  return new Set(rows.map(r => r.keyword));
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
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const rows = d.prepare(`
    SELECT keyword, date, mention_count, unique_accounts, co_keywords
    FROM keyword_daily_stats
    WHERE keyword = ? AND date >= ?
    ORDER BY date DESC
  `).all(normalized, cutoffStr);

  return rows.map(r => {
    const rowDate = new Date(r.date);
    rowDate.setHours(0, 0, 0, 0);
    return {
      keyword: r.keyword,
      date: r.date,
      daysAgo: Math.round((today - rowDate) / (1000 * 60 * 60 * 24)),
      mentions: r.mention_count,
      mention_count: r.mention_count,
      accounts: [],
      uniqueAccounts: r.unique_accounts,
      unique_accounts: r.unique_accounts,
      coKeywords: JSON.parse(r.co_keywords || '[]'),
      confidenceScore: r.mention_count > 0 ? 4 : 0,
    };
  });
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
    SELECT kds.keyword,
           SUM(kds.mention_count) as total_mentions,
           SUM(kds.unique_accounts) as total_unique_accounts,
           MAX(kds.date) as latest_date,
           COUNT(*) as active_days,
           ek.category,
           ek.region,
           ek.reason,
           ek.search_keyword,
           ek.content_type,
           rp.source_url,
           (SELECT doc_count FROM keyword_daily_stats k2
              WHERE k2.keyword = kds.keyword AND k2.doc_count IS NOT NULL
              ORDER BY k2.date DESC LIMIT 1) as doc_count,
           (SELECT searchable FROM keyword_daily_stats k2
              WHERE k2.keyword = kds.keyword AND k2.searchable IS NOT NULL
              ORDER BY k2.date DESC LIMIT 1) as searchable
    FROM keyword_daily_stats kds
    LEFT JOIN (
      SELECT keyword, category, region, reason, search_keyword, content_type, post_id
      FROM extracted_keywords
      WHERE extracted_at = (
        SELECT MAX(extracted_at) FROM extracted_keywords ek2
        WHERE LOWER(ek2.keyword) = LOWER(extracted_keywords.keyword)
      )
    ) ek ON LOWER(ek.keyword) = LOWER(kds.keyword)
    LEFT JOIN raw_posts rp ON rp.id = ek.post_id
    WHERE kds.date >= ?
    GROUP BY kds.keyword
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
