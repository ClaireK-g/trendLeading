#!/usr/bin/env node
// CLI entry point for buzzAnalysis — src/의 어떤 파일도 import하지 않는다 (완전 격리 원칙,
// docs/buzz-analysis-design.md §1). trendLeading 본체와 소스·DB·워크플로가 섞이지 않는다.
import { runBuzzPipeline } from './pipeline.js';
import { loadTargets } from './targets.js';
import { formatReport } from './reporter.js';
import { initDB, upsertDailyStat, insertBuzzPost, getPostChannelCounts, updateSentimentCounts, setPostSentiment, getPostByUrl, upsertAssocWord } from './db.js';
import { computeVolumeMetrics, computeChannelShare, computeSentimentMetrics, computeAssocWordsMetrics } from './metrics.js';
import { cleanTargetPosts } from './cleaner.js';

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

        // 목업 정제 함정 — 협찬 글(광고)/동음이의 글/도배 3연글 + 정상 글 1건 (BZ-3 DoD)
        const today = new Date().toISOString().slice(0, 10);
        const nowIso = new Date().toISOString();
        insertBuzzPost({ target: mockTarget.id, channel: 'blog', url: 'https://trap-ad.example.com/1', title: '[협찬] 예시 타깃 솔직 리뷰', description: '이 포스팅은 원고료를 받아 작성되었습니다', publishedAt: today, collectedAt: nowIso });
        insertBuzzPost({ target: mockTarget.id, channel: 'blog', url: 'https://trap-homonym.example.com/1', title: '예시 검색어 레시피 재료 구매 후기', description: '마트에서 예시 검색어 1kg 사왔어요 요리에 씁니다', publishedAt: today, collectedAt: nowIso });
        insertBuzzPost({ target: mockTarget.id, channel: 'blog', url: 'https://trap-spam.example.com/1', title: '예시 타깃 완전 대박 신상 후기', description: '지금 바로 주문하세요', publishedAt: today, collectedAt: nowIso });
        insertBuzzPost({ target: mockTarget.id, channel: 'blog', url: 'https://trap-spam.example.com/2', title: '예시 타깃 완전 대박 신상 리뷰', description: '지금 바로 주문하세요', publishedAt: today, collectedAt: nowIso });
        insertBuzzPost({ target: mockTarget.id, channel: 'blog', url: 'https://trap-spam.example.com/3', title: '예시 타깃 완전 대박 신상 소개', description: '지금 바로 주문하세요', publishedAt: today, collectedAt: nowIso });
        insertBuzzPost({ target: mockTarget.id, channel: 'blog', url: 'https://real.example.com/1', title: '진짜 예시 타깃 먹어본 솔직 후기', description: '웨이팅 30분 했지만 맛있었어요', publishedAt: today, collectedAt: nowIso });

        const cleanResult = cleanTargetPosts(mockTarget.id, today, ['레시피 재료']);
        console.log(`\n[buzz:test] 정제 함정 결과: 광고 ${cleanResult.adCount}건, 도배 ${cleanResult.spamCount}건, 동음이의 ${cleanResult.homonymCount}건 (기대값: 1/3/1)`);

        const postCounts = getPostChannelCounts(mockTarget.id, today);
        console.log('[buzz:test] 채널별 클린/노이즈 게시물 수:', postCounts);

        // 목업 감성 리스크 시나리오 — 오늘 부정 급증, 어제는 평온 (BZ-4 DoD, 키 없이 검증)
        const yesterday = (() => {
          const d = new Date();
          d.setDate(d.getDate() - 1);
          return d.toISOString().slice(0, 10);
        })();
        updateSentimentCounts(mockTarget.id, today, 'blog', { pos: 5, neg: 8, neu: 2 });
        updateSentimentCounts(mockTarget.id, yesterday, 'blog', { pos: 10, neg: 1, neu: 9 });
        insertBuzzPost({ target: mockTarget.id, channel: 'blog', url: 'https://negative.example.com/1', title: '예시 타깃 위생 논란 터졌다', description: '이물질 발견 후기 다수', publishedAt: today, collectedAt: nowIso });
        const negPost = getPostByUrl(mockTarget.id, 'https://negative.example.com/1');
        if (negPost) setPostSentiment(negPost.id, 'negative');

        const sent = computeSentimentMetrics(mockTarget.id);
        console.log(
          `\n[buzz:test] "${mockTarget.name}" 감성 지표: 😊 ${sent.posRatio.toFixed(1)}% 😐 ${sent.neuRatio.toFixed(1)}% 😡 ${sent.negRatio.toFixed(1)}% ` +
          `(전일 대비 +${sent.negDeltaPP.toFixed(1)}%p) → 리스크: ${sent.isRisk ? '🚨 감지' : '없음'}`
        );

        // 목업 연관어 — 신규 진입어 판정(직전 7일 톱10 비교) 검증 (BZ-5 DoD)
        const day = (n) => {
          const d = new Date();
          d.setDate(d.getDate() - n);
          return d.toISOString().slice(0, 10);
        };
        upsertAssocWord(mockTarget.id, day(3), '쫀득', 15);
        upsertAssocWord(mockTarget.id, day(3), '딸기', 12);
        upsertAssocWord(mockTarget.id, day(2), '웨이팅', 8);
        upsertAssocWord(mockTarget.id, day(1), '선물', 6);
        upsertAssocWord(mockTarget.id, today, '쫀득', 21);
        upsertAssocWord(mockTarget.id, today, '딸기', 18);
        upsertAssocWord(mockTarget.id, today, '웨이팅', 11);
        upsertAssocWord(mockTarget.id, today, '선물', 9);
        upsertAssocWord(mockTarget.id, today, '품절대란', 15);

        const assoc = computeAssocWordsMetrics(mockTarget.id);
        console.log(`\n[buzz:test] "${mockTarget.name}" 연관어: ${assoc.words.map((w) => `${w.word}(${w.count})`).join(' · ')}`);
        console.log(`[buzz:test] 신규 진입어: ${assoc.newEntries.join(', ') || '없음'} (기대값: 품절대란)`);
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
