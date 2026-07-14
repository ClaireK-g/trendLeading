// buzz/pipeline.js — buzzAnalysis 오케스트레이터 (docs/buzz-analysis-design.md §2, §4)
// src/pipeline.js를 import하지 않는다 — 완전 격리 원칙.
import { initDB } from './db.js';
import { loadTargets } from './targets.js';
import { sendSkeletonReport } from './reporter.js';

export async function runBuzzPipeline() {
  console.log('[buzz:pipeline] 화제성 분석 파이프라인 시작');
  initDB();

  // STEP 1: 타깃 로드
  const targets = loadTargets();
  console.log(`[buzz:pipeline] 타깃 ${targets.length}개 로드`);

  // STEP 2~5(수집/정제/질적분석/지표산출)는 BZ-1~BZ-6에서 순서대로 추가된다.
  // 각 STEP은 부분 실패가 전체를 죽이지 않도록 try/catch로 감싼다(본체와 동일 원칙).

  // STEP 6: 리포트 발송
  const result = await sendSkeletonReport(targets);
  console.log('[buzz:pipeline] 리포트 발송 결과:', result);
  return result;
}
