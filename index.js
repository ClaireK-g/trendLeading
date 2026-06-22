#!/usr/bin/env node
// CLI entry point for trendLeading pipeline
import cron from 'node-cron';
import { runPipeline, runScoringOnly, runWithLocalData } from './src/pipeline.js';
import { rankAllKeywords } from './src/scorer.js';
import { sendDailyDigest } from './src/alerter.js';
import { addToBlacklist, getBlacklist } from './src/blacklist.js';
import { initDB, upsertDailyStats, insertExtractedKeywords } from './src/db.js';
import { detectBursts, shouldAlert } from './src/scorer.js';
import config from './src/config.js';

const BANNER = `
======================================================
  trendLeading -- 100% Free F&B 마이크로 트렌드 감지
  GitHub Actions + Picuki + Gemini Flash + Telegram
======================================================
`;

const USAGE = `
사용법:
  node index.js run                    전체 파이프라인 1회 실행
  node index.js score                  스코어링만 실행 (데이터 수집 없음)
  node index.js digest                 일일 다이제스트 전송
  node index.js blacklist add <키워드>  블랙리스트에 키워드 추가
  node index.js blacklist list         블랙리스트 조회
  node index.js cron                   크론 스케줄러 시작 (09:00, 18:00 KST)
  node index.js test                   테스트 (API 키 없이도 목업 데이터로 동작)
`;

const TEST_POSTS = [
  `요즘 성수동에서 난리난 '크룽지' 먹어봤는데 진짜 미쳤다 크루아상이랑 쿵지를 합친 건데 겉바속촉에 크림치즈 필링이 환상적 #성수동맛집 #크룽지 #디저트스타그램`,
  `홍대 '달빛떡방'에서 인절미 크림라떼 마셨는데 이게 진짜 넥스트 트렌드 될 듯 떡 가루가 위에 뿌려져 있고 쫄깃한 인절미 토핑까지 #홍대카페 #인절미크림라떼 #달빛떡방`,
  `강남역 근처에 새로 오픈한 '소금빵연구소' 다녀왔어요 기본 소금빵도 맛있지만 명란소금빵이 시그니처! 줄이 30분 넘게 있었음 #소금빵연구소 #명란소금빵 #강남맛집`,
  `요즘 카페들 사이에서 유행하는 '흑임자 바스크치즈케이크' 드디어 먹어봄 고소함이 미쳤고 비주얼도 까만색이라 인스타감성 최고 여러 카페에서 출시 중 #흑임자바스크 #디저트 #카페추천`,
  `을지로 '떡볶이 오마카세' 가봤는데 코스로 나오는 떡볶이가 7가지나 됨 로제떡볶이부터 트러플떡볶이까지 진짜 새로운 경험이었다 #을지로맛집 #떡볶이오마카세 #푸드스타그램`,
  `연남동 골목에서 발견한 '버터떡' 전문점 상하이에서 유행하던 황유녠가오를 한국식으로 재해석했대 쫀득한 식감에 버터향이 가득 줄서서 먹는 이유 있음 #버터떡 #연남동맛집 #황유녠가오`,
];

const MOCK_KEYWORDS = [
  { keyword: '크룽지', category: '디저트', region: '성수', reason: '크루아상+룽지 합성 디저트로 최근 급부상', confidence_score: 5, co_keywords: ['성수카페', '디저트맛집'] },
  { keyword: '양쯔깐느', category: '메뉴', region: '광화문', reason: '설이동과 함께 언급되는 새로운 메뉴', confidence_score: 4, co_keywords: ['설이동', '광화문맛집'] },
  { keyword: '몽블랑크레페', category: '디저트', region: '연남동', reason: '밤크림 크레페 변형으로 SNS 인증 급증', confidence_score: 4, co_keywords: ['연남동카페', '크레페'] },
  { keyword: '호떡피자', category: '메뉴', region: '을지로', reason: '호떡+피자 퓨전 길거리 음식으로 웨이팅 발생', confidence_score: 3, co_keywords: ['을지로맛집'] },
];

async function main() {
  console.log(BANNER);

  const [,, command, ...rest] = process.argv;

  if (!command) {
    console.log(USAGE);
    process.exit(0);
  }

  switch (command) {
    case 'run': {
      if (!process.env.GEMINI_API_KEY) {
        console.error('[error] GEMINI_API_KEY 환경변수가 설정되지 않았습니다.');
        console.error('[error] export GEMINI_API_KEY=your_key 또는 .env 파일에 추가하세요.');
        process.exit(1);
      }
      const result = await runPipeline();
      console.log('\n결과:', result);
      break;
    }

    case 'score': {
      const result = await runScoringOnly();
      console.log(`\n스코어링 완료: 버스트 ${result.burstsDetected}건, 알림 ${result.alertsSent}건`);
      break;
    }

    case 'digest': {
      initDB();
      const ranked = await rankAllKeywords();
      const result = await sendDailyDigest(ranked);
      console.log('\n다이제스트 전송 결과:', result);
      break;
    }

    case 'blacklist': {
      const subcommand = rest[0];
      if (subcommand === 'add') {
        const keyword = rest.slice(1).join(' ');
        if (!keyword) {
          console.error('키워드를 입력하세요: node index.js blacklist add <키워드>');
          process.exit(1);
        }
        addToBlacklist(keyword);
        console.log(`블랙리스트에 추가됨: "${keyword}"`);
      } else if (subcommand === 'list') {
        const list = getBlacklist();
        if (list.length === 0) {
          console.log('블랙리스트가 비어있습니다.');
        } else {
          console.log(`블랙리스트 (${list.length}건):`);
          list.forEach((kw) => console.log(`  - ${kw}`));
        }
      } else {
        console.log('사용법: node index.js blacklist [add <키워드> | list]');
      }
      break;
    }

    case 'cron': {
      console.log('[cron] 스케줄러 시작 - 매일 09:00, 18:00 (KST) 실행');
      console.log('[cron] 종료하려면 Ctrl+C를 누르세요.\n');

      // 09:00 KST = 00:00 UTC, 18:00 KST = 09:00 UTC
      cron.schedule('0 0 * * *', async () => {
        console.log(`\n[cron] ${new Date().toISOString()} 오전 파이프라인 시작`);
        try {
          const result = await runPipeline();
          console.log('[cron] 오전 파이프라인 완료:', result);
        } catch (err) {
          console.error('[cron] 오전 파이프라인 실패:', err.message);
        }
      }, { timezone: 'Asia/Seoul', scheduled: true });

      cron.schedule('0 18 * * *', async () => {
        console.log(`\n[cron] ${new Date().toISOString()} 오후 파이프라인 시작`);
        try {
          const result = await runPipeline();
          console.log('[cron] 오후 파이프라인 완료:', result);
        } catch (err) {
          console.error('[cron] 오후 파이프라인 실패:', err.message);
        }
      }, { timezone: 'Asia/Seoul', scheduled: true });

      // Keep process alive
      process.on('SIGINT', () => {
        console.log('\n[cron] 스케줄러 종료');
        process.exit(0);
      });
      break;
    }

    case 'test': {
      console.log('[test] 테스트 데이터로 파이프라인 검증 시작\n');

      if (!process.env.GEMINI_API_KEY) {
        // Dry-run mode with mock data
        console.log('[test] GEMINI_API_KEY 미설정 → 목업 데이터로 스코어링 테스트\n');
        initDB();

        const today = new Date().toISOString().slice(0, 10);
        console.log(`[test] ${MOCK_KEYWORDS.length}개 목업 키워드 DB 삽입 중...`);

        for (const kw of MOCK_KEYWORDS) {
          insertExtractedKeywords([kw], null);
          upsertDailyStats(kw.keyword, today, `mock_account`, kw.co_keywords);
          // Insert a few more mentions to make scoring interesting
          for (let i = 0; i < kw.confidence_score; i++) {
            upsertDailyStats(kw.keyword, today, `mock_account_${i}`, kw.co_keywords);
          }
        }

        console.log('[test] 스코어링 실행 중...\n');
        const ranked = await rankAllKeywords();
        console.log(`[test] 키워드 랭킹 (${ranked.length}건):`);
        for (const kw of ranked) {
          console.log(`  ${kw.verdict} ${kw.keyword} (score: ${kw.trendScore.toFixed(2)}, burst: ${kw.burstRatio.toFixed(2)}x)`);
        }

        const bursts = await detectBursts(config.scoring.burstThreshold);
        console.log(`\n[test] 버스트 감지: ${bursts.length}건`);
        for (const b of bursts) {
          console.log(`  - ${b.keyword} (ratio: ${b.burstRatio.toFixed(2)}x)`);
        }

        console.log('\n[test] 목업 테스트 완료 (API 키 없이 스코어링 파이프라인 검증 성공)');
      } else {
        // Full test with LLM extraction
        console.log(`[test] ${TEST_POSTS.length}개 샘플 포스트 사용 (LLM 추출 포함)`);
        const result = await runWithLocalData(TEST_POSTS);
        console.log('\n[test] 테스트 완료:', result);
      }
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
