#!/usr/bin/env node
// CLI entry point for buzzAnalysis — src/의 어떤 파일도 import하지 않는다 (완전 격리 원칙,
// docs/buzz-analysis-design.md §1). trendLeading 본체와 소스·DB·워크플로가 섞이지 않는다.
import { runBuzzPipeline } from './pipeline.js';
import { loadTargets } from './targets.js';
import { formatSkeletonReport } from './reporter.js';
import { initDB } from './db.js';

const BANNER = `
======================================================
  buzzAnalysis -- 화제성 분석 데일리 리포팅
  네이버 검색/데이터랩 + Gemini Flash + Telegram
======================================================
`;

const USAGE = `
사용법:
  node buzz/index.js run     전체 파이프라인 1회 실행 (텔레그램 발송)
  node buzz/index.js test    테스트 (텔레그램 발송 없이 콘솔 출력만)
`;

async function main() {
  console.log(BANNER);

  const [, , command] = process.argv;

  if (!command) {
    console.log(USAGE);
    process.exit(0);
  }

  switch (command) {
    case 'run': {
      const result = await runBuzzPipeline();
      console.log('\n결과:', result);
      break;
    }

    case 'test': {
      console.log('[buzz:test] 목업 검증 시작 (텔레그램 발송 없음)\n');
      initDB();
      const targets = loadTargets();
      console.log(`[buzz:test] 타깃 ${targets.length}개 로드`);
      const message = formatSkeletonReport(targets);
      console.log('\n[buzz:test] 생성된 리포트 미리보기:\n');
      console.log(message);
      console.log('\n[buzz:test] 목업 테스트 완료');
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
