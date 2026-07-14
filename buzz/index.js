#!/usr/bin/env node
// CLI entry point for buzzAnalysis — src/의 어떤 파일도 import하지 않는다 (완전 격리 원칙,
// docs/buzz-analysis-design.md §1). trendLeading 본체와 소스·DB·워크플로가 섞이지 않는다.
import { runBuzzPipeline } from './pipeline.js';
import { loadTargets } from './targets.js';
import { formatReport } from './reporter.js';
import { initDB, upsertDailyStat } from './db.js';
import { computeVolumeMetrics, computeChannelShare } from './metrics.js';

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
      console.log('[buzz:test] 목업 검증 시작 (텔레그램 발송 없음, 네트워크 호출 없음)\n');
      initDB();
      const targets = loadTargets();
      console.log(`[buzz:test] 타깃 ${targets.length}개 로드`);

      // 목업 3일치 버즈량 시딩 — 증감 배율 계산 검증 (BZ-1 DoD)
      const mockTarget = targets[0];
      if (mockTarget) {
        const mockVolumes = [10, 20, 40]; // [그제, 어제, 오늘]
        mockVolumes.forEach((volume, i) => {
          const daysAgo = mockVolumes.length - 1 - i;
          const d = new Date();
          d.setDate(d.getDate() - daysAgo);
          upsertDailyStat({
            target: mockTarget.id,
            date: d.toISOString().slice(0, 10),
            channel: 'blog',
            volume,
            totalHint: volume * 100,
          });
        });

        const vol = computeVolumeMetrics(mockTarget.id);
        console.log(`\n[buzz:test] "${mockTarget.name}" 버즈량 지표 (목업 10→20→40):`);
        console.log(`  오늘 ${vol.todayVolume}건 / 전일비 ${vol.vsYesterday?.toFixed(2)}x / 주평균비 ${vol.vs7dayAvg?.toFixed(2)}x`);
        console.log(`  스파크라인: ${vol.sparkline}`);

        // 목업 채널별 분포 시딩 — 비율 합 100% ±1, 급변(±15%p) 화살표 로직 검증 (BZ-2 DoD)
        const daysAgoDate = (n) => {
          const d = new Date();
          d.setDate(d.getDate() - n);
          return d.toISOString().slice(0, 10);
        };
        upsertDailyStat({ target: mockTarget.id, date: daysAgoDate(2), channel: 'cafe', volume: 30, totalHint: 3000 });
        upsertDailyStat({ target: mockTarget.id, date: daysAgoDate(4), channel: 'news', volume: 15, totalHint: 1500 });
        upsertDailyStat({ target: mockTarget.id, date: daysAgoDate(10), channel: 'blog', volume: 50, totalHint: 5000 });
        upsertDailyStat({ target: mockTarget.id, date: daysAgoDate(11), channel: 'cafe', volume: 45, totalHint: 4500 });
        upsertDailyStat({ target: mockTarget.id, date: daysAgoDate(12), channel: 'news', volume: 5, totalHint: 500 });

        const shares = computeChannelShare(mockTarget.id);
        const shareSum = shares.reduce((s, c) => s + c.share, 0);
        console.log(`\n[buzz:test] "${mockTarget.name}" 채널 분포 (비율 합 ${shareSum.toFixed(1)}%):`);
        for (const s of shares) {
          console.log(`  ${s.label}: ${s.share.toFixed(1)}% (전주 대비 ${s.deltaPP >= 0 ? '+' : ''}${s.deltaPP.toFixed(1)}%p) ${s.arrow}`);
        }
      }

      const message = formatReport(targets);
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
