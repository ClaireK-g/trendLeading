// buzz/pipeline.js — buzzAnalysis 오케스트레이터 (docs/buzz-analysis-design.md §2, §4)
// src/pipeline.js를 import하지 않는다 — 완전 격리 원칙.
import { initDB } from './db.js';
import { loadTargets } from './targets.js';
import { collectDaily } from './collector.js';
import { sendReport } from './reporter.js';

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

  // STEP 3~5(정제/질적분석/지표산출 세부)는 BZ-3~BZ-6에서 순서대로 추가된다.

  // STEP 6: 리포트 발송
  const result = await sendReport(targets);
  console.log('[buzz:pipeline] 리포트 발송 결과:', result);
  return result;
}
