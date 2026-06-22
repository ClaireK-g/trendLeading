// 무료 인스타그램 스크래퍼 — 대안 프론트엔드(Picuki 등) 기반
import axios from 'axios';
import * as cheerio from 'cheerio';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

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
