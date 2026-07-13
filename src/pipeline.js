// Main pipeline orchestrator
import { initDB, insertRawPost, insertExtractedKeywords, upsertDailyStats, upsertDailyCollectionStats, logAlert } from './db.js';
import * as scraper from './scraper.js';
import * as extractor from './extractor.js';
import { detectBursts, shouldAlert, rankAllKeywords } from './scorer.js';
import { sendAlert, sendDailyDigest } from './alerter.js';
import { runProbe, verifyWithDatalab } from './probe.js';
import { verifySearchability } from './searchability.js';
import config from './config.js';

function timestamp() {
  return new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

/**
 * 키워드의 실제 출처 게시물을 본문 매칭으로 찾는다. 과거엔 배열 인덱스(i번째 키워드→i번째 게시물)로
 * 연결해 다이제스트 "📰 근거" 링크가 무관한 글을 가리켰다 — 키워드는 LLM 3단계에서 병합·재정렬되므로
 * 순서 대응이 성립하지 않는다. 확신 있는 매칭이 없으면 -1을 반환한다(틀린 링크보다 링크 없음이 낫다).
 * @param {Object} kw 추출 키워드 객체
 * @param {string[]} postTexts 게시물별 소문자 본문(caption+comments)
 * @returns {number} 매칭된 posts 배열 인덱스, 없으면 -1
 */
function findSourcePostIndex(kw, postTexts) {
  // 1) keyword/search_keyword가 본문에 그대로 등장하는 게시물
  const exactTerms = [kw.keyword, kw.search_keyword]
    .map(t => (t || '').trim().toLowerCase())
    .filter(t => t.length >= 2);
  for (const term of exactTerms) {
    const idx = postTexts.findIndex(x => x.includes(term));
    if (idx !== -1) return idx;
  }

  // 2) freshness_signal(원문 인용)이 등장하는 게시물
  const signal = (kw.freshness_signal || '').replace(/["'“”…]/g, '').trim().toLowerCase();
  if (signal.length >= 8) {
    const probe = signal.slice(0, 20);
    const idx = postTexts.findIndex(x => x.includes(probe));
    if (idx !== -1) return idx;
  }

  // 3) 키워드 토큰이 가장 많이 겹치는 게시물 (토큰 절반 이상 일치할 때만 — 우연 일치 방지)
  const tokens = [...new Set(exactTerms.flatMap(t => t.split(/[\s()（）/]+/)))]
    .filter(t => t.length >= 2);
  if (tokens.length) {
    let best = -1;
    let bestScore = 0;
    postTexts.forEach((x, i) => {
      const score = tokens.reduce((s, t) => s + (x.includes(t) ? 1 : 0), 0);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (best !== -1 && bestScore >= Math.ceil(tokens.length / 2)) return best;
  }

  return -1;
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
      source: post.source ?? 'unknown',
    });
    postIds.push(id);
  }

  // Extract keywords via LLM
  const keywords = await extractor.processBatch(posts);

  // 출처 매칭용 게시물 본문 (소문자 정규화)
  const postTexts = posts.map(p =>
    `${p.caption || ''} ${p.commentsText ?? p.comments_text ?? ''}`.toLowerCase()
  );

  // Insert extracted keywords and update daily stats — 출처 게시물은 본문 매칭으로 연결
  let unmatched = 0;
  for (let i = 0; i < keywords.length; i++) {
    const kw = keywords[i];
    const srcIdx = findSourcePostIndex(kw, postTexts);
    const postId = srcIdx !== -1 ? postIds[srcIdx] : null;
    insertExtractedKeywords([kw], postId);
    if (srcIdx === -1) unmatched++;

    const coKeywords = kw.co_keywords || [];
    // unique_accounts 집계용 계정도 실제 출처 게시물 기준 (매칭 실패 시 합성 계정)
    const account = (srcIdx !== -1 && posts[srcIdx].account) || `source_${i}`;
    upsertDailyStats(kw.keyword, today, account, coKeywords);
  }
  if (unmatched) {
    console.log(`[pipeline] 출처 게시물 미매칭 키워드 ${unmatched}건 — 근거 링크 없이 저장`);
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

  // ── STEP 4.5: 검색가능성 검증 — 네이버 검색으로 실제 검색되는지 + 경쟁 문서 수 확인 ──
  if (verifiedKeywords.length > 0) {
    console.log('[pipeline] [STEP 4.5] 검색가능성 검증...');
    try {
      verifiedKeywords = await verifySearchability(verifiedKeywords);
    } catch (err) {
      console.warn('[pipeline] 검색가능성 검증 실패 (무시):', err.message);
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

  // ── 일일 수집 통계 저장 (모수 추이 관찰용) ──────────────────────
  const sourceCounts = {};
  for (const post of posts) {
    const src = post.source || 'unknown';
    sourceCounts[src] = (sourceCounts[src] || 0) + 1;
  }
  upsertDailyCollectionStats({
    total_posts: posts.length,
    naver_blog: sourceCounts.naver_blog || 0,
    naver_news: sourceCounts.naver_news || 0,
    naver_datalab: sourceCounts.naver_datalab || 0,
    hackernews: sourceCounts.hackernews || 0,
    producthunt: sourceCounts.producthunt || 0,
    x_twitter: sourceCounts.x || 0,
    instagram: sourceCounts.instagram || 0,
    keywords_extracted: keywords.length,
    probe_spikes: probeSpikes.length,
    digest_sent: digestSent ? 1 : 0,
  });
  console.log(`[pipeline] 일일 수집 통계 저장 완료:`, JSON.stringify(sourceCounts));

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
