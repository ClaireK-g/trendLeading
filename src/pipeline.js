// Main pipeline orchestrator
import { initDB, insertRawPost, insertExtractedKeywords, upsertDailyStats, logAlert } from './db.js';
import * as scraper from './scraper.js';
import * as extractor from './extractor.js';
import { detectBursts, shouldAlert, rankAllKeywords } from './scorer.js';
import { sendAlert, sendDailyDigest } from './alerter.js';
import config from './config.js';

function timestamp() {
  return new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

/**
 * Insert posts into DB, extract keywords, update daily stats.
 * Shared logic for runPipeline and runWithLocalData.
 */
async function ingestAndExtract(posts) {
  const today = new Date().toISOString().slice(0, 10);

  // Insert raw posts into DB and collect post IDs
  const postIds = [];
  for (const post of posts) {
    const id = insertRawPost({
      account: post.account,
      caption: post.caption,
      comments_text: post.commentsText ?? post.comments_text ?? null,
      collected_at: post.collectedAt ?? post.collected_at ?? new Date().toISOString(),
      source_url: post.sourceUrl ?? post.source_url ?? null,
    });
    postIds.push(id);
  }

  // Extract keywords via LLM
  const keywords = await extractor.processBatch(posts);

  // Insert extracted keywords and update daily stats
  for (let i = 0; i < keywords.length; i++) {
    const kw = keywords[i];
    // Associate with first post if we can't determine exact post
    const postId = postIds[0] ?? null;
    insertExtractedKeywords([kw], postId);

    const coKeywords = kw.co_keywords || [];
    upsertDailyStats(kw.keyword, today, kw.account ?? '', coKeywords);
  }

  return keywords;
}

/**
 * Score bursts and send alerts. Returns count of alerts sent.
 */
async function scoreAndAlert() {
  const bursts = await detectBursts(config.scoring.burstThreshold);
  let alertsSent = 0;

  for (const burst of bursts) {
    try {
      const canAlert = await shouldAlert(burst.keyword, config.scoring.alertCooldownHours);
      if (canAlert) {
        await sendAlert(burst);
        alertsSent++;
      }
    } catch (err) {
      console.error(`[pipeline] Alert failed for "${burst.keyword}":`, err.message);
    }
  }

  return { bursts, alertsSent };
}

/**
 * Full daily pipeline: scrape -> extract -> score -> alert
 */
export async function runPipeline() {
  console.log(`[pipeline] ${timestamp()} 파이프라인 시작`);
  initDB();

  // 1. Collect posts via Apify
  console.log('[pipeline] 게시물 수집 중...');
  const posts = await scraper.collectDaily();
  console.log(`[pipeline] ${posts.length}개 게시물 수집 완료`);

  // 2. Ingest and extract
  console.log('[pipeline] 키워드 추출 중...');
  const keywords = await ingestAndExtract(posts);
  console.log(`[pipeline] ${keywords.length}개 키워드 추출 완료`);

  // 3. Score and alert
  console.log('[pipeline] 버스트 감지 및 알림 처리 중...');
  const { bursts, alertsSent } = await scoreAndAlert();

  // 4. 일일 리포트 — 키워드가 1개라도 추출되면 무조건 발송
  let digestSent = false;
  if (keywords.length > 0) {
    console.log('[pipeline] 일일 트렌드 리포트 발송 중...');
    try {
      const ranked = await rankAllKeywords();
      await sendDailyDigest(ranked.length ? ranked : keywords);
      digestSent = true;
      console.log('[pipeline] 일일 리포트 발송 완료');
    } catch (err) {
      console.error('[pipeline] 일일 리포트 발송 실패:', err.message);
    }
  }

  const result = {
    postsCollected: posts.length,
    keywordsExtracted: keywords.length,
    burstsDetected: bursts.length,
    alertsSent,
    digestSent,
  };

  console.log(`[pipeline] ${timestamp()} 파이프라인 완료:`, JSON.stringify(result));
  return result;
}

/**
 * Re-score existing data and report (no new data collection)
 */
export async function runScoringOnly() {
  console.log(`[pipeline] ${timestamp()} 스코어링 전용 실행`);
  initDB();

  const ranked = await rankAllKeywords();
  console.log(`[pipeline] 상위 키워드 ${ranked.length}개:`);
  for (const kw of ranked.slice(0, 15)) {
    console.log(`  ${kw.verdict} ${kw.keyword} (score: ${kw.trendScore.toFixed(2)}, burst: ${kw.burstRatio.toFixed(2)}x)`);
  }

  const { bursts, alertsSent } = await scoreAndAlert();
  console.log(`[pipeline] 버스트 ${bursts.length}건 감지, 알림 ${alertsSent}건 전송`);

  return { ranked, burstsDetected: bursts.length, alertsSent };
}

/**
 * Run pipeline with local text data (for testing without Apify)
 */
export async function runWithLocalData(textArray) {
  console.log(`[pipeline] ${timestamp()} 로컬 데이터로 파이프라인 실행 (${textArray.length}건)`);
  initDB();

  // Convert text array to post-like objects
  const posts = textArray.map((text, i) => ({
    account: `test_account_${i + 1}`,
    caption: text,
    commentsText: null,
    sourceUrl: null,
    collectedAt: new Date().toISOString(),
  }));

  // Extract keywords
  const keywords = await ingestAndExtract(posts);
  console.log(`[pipeline] ${keywords.length}개 키워드 추출 완료`);

  // Score and alert
  const { bursts, alertsSent } = await scoreAndAlert();

  const result = {
    postsCollected: posts.length,
    keywordsExtracted: keywords.length,
    burstsDetected: bursts.length,
    alertsSent,
  };

  console.log(`[pipeline] ${timestamp()} 로컬 파이프라인 완료:`, JSON.stringify(result));
  return result;
}

export default { runPipeline, runScoringOnly, runWithLocalData };
