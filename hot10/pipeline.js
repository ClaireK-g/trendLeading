// hot10/pipeline.js — buzzAnalysis 오케스트레이터 (docs/hot10-design.md §2.0)
// src/·buzz/의 어떤 파일도 import하지 않는다 — 완전 격리 원칙.
// 수집(collect)과 리포트(report)를 분리한다 — 수집은 하루 4회(LLM 0콜), 리포트는 하루 1회(LLM 2콜).
import { initDB } from './db.js';
import { collectKR } from './sources-kr.js';
import { sendSkeletonReport } from './reporter.js';

export async function runCollect() {
  console.log('[hot10:pipeline] 수집(collect) 시작');
  initDB();

  // STEP C1: 한국 수집 (구글트렌드 KR + 위키 KO — HT-1. 네이버 뉴스랭킹·더쿠는 HT-2에서 추가)
  try {
    await collectKR();
  } catch (err) {
    console.error('[hot10:pipeline] STEP C1 한국 수집 실패 (무시하고 계속 진행):', err.message);
  }

  // STEP C2: 글로벌 수집 (구글트렌드 US + 레딧 + 위키 EN + HN)는 HT-3에서 추가된다.

  console.log('[hot10:pipeline] 수집(collect) 완료');
  return { success: true };
}

// STEP R0~R4(당일 보강/정규화/랭킹/연속성/리포트)는 HT-1~HT-6에서 순서대로 추가된다.
export async function runReport() {
  console.log('[hot10:pipeline] 리포트(report) 시작');
  initDB();

  // STEP R0: 당일 수집분 보강 — 아침 최신 데이터 확보를 위해 collect 1회 포함
  try {
    await runCollect();
  } catch (err) {
    console.error('[hot10:pipeline] STEP R0 수집 보강 실패 (무시하고 계속 진행):', err.message);
  }

  // STEP R1~R3(정규화/랭킹/연속성)는 HT-4~HT-6에서 순서대로 추가된다.

  // STEP R4: 리포트 발송
  const result = await sendSkeletonReport();
  console.log('[hot10:pipeline] 리포트 발송 결과:', result);
  return result;
}
