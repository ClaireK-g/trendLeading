// 무료 인스타그램 스크래퍼 — 대안 프론트엔드(Picuki 등) 기반
import axios from 'axios';
import * as cheerio from 'cheerio';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import config from './config.js';
import { getRecentSourceUrls, getRecentTopCoKeywords } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function defaultHeaders() {
  return {
    'User-Agent': randomUA(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
  };
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(minMs = 1000, maxMs = 3000) {
  return sleep(minMs + Math.floor(Math.random() * (maxMs - minMs)));
}

// ---------------------------------------------------------------------------
// 시드 계정 로드
// ---------------------------------------------------------------------------

export async function loadSeedAccounts() {
  const seedPath = join(__dirname, '..', 'seeds', 'accounts.json');
  const raw = await readFile(seedPath, 'utf-8');
  const data = JSON.parse(raw);
  // _comment 같은 메타 필드 제외, 배열이면 그대로 사용
  if (Array.isArray(data)) return data.filter((v) => typeof v === 'string');
  if (data.accounts) return data.accounts;
  return [];
}

// ---------------------------------------------------------------------------
// Picuki 스크래퍼
// ---------------------------------------------------------------------------

export async function scrapeFromPicuki(username, maxPosts = 10) {
  const url = `https://www.picuki.com/profile/${username}`;
  const { data: html } = await axios.get(url, {
    headers: defaultHeaders(),
    timeout: 15_000,
  });

  const $ = cheerio.load(html);
  const posts = [];

  $('.box-photo').each((_i, el) => {
    if (posts.length >= maxPosts) return false;

    const caption = $(el).find('.photo-description').text().trim();
    const link = $(el).find('a').attr('href') || '';
    const sourceUrl = link.startsWith('http') ? link : link ? `https://www.picuki.com${link}` : '';

    if (caption) {
      posts.push({
        account: username,
        caption,
        sourceUrl,
        collectedAt: new Date().toISOString(),
        source: 'instagram',
      });
    }
  });

  return posts;
}

// ---------------------------------------------------------------------------
// Imginn 폴백
// ---------------------------------------------------------------------------

async function scrapeFromImginn(username, maxPosts = 10) {
  const url = `https://imginn.com/${username}/`;
  const { data: html } = await axios.get(url, {
    headers: defaultHeaders(),
    timeout: 15_000,
  });

  const $ = cheerio.load(html);
  const posts = [];

  $('.item').each((_i, el) => {
    if (posts.length >= maxPosts) return false;

    const caption = $(el).find('.desc').text().trim();
    const link = $(el).find('a').attr('href') || '';
    const sourceUrl = link.startsWith('http') ? link : link ? `https://imginn.com${link}` : '';

    if (caption) {
      posts.push({
        account: username,
        caption,
        sourceUrl,
        collectedAt: new Date().toISOString(),
        source: 'instagram',
      });
    }
  });

  return posts;
}

// ---------------------------------------------------------------------------
// Dumpor 폴백
// ---------------------------------------------------------------------------

async function scrapeFromDumpor(username, maxPosts = 10) {
  const url = `https://dumpor.com/v/${username}`;
  const { data: html } = await axios.get(url, {
    headers: defaultHeaders(),
    timeout: 15_000,
  });

  const $ = cheerio.load(html);
  const posts = [];

  $('.card').each((_i, el) => {
    if (posts.length >= maxPosts) return false;

    const caption = $(el).find('.card__text, .card-body').text().trim();
    const link = $(el).find('a').attr('href') || '';
    const sourceUrl = link.startsWith('http') ? link : link ? `https://dumpor.com${link}` : '';

    if (caption) {
      posts.push({
        account: username,
        caption,
        sourceUrl,
        collectedAt: new Date().toISOString(),
        source: 'instagram',
      });
    }
  });

  return posts;
}

// ---------------------------------------------------------------------------
// 해시태그 스크래퍼
// ---------------------------------------------------------------------------

export async function scrapeHashtag(hashtag, maxPosts = 20) {
  const url = `https://www.picuki.com/tag/${encodeURIComponent(hashtag)}`;
  const { data: html } = await axios.get(url, {
    headers: defaultHeaders(),
    timeout: 15_000,
  });

  const $ = cheerio.load(html);
  const posts = [];

  $('.box-photo').each((_i, el) => {
    if (posts.length >= maxPosts) return false;

    const caption = $(el).find('.photo-description').text().trim();
    const link = $(el).find('a').attr('href') || '';
    const sourceUrl = link.startsWith('http') ? link : link ? `https://www.picuki.com${link}` : '';

    if (caption) {
      posts.push({
        account: `#${hashtag}`,
        caption,
        sourceUrl,
        collectedAt: new Date().toISOString(),
        source: 'instagram',
      });
    }
  });

  return posts;
}

// ---------------------------------------------------------------------------
// 계정별 폴백 수집
// ---------------------------------------------------------------------------

async function scrapeAccount(username, maxPosts = 10) {
  // 1차: Picuki
  try {
    const posts = await scrapeFromPicuki(username, maxPosts);
    if (posts.length > 0) return posts;
  } catch (e) {
    console.warn(`[scraper] Picuki 실패 (${username}): ${e.message}`);
  }

  await randomDelay();

  // 2차: Imginn
  try {
    const posts = await scrapeFromImginn(username, maxPosts);
    if (posts.length > 0) return posts;
  } catch (e) {
    console.warn(`[scraper] Imginn 실패 (${username}): ${e.message}`);
  }

  await randomDelay();

  // 3차: Dumpor
  try {
    const posts = await scrapeFromDumpor(username, maxPosts);
    if (posts.length > 0) return posts;
  } catch (e) {
    console.warn(`[scraper] Dumpor 실패 (${username}): ${e.message}`);
  }

  return [];
}

// ---------------------------------------------------------------------------
// 네이버 데이터랩 검색어 트렌드 API
// https://developers.naver.com/docs/serviceapi/datalab/search/search.md
// ---------------------------------------------------------------------------

function getDateStr(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

// F&B 관련성 필터 — 광고/부동산/여행 노이즈 제거용
const FB_ANCHORS = [
  '맛집', '디저트', '카페', '베이커리', '빵', '메뉴', '먹', '음식', '식당',
  '핫플', '웨이팅', '오픈런', '브런치', '디저트', '간식', '신상', '팝업',
  '커피', '음료', '쿠키', '케이크', '떡', '아이스크림', '도넛', '버거', '면',
];
const FB_NOISE = ['분양', '아파트', '부동산', '오피스텔', '청약', '대출', '보험', '주식', '코인'];

function isFoodRelevant(text) {
  if (!text) return false;
  if (FB_NOISE.some((n) => text.includes(n)) && !FB_ANCHORS.some((a) => text.includes(a))) {
    return false;
  }
  return FB_ANCHORS.some((a) => text.includes(a));
}

export async function scrapeNaverDataLab() {
  const { clientId, clientSecret } = config.naverDatalab || {};
  if (!clientId || !clientSecret) {
    console.warn('[scraper] NAVER_DATALAB_CLIENT_ID/SECRET 미설정 → 네이버 데이터랩 스킵');
    return { posts: [], risingKeywords: [] };
  }

  const keywordGroups = [
    { groupName: '디저트', keywords: ['디저트', '디저트맛집', '신상디저트'] },
    { groupName: '맛집', keywords: ['맛집', '핫플', '웨이팅맛집'] },
    { groupName: '카페', keywords: ['카페', '신상카페', '카페추천'] },
    { groupName: '트렌드음식', keywords: ['트렌드음식', 'SNS맛집', '인스타맛집'] },
  ];

  const startDate = getDateStr(30);
  const endDate = getDateStr(0);

  const allPosts = [];
  const risingKeywords = [];

  for (const group of keywordGroups) {
    try {
      const res = await axios.post(
        'https://openapi.naver.com/v1/datalab/search',
        {
          startDate,
          endDate,
          timeUnit: 'date',
          keywordGroups: [group],
        },
        {
          headers: {
            'X-Naver-Client-Id': clientId,
            'X-Naver-Client-Secret': clientSecret,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );

      const results = res.data?.results?.[0];
      if (!results?.data?.length) continue;

      const data = results.data;
      const recent3 = data.slice(-3);
      const prev7 = data.slice(-10, -3);

      const recentAvg = recent3.reduce((s, d) => s + d.ratio, 0) / recent3.length;
      const prevAvg = prev7.length ? prev7.reduce((s, d) => s + d.ratio, 0) / prev7.length : 0;
      const changeRate = prevAvg > 0 ? ((recentAvg - prevAvg) / prevAvg * 100).toFixed(1) : 0;

      if (recentAvg > prevAvg) {
        risingKeywords.push({
          group: group.groupName,
          keywords: group.keywords,
          recentAvg: recentAvg.toFixed(1),
          prevAvg: prevAvg.toFixed(1),
          changeRate: `+${changeRate}%`,
        });
      }

      allPosts.push({
        account: 'naver_datalab',
        caption: `[네이버 데이터랩] "${group.groupName}" 검색 트렌드 최근 3일 평균 ${recentAvg.toFixed(1)} (이전 7일 대비 ${changeRate > 0 ? '+' : ''}${changeRate}% 변화). 관련 키워드: ${group.keywords.join(', ')}`,
        sourceUrl: 'https://datalab.naver.com/',
        collectedAt: new Date().toISOString(),
        source: 'naver_datalab',
      });

      await randomDelay(300, 800);
    } catch (err) {
      console.warn(`[scraper] 네이버 데이터랩 실패 (${group.groupName}): ${err.message}`);
    }
  }

  console.log(`[scraper] 네이버 데이터랩: ${allPosts.length}개 트렌드, 상승 ${risingKeywords.length}개 그룹`);
  if (risingKeywords.length) {
    risingKeywords.forEach(r => console.log(`  📈 ${r.group}: ${r.changeRate} (${r.keywords.join('/')})`));
  }

  return { posts: allPosts, risingKeywords };
}

// 더 구체적인 F&B 발굴 쿼리 (광범위 쿼리 → 노이즈 줄이기)
const NAVER_DISCOVERY_QUERIES = [
  '"처음 가봤는데" 맛집 웨이팅',
  '"새로 생긴" 디저트 카페',
  '"요즘 줄 서는" 맛집',
  '"오픈런" 신상 디저트',
  '"입소문" 맛집 숨은',
  '"히든 맛집" 발견',
  '"드디어 가봤다" 맛집',
  '팝업스토어 디저트 한정',
  // 방송/미디어發 소재 — 실증된 최우선 성과 패턴(blog-traffic-dev 스킬 §5, '언더커버 쉐프' 사례)
  '"방송에 나온" 맛집',
  '"티비에 나온" 식당',
  '예능 맛집 어디',
  '"에 나왔던" 맛집 위치',
];

const MAX_POST_AGE_DAYS = 3; // 트렌드 시간 기준(2~3일)과 일치 — 오래된 요약기사 유입 차단

// 뉴스 API의 pubDate(RFC822)·블로그 API의 postdate(yyyyMMdd)를 파싱해 최근성 판단.
// 파싱 실패 시 true(통과) — 부분 실패가 수집 전체를 죽이지 않도록 fail-open.
function isRecentEnough(item) {
  const raw = item.pubDate || item.postdate;
  if (!raw) return true;

  let published;
  if (/^\d{8}$/.test(raw)) {
    // postdate: yyyyMMdd
    published = new Date(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`);
  } else {
    published = new Date(raw);
  }
  if (Number.isNaN(published.getTime())) return true;

  const ageDays = (Date.now() - published.getTime()) / (1000 * 60 * 60 * 24);
  return ageDays <= MAX_POST_AGE_DAYS;
}

// 네이버 검색 API 공통 (블로그/뉴스 동일 키)
async function searchNaver(endpoint, sourceTag, queries = NAVER_DISCOVERY_QUERIES) {
  const { clientId, clientSecret } = config.naverSearch || {};
  if (!clientId || !clientSecret) return [];

  const allPosts = [];
  let dropped = 0;
  let stale = 0;

  // date(최신순) + sim(관련도순 — 네이버 랭킹에 인기 신호 반영) 이중 수집.
  // 조회수는 네이버 공개 API가 제공하지 않으므로 sim 정렬이 유일한 "인기 글" 프록시다.
  // sim 결과도 isRecentEnough(발행 3일) 필터를 통과해야 하므로 "최근 + 인기" 글만 남는다.
  const SORTS = ['date', 'sim'];

  for (const query of queries) {
    for (const sort of SORTS) {
      try {
        const res = await axios.get(`https://openapi.naver.com/v1/search/${endpoint}.json`, {
          params: { query, display: 10, sort },
          headers: {
            'X-Naver-Client-Id': clientId,
            'X-Naver-Client-Secret': clientSecret,
          },
          timeout: 10000,
        });

        for (const item of res.data?.items || []) {
          if (!isRecentEnough(item)) {
            stale++;
            continue;
          }
          const text = (item.title + ' ' + (item.description || '')).replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ').trim();
          if (!isFoodRelevant(text)) {
            dropped++;
            continue;
          }
          allPosts.push({
            account: sourceTag,
            caption: text,
            sourceUrl: item.link,
            collectedAt: new Date().toISOString(),
            source: sourceTag,
          });
        }
        await randomDelay(300, 800);
      } catch (err) {
        console.warn(`[scraper] 네이버 ${endpoint} 검색 실패 (${query}, ${sort}): ${err.message}`);
      }
    }
  }

  if (dropped) console.log(`[scraper] ${sourceTag}: 노이즈 ${dropped}건 필터링`);
  if (stale) console.log(`[scraper] ${sourceTag}: 발행 ${MAX_POST_AGE_DAYS}일 초과 ${stale}건 제외`);
  return allPosts;
}

export async function scrapeNaverBlog(queries = NAVER_DISCOVERY_QUERIES) {
  return searchNaver('blog', 'naver_blog', queries);
}

export async function scrapeNaverNews(queries = NAVER_DISCOVERY_QUERIES) {
  return searchNaver('news', 'naver_news', queries);
}

// ---------------------------------------------------------------------------
// X(트위터) 트렌드 스크래퍼 (Nitter 기반)
// ---------------------------------------------------------------------------

export async function scrapeXTrends() {
  const queries = ['맛집', '디저트', '핫플'];
  const nitterInstances = [
    'https://nitter.net',
    'https://nitter.privacydev.net',
    'https://nitter.poast.org',
  ];
  const allPosts = [];

  for (const query of queries) {
    let fetched = false;

    for (const instance of nitterInstances) {
      if (fetched) break;

      try {
        const url = `${instance}/search?q=${encodeURIComponent(query)}&f=tweets`;
        const { data: html } = await axios.get(url, {
          headers: defaultHeaders(),
          timeout: 15_000,
        });

        const $ = cheerio.load(html);
        const now = new Date().toISOString();

        $('.timeline-item .tweet-content, .tweet-body .tweet-content').each((_i, el) => {
          const tweetText = $(el).text().trim();
          const tweetLink = $(el).closest('.timeline-item').find('a.tweet-link').attr('href') || '';
          const sourceUrl = tweetLink
            ? (tweetLink.startsWith('http') ? tweetLink : `${instance}${tweetLink}`)
            : '';

          if (tweetText) {
            allPosts.push({
              account: 'x_trend',
              caption: tweetText,
              sourceUrl,
              collectedAt: now,
              source: 'x',
            });
          }
        });

        fetched = true;
        await randomDelay(500, 1500);
      } catch (err) {
        console.warn(`[scraper] Nitter(${instance}) 실패 (${query}): ${err.message}`);
      }
    }

    if (!fetched) {
      console.warn(`[scraper] X 트렌드 수집 실패 — 모든 Nitter 인스턴스 실패 (${query})`);
    }
  }

  return allPosts;
}

// ---------------------------------------------------------------------------
// 일일 수집 오케스트레이터
// ---------------------------------------------------------------------------

// Instagram 수집 — 격리된 옵션 모듈. INSTAGRAM_ENABLED=true 일 때만 동작.
// 죽어도(403 등) 메인 파이프라인에 영향 없도록 try/catch로 완전 격리.
async function collectInstagram() {
  if (!config.instagram?.enabled) {
    console.log('[scraper] Instagram 비활성화 (INSTAGRAM_ENABLED=false) — 스킵');
    return [];
  }

  const posts = [];
  try {
    const usernames = await loadSeedAccounts();
    console.log(`[scraper] Instagram: ${usernames.length}개 시드 계정 수집 시도`);

    for (const username of usernames) {
      try {
        posts.push(...await scrapeAccount(username));
      } catch (err) {
        console.warn(`[scraper] IG ${username} 실패: ${err.message}`);
      }
      await randomDelay();
    }

    const hashtags = ['맛집', '디저트맛집', '서울맛집', '핫플', '성수맛집', '광화문맛집'];
    for (const tag of hashtags) {
      try {
        posts.push(...await scrapeHashtag(tag));
      } catch (err) {
        console.warn(`[scraper] IG #${tag} 실패: ${err.message}`);
      }
      await randomDelay();
    }
  } catch (err) {
    console.warn(`[scraper] Instagram 모듈 전체 실패 (무시): ${err.message}`);
  }

  console.log(`[scraper] Instagram: ${posts.length}건 수집`);
  return posts;
}

export async function collectDaily() {
  const allPosts = [];

  // ── 주력(主力): 네이버 데이터랩 + 블로그 + 뉴스 ───────────────────
  // 동적 쿼리 — 최근 co_keywords 상위권에서 고정 쿼리에 없는 것만 추가 (탐색 다양화)
  let dynamicQueries = [];
  try {
    dynamicQueries = getRecentTopCoKeywords(3, 4).filter(q => !NAVER_DISCOVERY_QUERIES.includes(q));
  } catch (err) {
    console.warn(`[scraper] 동적 쿼리 생성 실패 (무시): ${err.message}`);
  }
  if (dynamicQueries.length) console.log(`[scraper] 동적 쿼리 추가: ${dynamicQueries.join(', ')}`);
  const discoveryQueries = [...NAVER_DISCOVERY_QUERIES, ...dynamicQueries];

  console.log('[scraper] [주력] 네이버 데이터랩/블로그/뉴스 수집 중...');
  const { posts: datalabPosts, risingKeywords } = await scrapeNaverDataLab();
  allPosts.push(...datalabPosts);
  const blogPosts = await scrapeNaverBlog(discoveryQueries);
  allPosts.push(...blogPosts);
  const newsPosts = await scrapeNaverNews(discoveryQueries);
  allPosts.push(...newsPosts);
  console.log(`[scraper] 네이버: 데이터랩 ${datalabPosts.length} + 블로그 ${blogPosts.length} + 뉴스 ${newsPosts.length}건`);

  // ── 보조: X(트위터/Nitter) — best-effort ─────────────────────────
  console.log('[scraper] [보조] X(Nitter) 수집 중...');
  let xPosts = [];
  try {
    xPosts = await scrapeXTrends();
  } catch (err) {
    console.warn(`[scraper] X 수집 실패 (무시): ${err.message}`);
  }
  allPosts.push(...xPosts);
  console.log(`[scraper] X: ${xPosts.length}건 수집`);

  // ── 옵션: Instagram (기본 off, 완전 격리) ────────────────────────
  const igPosts = await collectInstagram();
  allPosts.push(...igPosts);

  // sourceUrl 기준 중복 제거 (당일 배치 내)
  const seen = new Set();
  const sameDayDeduplicated = allPosts.filter((p) => {
    if (!p.sourceUrl || seen.has(p.sourceUrl)) return false;
    seen.add(p.sourceUrl);
    return true;
  });

  // 크로스데이 중복 제거 — 최근 14일 내 이미 수집한 기사 재수집 차단
  let recentUrls;
  try {
    recentUrls = getRecentSourceUrls(14);
  } catch (err) {
    console.warn(`[scraper] 기수집 URL 조회 실패 (무시): ${err.message}`);
    recentUrls = new Set();
  }
  let skippedRecent = 0;
  const deduplicated = sameDayDeduplicated.filter((p) => {
    if (p.sourceUrl && recentUrls.has(p.sourceUrl)) {
      skippedRecent++;
      return false;
    }
    return true;
  });
  if (skippedRecent) console.log(`[scraper] 기수집 URL ${skippedRecent}건 스킵`);

  console.log(`[scraper] 총 ${deduplicated.length}건 수집 완료 (중복 제거 후)`);
  // risingKeywords를 함께 노출 — 데이터랩 검증 신호
  deduplicated.risingKeywords = risingKeywords;
  return deduplicated;
}
