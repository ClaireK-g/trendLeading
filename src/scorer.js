// Burst detection and trend scoring
import { getAllRecentKeywords, getKeywordStats } from './db.js';

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
  const uniqueAccounts7 = new Set(last7.flatMap(d => d.accounts || [])).size;
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

  return {
    keyword,
    trendScore,
    burstRatio,
    spreadScore,
    acceleration,
    coOccurrenceRichness,
    verdict,
  };
}

/**
 * Rank all keywords by trend score, return top 30.
 * @returns {Promise<Array>}
 */
export async function rankAllKeywords() {
  const keywords = await getAllRecentKeywords(7);
  const scored = await Promise.all(keywords.map(k => calculateTrendScore(k.keyword)));
  scored.sort((a, b) => b.trendScore - a.trendScore);
  return scored.slice(0, 30);
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
  const uniqueAccounts3 = new Set(last3.flatMap(d => d.accounts || [])).size;

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
