// buzz/pipeline.js — buzzAnalysis 오케스트레이터 (docs/buzz-analysis-design.md §2, §4)
// src/pipeline.js를 import하지 않는다 — 완전 격리 원칙.
import { initDB, getPostChannelCounts, updateCleanVolume, insertSpike, pruneOldPosts } from './db.js';
import { loadTargets } from './targets.js';
import { collectDaily } from './collector.js';
import { cleanDaily } from './cleaner.js';
import { analyzeDaily, summarizeSpikeTrigger } from './analyzer.js';
import { detectSpike } from './metrics.js';
import { sendReport } from './reporter.js';
import config from './config.js';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export async function runBuzzPipeline() {
  console.log('[buzz:pipeline] 화제성 분석 파이프라인 시작');
  initDB();

  // STEP 1: 타깃 로드
  const targets = loadTargets();
  console.log(`[buzz:pipeline] 타깃 ${targets.length}개 로드`);

  // STEP 2: 수집 (버즈량 원천) — 부분 실패가 전체를 죽이지 않도록 try/catch (본체와 동일 원칙)
  try {
    await collectDaily(targets);
  } catch (err) {
    console.error('[buzz:pipeline] STEP 2 수집 실패 (무시하고 계속 진행):', err.message);
  }

  // STEP 3: 정제·필터링 — 노이즈 마킹 후 클린 volume으로 buzz_daily_stats 재계산
  try {
    const today = todayStr();
    cleanDaily(targets, today);
    for (const target of targets) {
      const counts = getPostChannelCounts(target.id, today);
      for (const c of counts) {
        updateCleanVolume(target.id, today, c.channel, c.cleanCount);
      }
    }
  } catch (err) {
    console.error('[buzz:pipeline] STEP 3 정제 실패 (무시하고 계속 진행):', err.message);
  }

  // STEP 4: 질적 분석(감성) — Gemini 키가 없으면 스킵(fail-open)
  try {
    if (config.geminiApiKeys.length) {
      await analyzeDaily(targets, todayStr());
    } else {
      console.warn('[buzz:pipeline] GEMINI_API_KEY 미설정 → STEP 4 감성 분석 스킵');
    }
  } catch (err) {
    console.error('[buzz:pipeline] STEP 4 감성 분석 실패 (무시하고 계속 진행):', err.message);
  }

  // STEP 5: 스파이크 감지 + 트리거 역추적
  try {
    const today = todayStr();
    for (const target of targets) {
      const spike = detectSpike(target.id);
      if (!spike.isSpike) continue;

      const { candidates, summary } = await summarizeSpikeTrigger(target.id, today, target.name);
      insertSpike({
        target: target.id,
        date: today,
        ratio: spike.ratio,
        triggerUrls: candidates.map((c) => ({ url: c.url, title: c.title, channel: c.channel })),
        triggerSummary: summary,
      });
    }
  } catch (err) {
    console.error('[buzz:pipeline] STEP 5 스파이크 감지 실패 (무시하고 계속 진행):', err.message);
  }

  // STEP 6: 리포트 발송
  const result = await sendReport(targets);
  console.log('[buzz:pipeline] 리포트 발송 결과:', result);

  // 데이터 보존 — buzz_posts 90일 경과분 정리는 주 1회(월요일 KST)만 실행. 지표 테이블은 영구 보존.
  try {
    const isMonday = new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Seoul', weekday: 'short' }) === 'Mon';
    if (isMonday) {
      const removed = pruneOldPosts(90);
      if (removed) console.log(`[buzz:pipeline] 90일 경과 게시물 ${removed}건 정리`);
    }
  } catch (err) {
    console.error('[buzz:pipeline] 데이터 정리 실패 (무시):', err.message);
  }

  return result;
}
