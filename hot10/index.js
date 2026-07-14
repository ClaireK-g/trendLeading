#!/usr/bin/env node
// CLI entry point for hot10(buzzAnalysis) — src/·buzz/의 어떤 파일도 import하지 않는다
// (완전 격리 원칙, docs/hot10-design.md §1).
import { runCollect, runReport } from './pipeline.js';
import { initDB, upsertRawTopic, getRawTopic } from './db.js';
import { formatSkeletonReport } from './reporter.js';
import { parseGoogleTrendsRSS, parseWikiTop, parseNaverRanking, parseTheqooHot } from './sources-kr.js';

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

      // 구글트렌드 RSS 파서 검증 (목업 XML, 실제 페치 없음) — HT-1 DoD
      const mockRSS = `<?xml version="1.0"?>
<rss><channel>
<item><title>테스트키워드1</title><ht:approx_traffic xmlns:ht="https://trends.google.com/trending/rss">10000+</ht:approx_traffic><link>https://trends.google.com/trending?q=1</link></item>
<item><title>테스트키워드2</title><ht:approx_traffic xmlns:ht="https://trends.google.com/trending/rss">5000+</ht:approx_traffic><link>https://trends.google.com/trending?q=2</link></item>
</channel></rss>`;
      const gtrendsItems = parseGoogleTrendsRSS(mockRSS);
      console.log(`[hot10:test] 구글트렌드 파서: ${gtrendsItems.length}건 (기대값 2)`, gtrendsItems);

      // 위키 파서 검증 (목업 JSON) — 대문/특수: 네임스페이스 제외 확인
      const mockWiki = {
        items: [{
          articles: [
            { article: '대문', views: 999999, rank: 1 },
            { article: '테스트_문서', views: 5000, rank: 2 },
            { article: '특수:검색', views: 3000, rank: 3 },
            { article: '진짜_문서', views: 2000, rank: 4 },
          ],
        }],
      };
      const wikiItems = parseWikiTop(mockWiki);
      console.log(`[hot10:test] 위키 파서: ${wikiItems.length}건 (기대값 2 — 대문/특수: 제외)`, wikiItems);

      // 네이버 뉴스랭킹 파서 검증 (목업 HTML) — 언론사별 박스에서 1위 기사만 추출 확인 — HT-2 DoD
      const mockNaverHtml = `
        <div class="rankingnews_box">
          <strong class="rankingnews_name">테스트일보</strong>
          <ul class="rankingnews_list">
            <li><div class="list_content"><a class="list_title" href="/article/001/1">테스트기사1위</a></div></li>
            <li><div class="list_content"><a class="list_title" href="/article/001/2">테스트기사2위</a></div></li>
          </ul>
        </div>
        <div class="rankingnews_box">
          <strong class="rankingnews_name">테스트신문</strong>
          <ul class="rankingnews_list">
            <li><div class="list_content"><a class="list_title" href="/article/002/1">다른언론사1위기사</a></div></li>
          </ul>
        </div>`;
      const naverItems = parseNaverRanking(mockNaverHtml);
      console.log(`[hot10:test] 네이버뉴스랭킹 파서: ${naverItems.length}건 (기대값 2 — 언론사별 1위만)`, naverItems);

      // 더쿠 HOT 파서 검증 (목업 HTML) — HT-2 DoD
      const mockTheqooHtml = `
        <table><tbody>
          <tr><td class="title"><a class="subject" href="/hot/1111">더쿠글제목1</a></td></tr>
          <tr><td class="title"><a class="subject" href="/hot/2222">더쿠글제목2</a></td></tr>
        </tbody></table>`;
      const theqooItems = parseTheqooHot(mockTheqooHtml);
      console.log(`[hot10:test] 더쿠 파서: ${theqooItems.length}건 (기대값 2)`, theqooItems);

      // 라운드 병합(누적 데이터셋) 검증 — 같은 라운드 재실행은 seen_count 불변, best_rank만 갱신,
      // 다음 라운드는 seen_count 증가 (BZ-1 목업 시딩과 동일하게 __test- 접두로 격리)
      const bucket1 = new Date('2026-07-15T03:00:00Z'); // 6시간 버킷 A
      const bucket2 = new Date('2026-07-15T09:00:00Z'); // 6시간 버킷 B (다음 라운드)
      const date = bucket1.toISOString().slice(0, 10);

      upsertRawTopic({ region: 'kr', source: 'gtrends', title: '__test-topic', rank: 5, now: bucket1 });
      upsertRawTopic({ region: 'kr', source: 'gtrends', title: '__test-topic', rank: 3, now: bucket1 }); // 같은 라운드 재실행
      const afterSameRound = getRawTopic('kr', 'gtrends', date, '__test-topic');
      console.log(
        `[hot10:test] 같은 라운드 재실행: seenCount=${afterSameRound.seenCount}(기대값 1), bestRank=${afterSameRound.bestRank}(기대값 3)`
      );

      upsertRawTopic({ region: 'kr', source: 'gtrends', title: '__test-topic', rank: 1, now: bucket2 }); // 다음 라운드
      const afterNextRound = getRawTopic('kr', 'gtrends', date, '__test-topic');
      console.log(
        `[hot10:test] 다음 라운드: seenCount=${afterNextRound.seenCount}(기대값 2), bestRank=${afterNextRound.bestRank}(기대값 1)`
      );

      const message = formatSkeletonReport();
      console.log('\n[hot10:test] 생성된 리포트 미리보기:\n');
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
