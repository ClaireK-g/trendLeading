// 무료 인스타그램 스크래퍼 — 대안 프론트엔드(Picuki 등) 기반
import axios from 'axios';
import * as cheerio from 'cheerio';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import config from './config.js';

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

export async function scrapeNaverDataLab() {
  const { clientId, clientSecret } = config.naver || {};
  if (!clientId || !clientSecret) {
    console.warn('[scraper] NAVER_CLIENT_ID/SECRET 미설정 → 네이버 데이터랩 스킵');
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

export async function scrapeNaverBlog() {
  const { clientId, clientSecret } = config.naver || {};
  if (!clientId || !clientSecret) return [];

  const queries = ['맛집 트렌드 2026', '디저트 핫플 웨이팅', 'SNS 맛집 신상'];
  const allPosts = [];

  for (const query of queries) {
    try {
      const res = await axios.get('https://openapi.naver.com/v1/search/blog.json', {
        params: { query, display: 10, sort: 'date' },
        headers: {
          'X-Naver-Client-Id': clientId,
          'X-Naver-Client-Secret': clientSecret,
        },
        timeout: 10000,
      });

      for (const item of res.data?.items || []) {
        const text = item.title.replace(/<[^>]+>/g, '') + ' ' + item.description.replace(/<[^>]+>/g, '');
        allPosts.push({
          account: 'naver_blog',
          caption: text,
          sourceUrl: item.link,
          collectedAt: new Date().toISOString(),
          source: 'naver_blog',
        });
      }
      await randomDelay(300, 800);
    } catch (err) {
      console.warn(`[scraper] 네이버 블로그 검색 실패 (${query}): ${err.message}`);
    }
  }

  return allPosts;
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

export async function collectDaily() {
  const usernames = await loadSeedAccounts();
  console.log(`[scraper] ${usernames.length}개 시드 계정 로드 완료`);

  const allPosts = [];

  // 계정별 수집
  for (const username of usernames) {
    try {
      const posts = await scrapeAccount(username);
      allPosts.push(...posts);
      console.log(`[scraper] ${username}: ${posts.length}개 포스트 수집`);
    } catch (err) {
      console.warn(`[scraper] ${username} 수집 실패: ${err.message}`);
    }
    await randomDelay();
  }

  // 해시태그 수집
  const hashtags = ['맛집', '디저트맛집', '서울맛집', '핫플', '성수맛집', '광화문맛집'];
  for (const tag of hashtags) {
    try {
      const posts = await scrapeHashtag(tag);
      allPosts.push(...posts);
      console.log(`[scraper] #${tag}: ${posts.length}개 포스트 수집`);
    } catch (err) {
      console.warn(`[scraper] #${tag} 수집 실패: ${err.message}`);
    }
    await randomDelay();
  }

  // 네이버 트렌드 수집
  console.log('[scraper] 네이버/뉴스 트렌드 수집 중...');
  console.log('[scraper] 네이버 데이터랩 + 블로그 수집 중...');
  const { posts: datalabPosts } = await scrapeNaverDataLab();
  allPosts.push(...datalabPosts);
  const blogPosts = await scrapeNaverBlog();
  allPosts.push(...blogPosts);
  console.log(`[scraper] 네이버: 데이터랩 ${datalabPosts.length}건 + 블로그 ${blogPosts.length}건`);

  // X(트위터) 트렌드 수집
  console.log('[scraper] X(트위터) 트렌드 수집 중...');
  const xPosts = await scrapeXTrends();
  allPosts.push(...xPosts);
  console.log('[scraper] X: ' + xPosts.length + '개 수집');

  // sourceUrl 기준 중복 제거
  const seen = new Set();
  const deduplicated = allPosts.filter((p) => {
    if (!p.sourceUrl || seen.has(p.sourceUrl)) return false;
    seen.add(p.sourceUrl);
    return true;
  });

  console.log(`[scraper] 총 ${deduplicated.length}개 포스트 수집 완료 (중복 제거 후)`);
  return deduplicated;
}
