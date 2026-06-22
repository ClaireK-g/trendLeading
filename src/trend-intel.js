import axios from 'axios';

const GOOGLE_NEWS_URL = 'https://news.google.com/rss/search';
const NAVER_SEARCH_URL = 'https://openapi.naver.com/v1/search/news.json';

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function searchGoogleNews(query) {
  try {
    const url = `${GOOGLE_NEWS_URL}?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`;
    const res = await axios.get(url, { timeout: 10000 });
    const titles = [];
    const regex = /<title><!\[CDATA\[(.*?)\]\]><\/title>/g;
    let match;
    while ((match = regex.exec(res.data)) !== null) {
      titles.push(match[1]);
    }
    return titles.slice(1, 8);
  } catch {
    return [];
  }
}

export async function fetchTrendIntelligence() {
  const today = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
  console.log(`[trend-intel] ${today} 기준 최신 트렌드 수집 중...`);

  const queries = [
    '디저트 트렌드 2026 신상',
    '맛집 핫플 웨이팅 SNS',
    'F&B 신메뉴 인기 MZ',
    '인스타 디저트 유행',
  ];

  const allHeadlines = [];
  for (const q of queries) {
    const headlines = await searchGoogleNews(q);
    allHeadlines.push(...headlines);
    await sleep(500);
  }

  const unique = [...new Set(allHeadlines)].slice(0, 15);
  const brief = unique.length
    ? unique.map((h, i) => `${i + 1}. ${h}`).join('\n')
    : '(최신 뉴스 수집 실패 — 오프라인 모드로 동작)';

  console.log(`[trend-intel] ${unique.length}개 최신 뉴스 헤드라인 수집 완료`);

  return {
    date: today,
    headlines: brief,
    keywords: unique.join(' '),
  };
}
