// buzz/analyzer.js — STEP 4 질적 분석(감성). docs/buzz-analysis-design.md §4 BZ-4
import { callGeminiJSON } from './lib/gemini.js';
import { getDB, setPostSentiment, updateSentimentCounts } from './db.js';
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

export async function analyzeDaily(targets, date) {
  const results = [];
  for (const target of targets) {
    try {
      const result = await analyzeSentiment(target.id, date);
      results.push({ target: target.id, channels: result });
      console.log(`[buzz:analyzer] ${target.id} 감성 분석 완료`);
    } catch (err) {
      console.warn(`[buzz:analyzer] ${target.id} 감성 분석 실패 (무시): ${err.message}`);
    }
  }
  return results;
}
