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
  node index.js cron                   크론 스케줄러 시작 (05:00 KST)
  node index.js test                   테스트 (API 키 없이도 목업 데이터로 동작)
`;

const TEST_POSTS = [
  // [TRAP: 구식 - 버터떡]
  `연남동 골목에서 발견한 '버터떡' 전문점 황유녠가오를 한국식으로 재해석했대 줄서서 먹는 이유 있음 #버터떡 #연남동맛집`,
  // [TRAP: 이미 대중화 - 얼먹젤리]
  `GS25에서 하리보 골드베렌 냉동실에 넣으면 완전 다른 식감!! 얼먹젤리 미쳤다 매출 1786% 올랐다는데 #얼먹젤리`,
  // [TRAP: 계절 반복 - 콩국수]
  `한남동 콩국수 디저트화 현상ㅋㅋ 콩빙이래 올여름 대세 될 듯 #콩빙`,
  // [REAL: 설이동 - 광화문 핫플, 복수 계정 언급]
  `광화문 갈 일 있으면 설이동 무조건 가라.. 평일 낮에도 웨이팅 장난 아님. 양쯔깐느 먹고 2차로 가기 딱 좋음 진짜 요즘 여기 아니면 광화문 갈 이유 없다ㅋㅋ #설이동 #광화문맛집 #종로맛집`,
  `종로 설이동 드디어 가봤다!! 친구가 계속 가자고 해서 갔는데 왜 난리인지 알겠음 음식도 좋은데 분위기가 진짜 힙함 요즘 광화문 직장인들 점심에 여기 줄 선다고 들었는데 실화였음ㅠ 다음엔 저녁에 가볼 예정 #설이동 #광화문 #종로핫플`,
  `오늘 설이동에서 회식했는데 팀원들 다 감동함ㅋㅋ 아직 인스타에서 많이 안 보이는데 곧 터질 듯 일찍 가세요 진짜로 #설이동 #광화문맛집 #회식장소추천`,
  // [REAL: 보카도버터 - 실존 매장]
  `성수 보카도버터 본점 마시멜로우 샌드 이거 진짜 신세계 겉바삭 안쫀득 식감 두 가지라 뇌 혼란ㅋㅋ 주말 웨이팅 1시간 각오 #보카도버터 #성수디저트`,
  // [REAL: 우베 - 글로벌 트렌드]
  `우베(Ube) 디저트 드디어 한국에도!! 필리핀 보라색 참마인데 인스타에서 next matcha라고 난리 성수에 우베라떼 파는 카페 생김 보라색 비주얼 미쳤음 #우베 #Ube`,
];

const MOCK_KEYWORDS = [
  { keyword: '크룽지', search_keyword: '성수 크룽지', category: '디저트', region: '성수', reason: '크루아상+룽지 합성 디저트로 최근 급부상', confidence_score: 5, co_keywords: ['성수카페', '디저트맛집'] },
  { keyword: '양쯔깐느', search_keyword: '광화문 양쯔깐느', category: '메뉴', region: '광화문', reason: '설이동과 함께 언급되는 새로운 메뉴', confidence_score: 4, co_keywords: ['설이동', '광화문맛집'] },
  { keyword: '몽블랑크레페', search_keyword: '연남동 몽블랑크레페', category: '디저트', region: '연남동', reason: '밤크림 크레페 변형으로 SNS 인증 급증', confidence_score: 4, co_keywords: ['연남동카페', '크레페'] },
  { keyword: '호떡피자', search_keyword: '을지로 호떡피자', category: '메뉴', region: '을지로', reason: '호떡+피자 퓨전 길거리 음식으로 웨이팅 발생', confidence_score: 3, co_keywords: ['을지로맛집'] },
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
      console.log('[cron] 스케줄러 시작 - 매일 05:00 (KST) 실행');
      console.log('[cron] 종료하려면 Ctrl+C를 누르세요.\n');

      // 05:00 KST
      cron.schedule('0 5 * * *', async () => {
        console.log(`\n[cron] ${new Date().toISOString()} 파이프라인 시작`);
        try {
          const result = await runPipeline();
          console.log('[cron] 파이프라인 완료:', result);
        } catch (err) {
          console.error('[cron] 파이프라인 실패:', err.message);
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
