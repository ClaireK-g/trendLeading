// Main pipeline orchestrator
import { initDB, insertRawPost, insertExtractedKeywords, upsertDailyStats, logAlert } from './db.js';
import * as scraper from './scraper.js';
import * as extractor from './extractor.js';
import { detectBursts, shouldAlert, rankAllKeywords } from './scorer.js';
import { sendAlert, sendDailyDigest } from './alerter.js';
import { runProbe, verifyWithDatalab } from './probe.js';
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

  // ── STEP 1: 데이터랩 탐침 (선행 지표) ─────────────────────────
  console.log('[pipeline] [STEP 1] 데이터랩 탐침 — 검색량 급등 키워드 스캔...');
  let probeSpikes = [];
  try {
    probeSpikes = await runProbe();
  } catch (err) {
    console.warn('[pipeline] 탐침 실패 (무시):', err.message);
  }

  // 탐침에서 급등한 키워드를 DB에 기록 (트렌드 레벨 누적용)
  const today = new Date().toISOString().slice(0, 10);
  for (const spike of probeSpikes) {
    upsertDailyStats(spike.keyword, today, 'datalab_probe', []);
  }

  // ── STEP 2: 네이버 블로그/뉴스 수집 (맥락 보강) ────────────────
  console.log('[pipeline] [STEP 2] 네이버 블로그/뉴스/데이터랩 수집...');
  const posts = await scraper.collectDaily();
  console.log(`[pipeline] ${posts.length}개 게시물 수집 완료`);

  // ── STEP 3: LLM 키워드 추출 ──────────────────────────────────
  console.log('[pipeline] [STEP 3] LLM 키워드 추출...');
  const keywords = await ingestAndExtract(posts);
  console.log(`[pipeline] ${keywords.length}개 키워드 추출 완료`);

  // ── STEP 4: 데이터랩 역검증 — 추출된 키워드의 검색량 확인 ─────
  let verifiedKeywords = keywords;
  if (keywords.length > 0) {
    console.log('[pipeline] [STEP 4] 추출 키워드 데이터랩 역검증...');
    try {
      verifiedKeywords = await verifyWithDatalab(keywords);
    } catch (err) {
      console.warn('[pipeline] 역검증 실패 (무시):', err.message);
    }
  }

  // ── STEP 5: 스코어링 + 알림 ──────────────────────────────────
  console.log('[pipeline] [STEP 5] 스코어링 및 알림...');
  const { bursts, alertsSent } = await scoreAndAlert();

  // ── STEP 6: 일일 리포트 — 탐침 + 추출 결과 합산 ──────────────
  let digestSent = false;
  const allFindings = [...probeSpikes.slice(0, 10), ...verifiedKeywords];
  if (allFindings.length > 0) {
    console.log('[pipeline] [STEP 6] 일일 트렌드 리포트 발송...');
    try {
      const ranked = await rankAllKeywords();
      const digestData = ranked.length ? ranked : verifiedKeywords;
      // 탐침 급등 키워드도 digest에 포함
      if (probeSpikes.length) {
        digestData.probeSpikes = probeSpikes.slice(0, 10);
      }
      await sendDailyDigest(digestData);
      digestSent = true;
      console.log('[pipeline] 일일 리포트 발송 완료');
    } catch (err) {
      console.error('[pipeline] 일일 리포트 발송 실패:', err.message);
    }
  }

  const result = {
    postsCollected: posts.length,
    keywordsExtracted: keywords.length,
    probeSpikes: probeSpikes.length,
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
