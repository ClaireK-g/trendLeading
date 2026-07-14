// hot10/sources-kr.js — STEP C1 한국 수집. docs/hot10-design.md §6 HT-1(구글트렌드 KR+위키 KO)
// + HT-2(네이버 뉴스랭킹+더쿠 HOT — 한국 대중 여론 보강, 네이트판은 옵션 대체재)
// 페치(네트워크)와 파서(순수 함수)를 분리해 파서만 목업 입력으로 단위 검증할 수 있게 한다 —
// 이 개발 환경은 아웃바운드 프록시가 외부 도메인을 차단해 실제 수집 검증은 GitHub Actions로 한다.
import axios from 'axios';
import * as cheerio from 'cheerio';
import { upsertRawTopic } from './db.js';
import config from './config.js';

const USER_AGENT = 'Mozilla/5.0 (compatible; hot10-daily-report/1.0; +buzzAnalysis)';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// 크롤링 소스 공통 규칙(설계서 §2.1) — 요청 간 1~3초 지연으로 상대 서버 부담 최소화
function jitterDelay() {
  return 1000 + Math.random() * 2000;
}

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
// 네이버 뉴스 랭킹 — 언론사별 많이 본 뉴스 (news.naver.com, 1페이지 1회 GET, 무키)
// ---------------------------------------------------------------------------
export async function fetchNaverRanking() {
  const res = await axios.get('https://news.naver.com/main/ranking/popularDay.naver', {
    timeout: 10000,
    headers: { 'User-Agent': USER_AGENT },
  });
  return res.data;
}

// 언론사별 랭킹 박스에서 각 박스의 1위 기사를 모아 통합 랭킹 생성
// (여러 언론사에서 동시에 1위인 기사일수록 실제 화제성이 높다는 가정)
export function parseNaverRanking(html, limit = 20) {
  const $ = cheerio.load(html);
  const items = [];

  $('.rankingnews_box').each((boxIdx, box) => {
    const press = $(box).find('.rankingnews_name').first().text().trim();
    const firstLi = $(box).find('.rankingnews_list li').first();
    const a = firstLi.find('a.list_title, a').first();
    const title = a.text().trim();
    const href = a.attr('href');
    if (!title) return;

    items.push({
      title,
      url: href ? new URL(href, 'https://news.naver.com').toString() : null,
      press,
    });
  });

  return items.slice(0, limit);
}

// ---------------------------------------------------------------------------
// 더쿠 HOT — 실시간 화제글 (theqoo.net/hot, 1페이지 1회 GET, 무키)
// ---------------------------------------------------------------------------
export async function fetchTheqooHot() {
  const res = await axios.get('https://theqoo.net/hot', {
    timeout: 10000,
    headers: { 'User-Agent': USER_AGENT },
  });
  return res.data;
}

export function parseTheqooHot(html, limit = 20) {
  const $ = cheerio.load(html);
  const items = [];
  const seen = new Set();

  $('a.subject, td.title a').each((i, el) => {
    const title = $(el).text().trim();
    const href = $(el).attr('href');
    if (!title || seen.has(title)) return;
    seen.add(title);
    items.push({
      title,
      url: href ? new URL(href, 'https://theqoo.net').toString() : null,
    });
  });

  return items.slice(0, limit);
}

// ---------------------------------------------------------------------------
// 네이트판 톡커들의 선택 — 옵션(기본 off), 더쿠 차단 시 대체재 (설계서 §2.1)
// ---------------------------------------------------------------------------
export async function fetchNatepannRanking() {
  const res = await axios.get('https://pann.nate.com/talk/ranking/d', {
    timeout: 10000,
    headers: { 'User-Agent': USER_AGENT },
  });
  return res.data;
}

export function parseNatepannRanking(html, limit = 20) {
  const $ = cheerio.load(html);
  const items = [];
  const seen = new Set();

  $('.tit a, .subject a').each((i, el) => {
    const title = $(el).text().trim();
    const href = $(el).attr('href');
    if (!title || seen.has(title)) return;
    seen.add(title);
    items.push({ title, url: href || null });
  });

  return items.slice(0, limit);
}

// ---------------------------------------------------------------------------
// 수집 오케스트레이션 — hot10_raw에 누적 병합
// ---------------------------------------------------------------------------
export async function collectKR() {
  const results = { gtrends: 0, wiki: 0, naver_rank: 0, theqoo: 0, natepann: 0 };

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

  await sleep(jitterDelay());
  try {
    const html = await fetchNaverRanking();
    const items = parseNaverRanking(html);
    items.forEach((item, idx) => {
      upsertRawTopic({
        region: 'kr',
        source: 'naver_rank',
        title: item.title,
        rank: idx + 1,
        trafficHint: item.press,
        url: item.url,
      });
    });
    results.naver_rank = items.length;
  } catch (err) {
    console.warn(`[hot10:sources-kr] naver_rank 수집 실패 (무시): ${err.message}`);
  }

  await sleep(jitterDelay());
  try {
    const html = await fetchTheqooHot();
    const items = parseTheqooHot(html);
    items.forEach((item, idx) => {
      upsertRawTopic({
        region: 'kr',
        source: 'theqoo',
        title: item.title,
        rank: idx + 1,
        trafficHint: null,
        url: item.url,
      });
    });
    results.theqoo = items.length;
  } catch (err) {
    console.warn(`[hot10:sources-kr] theqoo 수집 실패 (무시): ${err.message}`);
  }

  if (config.sources.natepannEnabled) {
    await sleep(jitterDelay());
    try {
      const html = await fetchNatepannRanking();
      const items = parseNatepannRanking(html);
      items.forEach((item, idx) => {
        upsertRawTopic({
          region: 'kr',
          source: 'natepann',
          title: item.title,
          rank: idx + 1,
          trafficHint: null,
          url: item.url,
        });
      });
      results.natepann = items.length;
    } catch (err) {
      console.warn(`[hot10:sources-kr] natepann 수집 실패 (무시): ${err.message}`);
    }
  }

  const natepannLog = config.sources.natepannEnabled ? `, natepann ${results.natepann}건` : '';
  console.log(
    `[hot10:sources-kr] 수집 완료 — gtrends ${results.gtrends}건, wiki ${results.wiki}건, ` +
    `naver_rank ${results.naver_rank}건, theqoo ${results.theqoo}건${natepannLog}`
  );
  return results;
}
