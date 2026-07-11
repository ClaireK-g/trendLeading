// 검색가능성 검증 — STEP 4.5 (blog-traffic-dev 스킬 §3, "콘크리트" 사건 재발 방지)
// 추출된 키워드가 실제로 네이버에서 검색되는지, 경쟁 블로그 문서 수(공급 지표)는 얼마인지 확인한다.
import axios from 'axios';
import config from './config.js';
import { setSearchability } from './db.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MAX_VERIFY = 30; // 호출량 제한 — 상위 후보만 검증
const STOPWORDS = ['디저트', '메뉴', '맛집', '카페', '신상', '팝업', '트렌드'];

function extractTokens(text) {
  if (!text) return [];
  return text
    .replace(/[()（）]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOPWORDS.includes(t));
}

function stripHtml(s) {
  return (s || '').replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ');
}

async function verifyOne(term) {
  const { clientId, clientSecret } = config.naverSearch || {};
  const res = await axios.get('https://openapi.naver.com/v1/search/blog.json', {
    params: { query: term, display: 5, sort: 'date' },
    headers: {
      'X-Naver-Client-Id': clientId,
      'X-Naver-Client-Secret': clientSecret,
    },
    timeout: 10000,
  });

  const total = res.data?.total ?? 0;
  const items = res.data?.items || [];

  if (total === 0) return { docCount: 0, searchable: false };

  // 상위 5건 제목에 키워드 핵심 토큰이 하나도 없으면 동음이의 오염 의심 (예: "콘크리트" → 건축자재 글만 나옴)
  const tokens = extractTokens(term);
  if (tokens.length) {
    const titles = items.map((it) => stripHtml(it.title)).join(' ');
    const matched = tokens.some((t) => titles.includes(t));
    if (!matched) return { docCount: total, searchable: false };
  }

  return { docCount: total, searchable: true };
}

/**
 * keywords: extractor 출력 배열 [{keyword, search_keyword, ...}]
 * 각 항목에 searchable(boolean)·docCount(number)를 부여하고 DB(keyword_daily_stats)에도 반영한다.
 * API 키 없거나 전체 실패 시 원본 배열을 그대로 반환한다(fail-open) — 검증 안 된 항목은 필드가 비어있다.
 */
export async function verifySearchability(keywords) {
  const { clientId, clientSecret } = config.naverSearch || {};
  if (!clientId || !clientSecret || !keywords.length) return keywords;

  const today = new Date().toISOString().slice(0, 10);
  const target = keywords.slice(0, MAX_VERIFY);

  for (const kw of target) {
    const term = kw.search_keyword || kw.keyword;
    if (!term) continue;

    try {
      const result = await verifyOne(term);
      kw.searchable = result.searchable;
      kw.docCount = result.docCount;
      try {
        setSearchability(kw.keyword, today, { docCount: result.docCount, searchable: result.searchable });
      } catch (dbErr) {
        console.warn(`[searchability] DB 반영 실패 (${kw.keyword}): ${dbErr.message}`);
      }
    } catch (err) {
      console.warn(`[searchability] 검증 실패(${term}): ${err.message}`);
    }

    await sleep(300);
  }

  const flagged = target.filter((k) => k.searchable === false).length;
  if (flagged) console.log(`[searchability] 검색 불가/의심 키워드 ${flagged}건 강등`);

  return keywords;
}

export default { verifySearchability };
