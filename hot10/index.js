#!/usr/bin/env node
// CLI entry point for hot10(buzzAnalysis) — src/·buzz/의 어떤 파일도 import하지 않는다
// (완전 격리 원칙, docs/hot10-design.md §1).
import { runCollect, runReport } from './pipeline.js';
import { initDB } from './db.js';
import { formatSkeletonReport } from './reporter.js';

const BANNER = `
======================================================
  buzzAnalysis (hot10) -- 분야 무관 한국/글로벌 화제성 Top10
  구글트렌드/위키/네이버뉴스랭킹/더쿠/레딧/HN + Gemini + Telegram
======================================================
`;

const USAGE = `
사용법:
  node hot10/index.js collect   raw 수집만 1회 실행 (LLM 0콜, 하루 4회 크론용)
  node hot10/index.js report    수집 보강 + 정규화·랭킹·리포트 발송 (하루 1회 아침용)
  node hot10/index.js run       collect + report 전체 실행 (수동 전체 실행용)
  node hot10/index.js test      테스트 (텔레그램 발송 없이 콘솔 출력만)
`;

async function main() {
  console.log(BANNER);

  const [, , command] = process.argv;

  if (!command) {
    console.log(USAGE);
    process.exit(0);
  }

  switch (command) {
    case 'collect': {
      const result = await runCollect();
      console.log('\n결과:', result);
      break;
    }

    case 'report': {
      const result = await runReport();
      console.log('\n결과:', result);
      break;
    }

    case 'run': {
      await runCollect();
      const result = await runReport();
      console.log('\n결과:', result);
      break;
    }

    case 'test': {
      console.log('[hot10:test] 목업 검증 시작 (텔레그램 발송 없음, 네트워크 호출 없음)\n');
      initDB();
      const message = formatSkeletonReport();
      console.log('[hot10:test] 생성된 리포트 미리보기:\n');
      console.log(message);
      console.log('\n[hot10:test] 목업 테스트 완료');
      break;
    }

    default:
      console.error(`알 수 없는 명령어: ${command}`);
      console.log(USAGE);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('치명적 오류:', err);
  process.exit(1);
});
