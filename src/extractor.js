// LLM-based entity extraction (Gemini API)
import axios from "axios";
import config from "./config.js";
import { isBlacklisted } from "./blacklist.js";

const SYSTEM_PROMPT = `너는 대한민국의 소셜 미디어(인스타그램, 트위터)에서 가장 빠르게 떠오르는 F&B(음식, 디저트, 맛집) 트렌드를 포착하는 전문 트렌드 분석가이자 엔티티 추출기(Entity Extractor)이다.

# 미션
제공된 인스타그램 게시글 본문 및 댓글 텍스트 뭉치를 분석하여, 최근 '급부상하고 있는 새로운 키워드'를 추출하라. 이미 대중화된 유행어(예: 마라탕, 탕후루, 두바이초콜릿 원형)는 제외하고, 새롭게 등장한 메뉴명, 디저트 종류, 특정 지역의 핫플레이스 매장명을 찾아내야 한다.

# 추출 및 필터링 규칙
1. 신조어/변형 메뉴: 기존 메뉴가 결합하거나 변형된 형태 (예: 두바이 쫀득 쿠키 -> '두쫀쿠', 상하이 황유녠가오 -> '버터떡')
2. 핫플레이스/매장명: 특정 지역과 함께 언급되며 방문 인증이 급증하는 매장 이름 (예: 종로 광화문 근처 '설이동')
3. 동시 언급 키워드: 하나의 포스트에서 함께 언급되는 키워드 쌍도 추출하라. 이 co-occurrence 정보는 트렌드 연결고리를 파악하는 데 핵심이다.
4. 유사 키워드 병합: '두쫀쿠'와 '두쫀쿠키'처럼 같은 대상을 가리키는 변형은 대표 키워드 하나로 통합하라.
5. 노이즈 제거: '좋아요', '맞팔', '이벤트', '공구', '선팔', '소통' 같은 광고성/소통성 키워드는 완전히 제외할 것.

# 출력 형식
반드시 다른 설명 없이 아래와 같은 엄격한 JSON 형식의 List로만 답변해줘.
[
  {
    "keyword": "추출된 키워드",
    "category": "디저트 / 메뉴 / 매장명(지역) 중 선택",
    "region": "언급된 지역 (없으면 null)",
    "reason": "해당 키워드가 핫하다고 판단한 이유 요약",
    "confidence_score": 1~5,
    "co_keywords": ["함께 언급된 다른 키워드들"]
  }
]`;

const MAX_CHAR_PER_BATCH = 6000;
const BATCH_SIZE = 8;
const MAX_RETRIES = 3;

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callGemini(textChunk, retryCount = 0) {
  const prompt = SYSTEM_PROMPT + "\n\n# 분석할 데이터\n" + textChunk;

  try {
    const response = await axios.post(
      `${GEMINI_URL}?key=${config.geminiApiKey}`,
      {
        contents: [
          { role: "user", parts: [{ text: prompt }] },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2,
        },
      },
      {
        headers: { "Content-Type": "application/json" },
        timeout: 60000,
      }
    );

    const text = response.data.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
    return JSON.parse(text);
  } catch (err) {
    if (retryCount < MAX_RETRIES) {
      const isRateLimit = err.response?.status === 429;
      const delay = isRateLimit ? 60000 : Math.pow(2, retryCount) * 1000;
      console.warn(
        `[extractor] API 호출 실패 (시도 ${retryCount + 1}/${MAX_RETRIES}), ${delay / 1000}초 후 재시도...`,
        err.message
      );
      await sleep(delay);
      return callGemini(textChunk, retryCount + 1);
    }
    console.error("[extractor] API 호출 최대 재시도 초과:", err.message);
    return [];
  }
}

function buildTextBlock(posts) {
  const parts = [];
  for (const { caption, commentsText, account } of posts) {
    let entry = "";
    if (account) entry += `[@${account}]\n`;
    if (caption) entry += caption + "\n";
    if (commentsText) entry += commentsText + "\n";
    parts.push(entry);
  }

  const full = parts.join("\n---\n");
  if (full.length <= MAX_CHAR_PER_BATCH) return [full];

  const chunks = [];
  let current = "";
  for (const part of parts) {
    if (current.length + part.length + 5 > MAX_CHAR_PER_BATCH) {
      if (current) chunks.push(current);
      current = part;
    } else {
      current += (current ? "\n---\n" : "") + part;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export async function extractKeywords(textBatch) {
  const chunks = buildTextBlock(textBatch);
  const allKeywords = [];

  for (const chunk of chunks) {
    let keywords;
    try {
      keywords = await callGemini(chunk);
    } catch (e) {
      console.error("[extractor] Gemini 호출 실패:", e.message);
      keywords = [];
    }

    if (!Array.isArray(keywords)) keywords = [];

    const filtered = keywords.filter(
      (kw) => kw && kw.keyword && !isBlacklisted(kw.keyword)
    );
    allKeywords.push(...filtered);
  }

  return allKeywords;
}

function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function areSimilar(a, b) {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  if (la === lb) return true;
  if (la.includes(lb) || lb.includes(la)) return true;
  const maxLen = Math.max(la.length, lb.length);
  if (maxLen === 0) return true;
  const dist = editDistance(la, lb);
  return dist / maxLen <= 0.3;
}

export function mergeSimilarKeywords(keywords) {
  if (!keywords.length) return [];

  const groups = [];

  for (const kw of keywords) {
    let merged = false;
    for (const group of groups) {
      if (areSimilar(group.representative.keyword, kw.keyword)) {
        if (
          kw.confidence_score > group.representative.confidence_score ||
          (kw.confidence_score === group.representative.confidence_score &&
            kw.keyword.length > group.representative.keyword.length)
        ) {
          group.members.push(group.representative);
          group.representative = { ...kw };
        } else {
          group.members.push(kw);
        }
        merged = true;
        break;
      }
    }
    if (!merged) {
      groups.push({ representative: { ...kw }, members: [] });
    }
  }

  return groups.map(({ representative, members }) => {
    const allCoKw = new Set(representative.co_keywords || []);
    for (const m of members) {
      if (m.co_keywords) m.co_keywords.forEach((c) => allCoKw.add(c));
    }
    allCoKw.delete(representative.keyword);
    return {
      ...representative,
      co_keywords: [...allCoKw],
    };
  });
}

export async function processBatch(posts) {
  const batches = [];
  for (let i = 0; i < posts.length; i += BATCH_SIZE) {
    batches.push(posts.slice(i, i + BATCH_SIZE));
  }

  const total = batches.length;
  const allKeywords = [];

  for (let i = 0; i < batches.length; i++) {
    console.log(`[extractor] Gemini API 호출 (${i + 1}/${total})...`);
    const keywords = await extractKeywords(batches[i]);
    allKeywords.push(...keywords);

    // 2-second delay between calls to respect free tier rate limit (15 RPM)
    if (i < batches.length - 1) {
      await sleep(2000);
    }
  }

  return mergeSimilarKeywords(allKeywords);
}

export default { extractKeywords, mergeSimilarKeywords, processBatch };
