// 네이버 검색/데이터랩 API 클라이언트 — src/scraper.js·src/probe.js와 완전 독립 구현
// (buzz 모듈 격리 원칙, docs/buzz-analysis-design.md §1)
import axios from 'axios';
import config from '../config.js';

// endpoint: blog | news | cafearticle
export async function searchNaver(endpoint, query, display = 100) {
  const { clientId, clientSecret } = config.naverSearch || {};
  if (!clientId || !clientSecret) {
    throw new Error('NAVER_SEARCH_CLIENT_ID/SECRET 미설정');
  }

  const res = await axios.get(`https://openapi.naver.com/v1/search/${endpoint}.json`, {
    params: { query, display, sort: 'date' },
    headers: {
      'X-Naver-Client-Id': clientId,
      'X-Naver-Client-Secret': clientSecret,
    },
    timeout: 10000,
  });

  return { items: res.data?.items || [], total: res.data?.total ?? 0 };
}

// 뉴스 API의 pubDate(RFC822)·블로그 API의 postdate(yyyyMMdd)를 YYYY-MM-DD로 정규화.
// 카페 검색 API는 날짜 필드를 제공하지 않아 null을 반환한다(src/scraper.js와 동일한 API 제약).
export function parsePublishedDate(item) {
  const raw = item.pubDate || item.postdate;
  if (!raw) return null;

  let published;
  if (/^\d{8}$/.test(raw)) {
    published = new Date(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`);
  } else {
    published = new Date(raw);
  }
  if (Number.isNaN(published.getTime())) return null;

  return published.toISOString().slice(0, 10);
}

// keywordGroups: [{groupName, keywords: [kw]}] — 1요청 최대 5그룹 (네이버 API 제약)
export async function searchDatalab(keywordGroups, startDate, endDate) {
  const { clientId, clientSecret } = config.naverDatalab || {};
  if (!clientId || !clientSecret) {
    throw new Error('NAVER_DATALAB_CLIENT_ID/SECRET 미설정');
  }

  const res = await axios.post(
    'https://openapi.naver.com/v1/datalab/search',
    { startDate, endDate, timeUnit: 'date', keywordGroups },
    {
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    }
  );

  return res.data?.results || [];
}
