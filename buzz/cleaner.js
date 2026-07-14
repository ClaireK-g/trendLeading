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

function titleTokens(title) {
  return new Set(normalizeTitle(title).split(' ').filter((t) => t.length >= 2));
}

// 자카드 유사도 — 두 제목의 토큰 겹침 비율(0~1)
function titleSimilarity(a, b) {
  const setA = titleTokens(a);
  const setB = titleTokens(b);
  if (!setA.size || !setB.size) return 0;
  let intersect = 0;
  for (const t of setA) if (setB.has(t)) intersect++;
  const union = setA.size + setB.size - intersect;
  return union ? intersect / union : 0;
}

function extractDomain(url) {
  try {
    return new URL(url).hostname;
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

// 같은 날 동일 도메인에서 유사 제목(자카드 유사도 ≥0.5) 3건 이상 → 도배로 마킹
function detectSpamGroups(posts) {
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
        if (titleSimilarity(group[i].title, group[j].title) >= 0.5) similarCount++;
      }
      if (similarCount >= 3) group.forEach((p) => spamIds.add(p.id));
    }
  }

  return spamIds;
}

// 타깃 하나·날짜 하나의 미정제(is_noise=0) 게시물을 규칙으로 판정해 마킹한다.
export function cleanTargetPosts(targetId, date, excludeHints = []) {
  const d = getDB();
  const posts = d.prepare(`
    SELECT id, url, title, description, published_at, collected_at
    FROM buzz_posts
    WHERE target = ? AND (published_at = ? OR (published_at IS NULL AND collected_at LIKE ?))
      AND is_noise = 0
  `).all(targetId, date, `${date}%`);

  const spamIds = detectSpamGroups(posts);
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
      const result = cleanTargetPosts(target.id, date, target.exclude || []);
      results.push({ target: target.id, ...result });
    } catch (err) {
      console.warn(`[buzz:cleaner] ${target.id} 정제 실패 (무시): ${err.message}`);
    }
  }
  return results;
}
