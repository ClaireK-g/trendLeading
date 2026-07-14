// buzz/cleaner.js — STEP 3 정제·필터링 (규칙 기반, LLM 0콜). docs/buzz-analysis-design.md §4 BZ-3
// 노이즈는 삭제하지 않고 is_noise=1 마킹만 한다 — 규칙 튜닝 가능성 보존.
import { getDB } from './db.js';

// 광고/이벤트 시그널 사전 — title/description에 포함되면 즉시 노이즈 마킹
const AD_SIGNALS = ['협찬', '체험단', '원고료', '쿠팡파트너스', '제공받아', '유료광고', '광고포함'];
const EVENT_SIGNALS = ['이벤트 참여', '이벤트참여', '댓글 이벤트', '리그램 이벤트', '선착순 증정'];

function normalizeTitle(title) {
  return (title || '')
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// stripTokens(검색 쿼리 자체의 토큰)를 제외한 나머지 토큰만 비교 대상으로 삼는다.
// 타깃의 검색어("냉장고 털기" 등)가 거의 모든 제목에 그대로 들어있어, 이를 포함해 비교하면
// 서로 무관한 게시물도 유사도가 인위적으로 높게 나와 도배로 오판정된다.
function titleTokens(title, stripTokens = new Set()) {
  return new Set(
    normalizeTitle(title)
      .split(' ')
      .filter((t) => t.length >= 2 && !stripTokens.has(t))
  );
}

// 자카드 유사도 — 두 제목의 토큰 겹침 비율(0~1). 둘 다 stripTokens 제외 후 토큰이 없으면
// (검색어만으로 이루어진 제목) 비교 불가로 보고 0 반환 — 오탐 방지.
function titleSimilarity(a, b, stripTokens = new Set()) {
  const setA = titleTokens(a, stripTokens);
  const setB = titleTokens(b, stripTokens);
  if (!setA.size || !setB.size) return 0;
  let intersect = 0;
  for (const t of setA) if (setB.has(t)) intersect++;
  const union = setA.size + setB.size - intersect;
  return union ? intersect / union : 0;
}

// 네이버 블로그는 호스트명이 전부 blog.naver.com으로 동일해, 호스트명만 "도메인"으로 쓰면
// 서로 다른 블로거가 전부 한 그룹으로 뭉쳐 도배 오탐이 폭증한다 — 경로 첫 세그먼트(블로거ID)까지
// 포함해 실제 1인 계정 단위로 구분한다.
const NAVER_BLOG_HOSTS = new Set(['blog.naver.com', 'm.blog.naver.com']);
// 네이버 카페 URL(/카페ID/게시글ID)에는 애초에 "작성자" 정보가 없다 — 카페ID로 묶으면
// 같은 커뮤니티의 서로 다른 회원들이 같은 챌린지/게시판 형식으로 올린 정상 게시물(예: "냉장고
// 털기" 인증 챌린지)이 전부 한 계정으로 오인되어 도배로 오판정된다. 카페는 도메인 기반
// 도배 탐지 대상에서 제외(null 반환 → detectSpamGroups가 건너뜀).
const NAVER_CAFE_HOSTS = new Set(['cafe.naver.com', 'm.cafe.naver.com']);

function extractDomain(url) {
  try {
    const u = new URL(url);
    if (NAVER_CAFE_HOSTS.has(u.hostname)) return null;
    if (NAVER_BLOG_HOSTS.has(u.hostname)) {
      const account = u.pathname.split('/').filter(Boolean)[0];
      return account ? `${u.hostname}/${account}` : u.hostname;
    }
    return u.hostname;
  } catch {
    return null;
  }
}

function detectAdOrEvent(post) {
  const text = `${post.title || ''} ${post.description || ''}`;
  for (const signal of AD_SIGNALS) {
    if (text.includes(signal)) return 'ad';
  }
  for (const signal of EVENT_SIGNALS) {
    if (text.includes(signal)) return 'event';
  }
  return null;
}

function detectHomonym(post, excludeHints = []) {
  const text = `${post.title || ''} ${post.description || ''}`;
  for (const hint of excludeHints) {
    if (hint && text.includes(hint)) return true;
  }
  return false;
}

// 같은 날 동일 계정(도메인)에서 유사 제목(검색어 토큰 제외 후 자카드 유사도 ≥0.5) 3건 이상
// → 도배로 마킹
function detectSpamGroups(posts, queryTokens = new Set()) {
  const spamIds = new Set();
  const byDomainDate = new Map();

  for (const post of posts) {
    const domain = extractDomain(post.url);
    if (!domain) continue;
    const key = `${domain}|${post.published_at || post.collected_at?.slice(0, 10)}`;
    if (!byDomainDate.has(key)) byDomainDate.set(key, []);
    byDomainDate.get(key).push(post);
  }

  for (const group of byDomainDate.values()) {
    if (group.length < 3) continue;
    for (let i = 0; i < group.length; i++) {
      let similarCount = 1;
      for (let j = 0; j < group.length; j++) {
        if (i === j) continue;
        if (titleSimilarity(group[i].title, group[j].title, queryTokens) >= 0.5) similarCount++;
      }
      if (similarCount >= 3) group.forEach((p) => spamIds.add(p.id));
    }
  }

  return spamIds;
}

// 타깃의 검색 쿼리 자체에서 나온 토큰 집합 — 유사도 비교에서 제외할 대상
function buildQueryTokenSet(queries = []) {
  const tokens = new Set();
  for (const q of queries) {
    for (const t of titleTokens(q)) tokens.add(t);
  }
  return tokens;
}

// 타깃 하나·날짜 하나의 미정제(is_noise=0) 게시물을 규칙으로 판정해 마킹한다.
// queries: 타깃의 검색 쿼리 목록 — 도배 판정 시 유사도 비교에서 제외할 토큰을 만드는 데 쓰인다.
export function cleanTargetPosts(targetId, date, excludeHints = [], queries = []) {
  const d = getDB();
  const posts = d.prepare(`
    SELECT id, url, title, description, published_at, collected_at
    FROM buzz_posts
    WHERE target = ? AND (published_at = ? OR (published_at IS NULL AND collected_at LIKE ?))
      AND is_noise = 0
  `).all(targetId, date, `${date}%`);

  const queryTokens = buildQueryTokenSet(queries);
  const spamIds = detectSpamGroups(posts, queryTokens);
  const updateStmt = d.prepare('UPDATE buzz_posts SET is_noise = 1, noise_reason = ? WHERE id = ?');

  let adCount = 0, eventCount = 0, spamCount = 0, homonymCount = 0;

  for (const post of posts) {
    const adOrEvent = detectAdOrEvent(post);
    if (adOrEvent) {
      updateStmt.run(adOrEvent, post.id);
      if (adOrEvent === 'ad') adCount++; else eventCount++;
      continue;
    }
    if (detectHomonym(post, excludeHints)) {
      updateStmt.run('homonym', post.id);
      homonymCount++;
      continue;
    }
    if (spamIds.has(post.id)) {
      updateStmt.run('spam', post.id);
      spamCount++;
    }
  }

  const total = adCount + eventCount + spamCount + homonymCount;
  if (total) {
    console.log(
      `[buzz:cleaner] ${targetId} ${date}: 노이즈 ${total}건 마킹 (광고 ${adCount}, 이벤트 ${eventCount}, 도배 ${spamCount}, 동음이의 ${homonymCount})`
    );
  }

  return { adCount, eventCount, spamCount, homonymCount, total };
}

export function cleanDaily(targets, date) {
  const results = [];
  for (const target of targets) {
    try {
      const result = cleanTargetPosts(target.id, date, target.exclude || [], target.queries || []);
      results.push({ target: target.id, ...result });
    } catch (err) {
      console.warn(`[buzz:cleaner] ${target.id} 정제 실패 (무시): ${err.message}`);
    }
  }
  return results;
}
