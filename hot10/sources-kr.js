// hot10/sources-kr.js — STEP C1 한국 수집. docs/hot10-design.md §6 HT-1(구글트렌드 KR+위키 KO)
// 네이버 뉴스랭킹·더쿠는 HT-2에서 추가된다.
// 페치(네트워크)와 파서(순수 함수)를 분리해 파서만 목업 입력으로 단위 검증할 수 있게 한다 —
// 이 개발 환경은 아웃바운드 프록시가 외부 도메인을 차단해 실제 수집 검증은 GitHub Actions로 한다.
import axios from 'axios';
import * as cheerio from 'cheerio';
import { upsertRawTopic } from './db.js';

const USER_AGENT = 'Mozilla/5.0 (compatible; hot10-daily-report/1.0; +buzzAnalysis)';

// ---------------------------------------------------------------------------
// 구글트렌드 KR — RSS 급상승 검색어
// ---------------------------------------------------------------------------
export async function fetchGoogleTrendsKR() {
  const res = await axios.get('https://trends.google.com/trending/rss?geo=KR', {
    timeout: 10000,
    headers: { 'User-Agent': USER_AGENT },
  });
  return res.data;
}

// RSS XML 문자열 → [{title, trafficHint, url}] (소스 내 순서 = 순위)
export function parseGoogleTrendsRSS(xml) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const items = [];

  $('item').each((i, el) => {
    const title = $(el).find('title').first().text().trim();
    if (!title) return;
    const trafficHint = $(el).find('ht\\:approx_traffic, approx_traffic').first().text().trim() || null;
    const url = $(el).find('link').first().text().trim() || null;
    items.push({ title, trafficHint, url });
  });

  return items;
}

// ---------------------------------------------------------------------------
// 위키피디아 한국어판 — 전일 최다 조회 (Wikimedia REST, 공식 무키 API)
// ---------------------------------------------------------------------------
export async function fetchWikiTopKO() {
  const d = new Date();
  d.setDate(d.getDate() - 1); // 당일 데이터는 아직 집계되지 않아 전일 데이터를 쓴다(설계서 §2.1)
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');

  const res = await axios.get(
    `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/ko.wikipedia/all-access/${y}/${m}/${day}`,
    { timeout: 10000, headers: { 'User-Agent': `${USER_AGENT} (contact: none)` } }
  );
  return res.data;
}

// 메인페이지·특수:/위키백과: 등 콘텐츠 문서가 아닌 항목 제외
const WIKI_EXCLUDE_PREFIXES = ['특수:', '위키백과:', '분류:', '파일:', '틀:', '위키프로젝트:', 'Wikipedia:', 'Special:', 'Category:', 'File:'];
const WIKI_EXCLUDE_TITLES = new Set(['대문', 'Main_Page']);

// Wikimedia REST 응답 → [{title, views, rank}] 상위 limit개 (콘텐츠 문서만)
export function parseWikiTop(data, limit = 20) {
  const articles = data?.items?.[0]?.articles || [];
  const filtered = articles.filter((a) => {
    const title = a.article || '';
    if (WIKI_EXCLUDE_TITLES.has(title)) return false;
    return !WIKI_EXCLUDE_PREFIXES.some((p) => title.startsWith(p));
  });

  return filtered.slice(0, limit).map((a) => ({
    title: (a.article || '').replace(/_/g, ' '),
    views: a.views,
    rank: a.rank,
  }));
}

// ---------------------------------------------------------------------------
// 수집 오케스트레이션 — hot10_raw에 누적 병합
// ---------------------------------------------------------------------------
export async function collectKR() {
  const results = { gtrends: 0, wiki: 0 };

  try {
    const xml = await fetchGoogleTrendsKR();
    const items = parseGoogleTrendsRSS(xml);
    items.forEach((item, idx) => {
      upsertRawTopic({
        region: 'kr',
        source: 'gtrends',
        title: item.title,
        rank: idx + 1,
        trafficHint: item.trafficHint,
        url: item.url,
      });
    });
    results.gtrends = items.length;
  } catch (err) {
    console.warn(`[hot10:sources-kr] gtrends 수집 실패 (무시): ${err.message}`);
  }

  try {
    const data = await fetchWikiTopKO();
    const items = parseWikiTop(data);
    items.forEach((item) => {
      upsertRawTopic({
        region: 'kr',
        source: 'wiki',
        title: item.title,
        rank: item.rank,
        trafficHint: String(item.views),
        url: `https://ko.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`,
      });
    });
    results.wiki = items.length;
  } catch (err) {
    console.warn(`[hot10:sources-kr] wiki 수집 실패 (무시): ${err.message}`);
  }

  console.log(`[hot10:sources-kr] 수집 완료 — gtrends ${results.gtrends}건, wiki ${results.wiki}건`);
  return results;
}
