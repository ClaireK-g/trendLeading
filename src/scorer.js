// Burst detection and trend scoring
import { getAllRecentKeywords, getKeywordStats } from './db.js';

const LEVEL_LABELS = {
  L1: '🟢 신규 트렌드 (1주+)',
  L2: '🟡 성장 트렌드 (2주+)',
  L3: '🟠 확산 트렌드 (3주+)',
  L4: '🔴 메인스트림 진입 (4주+)',
};

/**
 * Classify a keyword into a trend level based on how long it has been active.
 * @param {string} keyword
 * @returns {Promise<{level: string|null, activeDays: number, spanDays: number, label: string}>}
 */
export async function classifyTrendLevel(keyword) {
  const stats = await getKeywordStats(keyword, 35);

  // Count distinct dates with mention_count > 0
  const activeDays = stats.filter(d => (d.mentions || d.mention_count || 0) > 0).length;

  // Calculate span from first seen date to today
  let spanDays = 0;
  if (stats.length > 0) {
    const dates = stats
      .map(d => d.date ? new Date(d.date) : null)
      .filter(Boolean);
    if (dates.length > 0) {
      const earliest = new Date(Math.min(...dates));
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      earliest.setHours(0, 0, 0, 0);
      spanDays = Math.round((today - earliest) / (1000 * 60 * 60 * 24));
    }
  }

  let level = null;
  if (activeDays >= 10 && spanDays >= 28) {
    level = 'L4';
  } else if (activeDays >= 7 && spanDays >= 21) {
    level = 'L3';
  } else if (activeDays >= 5 && spanDays >= 14) {
    level = 'L2';
  } else if (activeDays >= 3 && spanDays >= 7) {
    level = 'L1';
  }
  // activeDays >= 1 && span < 7 => null (too new)

  const label = level ? LEVEL_LABELS[level] : '⚪ 관찰 중';

  return { level, activeDays, spanDays, label };
}

/**
 * Calculate a trend score for a single keyword using burst detection signals.
 * @param {string} keyword
 * @returns {Promise<Object>} scoring breakdown and verdict
 */
export async function calculateTrendScore(keyword) {
  const stats = await getKeywordStats(keyword, 35);

  // Split into last 7 days and previous 28 days
  const last7 = stats.filter(d => d.daysAgo < 7);
  const prev28 = stats.filter(d => d.daysAgo >= 7 && d.daysAgo < 35);

  const last7Total = last7.reduce((sum, d) => sum + (d.mentions || 0), 0);
  const prev28Total = prev28.reduce((sum, d) => sum + (d.mentions || 0), 0);
  const prev28WeeklyAvg = prev28Total / 4; // 28 days = 4 weeks

  // a) Burst Ratio
  let burstRatio;
  if (prev28WeeklyAvg === 0) {
    burstRatio = last7Total > 3 ? 10 : 0;
  } else {
    burstRatio = last7Total / prev28WeeklyAvg;
  }

  // b) Spread Score — unique accounts / total mentions in last 7 days
  const uniqueAccounts7 = last7.reduce((sum, d) => sum + (d.uniqueAccounts || 0), 0);
  const spreadScore = last7Total > 0
    ? Math.min(uniqueAccounts7 / last7Total, 1)
    : 0;

  // c) Acceleration — last 3 days avg vs last 7 days avg
  const last3 = stats.filter(d => d.daysAgo < 3);
  const last3Avg = last3.length > 0
    ? last3.reduce((sum, d) => sum + (d.mentions || 0), 0) / last3.length
    : 0;
  const last7Avg = last7.length > 0 ? last7Total / last7.length : 0;
  const acceleration = last7Avg > 0 ? last3Avg / last7Avg : 0;

  // d) Co-occurrence Richness — distinct co-keywords in last 7 days
  const coKeywords = new Set(last7.flatMap(d => d.coKeywords || []));
  const coOccurrenceRichness = coKeywords.size;

  // Final score
  const trendScore =
    burstRatio * 0.4 +
    spreadScore * 10 * 0.25 +
    acceleration * 0.2 +
    Math.min(coOccurrenceRichness, 10) * 0.15;

  let verdict;
  if (trendScore > 5) {
    verdict = '🔥 급상승';
  } else if (trendScore > 2.5) {
    verdict = '📈 주목';
  } else {
    verdict = '📊 관찰';
  }

  // Trend level classification
  const { level: trendLevel, activeDays, spanDays, label: levelLabel } = await classifyTrendLevel(keyword);

  return {
    keyword,
    trendScore,
    burstRatio,
    spreadScore,
    acceleration,
    coOccurrenceRichness,
    verdict,
    trendLevel,
    activeDays,
    spanDays,
    levelLabel,
  };
}

/**
 * Rank all keywords by trend score, return top 30.
 * @returns {Promise<Array>}
 */
export async function rankAllKeywords() {
  const keywords = await getAllRecentKeywords(7);
  const metaByKeyword = new Map(keywords.map(k => [k.keyword, k]));
  const scored = await Promise.all(keywords.map(k => calculateTrendScore(k.keyword)));

  // getAllRecentKeywords의 메타(category/reason/search_keyword/doc_count/searchable/source_url)를
  // calculateTrendScore 결과에 다시 합친다 — 안 그러면 다이제스트가 reason/검색링크를 못 만든다.
  const merged = scored.map(s => {
    const meta = metaByKeyword.get(s.keyword) || {};
    return {
      ...s,
      category: meta.category ?? null,
      region: meta.region ?? null,
      reason: meta.reason ?? null,
      searchKeyword: meta.search_keyword ?? null,
      docCount: meta.doc_count ?? null,
      searchable: meta.searchable === null || meta.searchable === undefined ? null : !!meta.searchable,
      sourceUrl: meta.source_url ?? null,
    };
  });

  merged.sort((a, b) => b.trendScore - a.trendScore);
  return merged.slice(0, 30);
}

/**
 * Detect keywords with burst ratio above threshold.
 * @param {number} threshold
 * @returns {Promise<Array>}
 */
export async function detectBursts(threshold = 3.0) {
  const ranked = await rankAllKeywords();
  return ranked
    .filter(r => r.burstRatio >= threshold)
    .sort((a, b) => b.burstRatio - a.burstRatio);
}

/**
 * Check whether a keyword should trigger an alert.
 * @param {string} keyword
 * @param {number} recentAlertsHours - cooldown window in hours
 * @returns {Promise<boolean>}
 */
export async function shouldAlert(keyword, recentAlertsHours = 72) {
  const stats = await getKeywordStats(keyword, 35);
  const { trendScore } = await calculateTrendScore(keyword);

  // confidence_score check — take max confidence from recent stats
  const maxConfidence = Math.max(0, ...stats.filter(d => d.daysAgo < 3).map(d => d.confidenceScore ?? 0));

  // unique accounts in last 3 days
  const last3 = stats.filter(d => d.daysAgo < 3);
  const uniqueAccounts3 = last3.reduce((sum, d) => sum + (d.uniqueAccounts || 0), 0);

  // last alert check
  const lastAlertedAt = stats[0]?.lastAlertedAt;
  const alreadyAlerted = lastAlertedAt &&
    (Date.now() - new Date(lastAlertedAt).getTime()) < recentAlertsHours * 60 * 60 * 1000;

  return (
    maxConfidence >= 4 &&
    uniqueAccounts3 >= 5 &&
    trendScore >= 3.0 &&
    !alreadyAlerted
  );
}
