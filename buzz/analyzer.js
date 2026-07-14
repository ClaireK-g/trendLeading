// buzz/analyzer.js — STEP 4 질적 분석(감성 BZ-4, 연관어 BZ-5). docs/buzz-analysis-design.md §4
import { callGeminiJSON } from './lib/gemini.js';
import { getDB, setPostSentiment, updateSentimentCounts, upsertAssocWord } from './db.js';
import config from './config.js';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function buildSentimentPrompt(posts) {
  const items = posts.map((p) => ({
    id: p.id,
    text: `${p.title || ''} ${p.description || ''}`.trim().slice(0, 300),
  }));

  return `너는 F&B 화제성 분석가다. 아래 게시물 각각의 감성을 분류하라.

# 분류 기준
- positive: 칭찬, 추천, 만족, 기대감 표현
- negative: 비판, 실망, 불만, 논란, 위생/서비스 문제 제기
- neutral: 단순 정보 전달, 감정 표현 없는 소개글

# 입력
${JSON.stringify(items)}

# 출력
JSON 배열만 출력. 없으면 [].
[{"id":0,"sentiment":"positive|negative|neutral","evidence":"판단 근거 짧은 인용"}]`;
}

// 타깃 하나·날짜 하나 — 정제 통과(is_noise=0) 게시물을 배치로 나눠 감성 분류 후
// buzz_posts.sentiment 갱신 + 채널별 buzz_daily_stats pos/neg/neu_count 갱신.
export async function analyzeSentiment(targetId, date) {
  const d = getDB();
  const posts = d.prepare(`
    SELECT id, channel, title, description FROM buzz_posts
    WHERE target = ? AND is_noise = 0 AND (published_at = ? OR (published_at IS NULL AND collected_at LIKE ?))
  `).all(targetId, date, `${date}%`);

  if (!posts.length) return {};

  const idToChannel = new Map(posts.map((p) => [p.id, p.channel]));
  const channelCounts = {};

  for (let i = 0; i < posts.length; i += config.llm.batchSize) {
    const batch = posts.slice(i, i + config.llm.batchSize);
    let results;
    try {
      results = await callGeminiJSON(buildSentimentPrompt(batch));
    } catch (err) {
      console.warn(`[buzz:analyzer] ${targetId} 감성 배치 실패 (무시): ${err.message}`);
      results = [];
    }
    if (!Array.isArray(results)) results = [];

    for (const r of results) {
      if (!r || typeof r.id !== 'number') continue;
      const sentiment = ['positive', 'negative', 'neutral'].includes(r.sentiment) ? r.sentiment : null;
      if (!sentiment) continue;
      const channel = idToChannel.get(r.id);
      if (!channel) continue;

      setPostSentiment(r.id, sentiment);
      if (!channelCounts[channel]) channelCounts[channel] = { pos: 0, neg: 0, neu: 0 };
      const key = sentiment === 'positive' ? 'pos' : sentiment === 'negative' ? 'neg' : 'neu';
      channelCounts[channel][key]++;
    }

    if (i + config.llm.batchSize < posts.length) await sleep(config.llm.interBatchDelay);
  }

  for (const [channel, counts] of Object.entries(channelCounts)) {
    updateSentimentCounts(targetId, date, channel, counts);
  }

  return channelCounts;
}

function buildAssocWordsPrompt(posts) {
  const items = posts
    .map((p) => `${p.title || ''} ${p.description || ''}`.trim())
    .filter(Boolean)
    .slice(0, 60);

  return `너는 F&B 화제성 분석가다. 아래 게시물들에서 타깃과 함께 가장 많이 언급된 연관어(명사/키워드)
상위 15개를 추출하라.

# 규칙
- 조사·의미 없는 부사(진짜, 완전, 너무 등)는 제외
- 타깃 이름 자체는 제외
- count_hint는 게시물 전체에서 대략 몇 번 등장했는지 추정치

# 입력 게시물
${JSON.stringify(items)}

# 출력
JSON 배열만 출력. 없으면 [].
[{"word":"","count_hint":0,"context":"어떤 맥락에서 언급되는지 한 줄"}]`;
}

// 타깃당 1콜 — 정제 통과 게시물 전체(최대 60건)로 연관어 톱15 추출 후 buzz_assoc_words 저장
export async function extractAssociatedWords(targetId, date) {
  const d = getDB();
  const posts = d.prepare(`
    SELECT title, description FROM buzz_posts
    WHERE target = ? AND is_noise = 0 AND (published_at = ? OR (published_at IS NULL AND collected_at LIKE ?))
  `).all(targetId, date, `${date}%`);

  if (!posts.length) return [];

  let results;
  try {
    results = await callGeminiJSON(buildAssocWordsPrompt(posts));
  } catch (err) {
    console.warn(`[buzz:analyzer] ${targetId} 연관어 추출 실패 (무시): ${err.message}`);
    results = [];
  }
  if (!Array.isArray(results)) results = [];

  const words = results
    .filter((r) => r && typeof r.word === 'string' && r.word.trim())
    .slice(0, 15)
    .map((r) => ({ word: r.word.trim(), count: Number(r.count_hint) || 1 }));

  for (const w of words) {
    upsertAssocWord(targetId, date, w.word, w.count);
  }

  return words;
}

// 스파이크 당일 트리거 후보 선정 — ①뉴스 우선 ②제목에 타깃명 정확 포함 ③발행 빠른 순
function selectTriggerCandidates(targetId, date, targetName) {
  const d = getDB();
  const posts = d.prepare(`
    SELECT url, title, channel, published_at, collected_at FROM buzz_posts
    WHERE target = ? AND is_noise = 0 AND (published_at = ? OR (published_at IS NULL AND collected_at LIKE ?))
  `).all(targetId, date, `${date}%`);

  const scored = posts.map((p) => {
    let score = 0;
    if (p.channel === 'news') score += 2;
    if (targetName && p.title && p.title.includes(targetName)) score += 1;
    return { ...p, score };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const at = a.published_at || a.collected_at || '';
    const bt = b.published_at || b.collected_at || '';
    return at.localeCompare(bt);
  });

  return scored.slice(0, 3);
}

function buildTriggerPrompt(targetName, candidates) {
  const items = candidates.map((c) => ({ title: c.title, channel: c.channel }));
  return `너는 F&B 화제성 분석가다. "${targetName}"의 언급량이 갑자기 급증했다. 아래 게시물 제목들을
보고 무슨 일이 있었는지 한 줄로 추정하라. 근거가 부족하면 억지로 추정하지 마라.

# 입력
${JSON.stringify(items)}

# 출력
JSON 배열만 출력(원소 1개). 근거 부족 시 [].
[{"summary":"무슨 일이 있었는지 한 줄 요약"}]`;
}

// 스파이크 감지 시 원인 후보 톱3 선정 + Gemini 1콜로 원인 요약
export async function summarizeSpikeTrigger(targetId, date, targetName) {
  const candidates = selectTriggerCandidates(targetId, date, targetName);
  if (!candidates.length) return { candidates: [], summary: null };

  let result;
  try {
    result = await callGeminiJSON(buildTriggerPrompt(targetName, candidates));
  } catch (err) {
    console.warn(`[buzz:analyzer] ${targetId} 트리거 요약 실패 (무시): ${err.message}`);
    result = [];
  }
  if (!Array.isArray(result)) result = [];
  const summary = typeof result[0]?.summary === 'string' ? result[0].summary : null;

  return { candidates, summary };
}

export async function analyzeDaily(targets, date) {
  const results = [];
  for (const target of targets) {
    try {
      const sentiment = await analyzeSentiment(target.id, date);
      results.push({ target: target.id, sentiment });
      console.log(`[buzz:analyzer] ${target.id} 감성 분석 완료`);
    } catch (err) {
      console.warn(`[buzz:analyzer] ${target.id} 감성 분석 실패 (무시): ${err.message}`);
    }

    try {
      await extractAssociatedWords(target.id, date);
      console.log(`[buzz:analyzer] ${target.id} 연관어 추출 완료`);
    } catch (err) {
      console.warn(`[buzz:analyzer] ${target.id} 연관어 추출 실패 (무시): ${err.message}`);
    }
  }
  return results;
}
