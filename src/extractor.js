// LLM-based entity extraction (Gemini API)
import axios from "axios";
import config from "./config.js";
import { isBlacklisted } from "./blacklist.js";
import { fetchTrendIntelligence } from "./trend-intel.js";

let _trendIntel = null;

async function getTrendIntel() {
  if (!_trendIntel) _trendIntel = await fetchTrendIntelligence();
  return _trendIntel;
}

export function resetTrendIntel() { _trendIntel = null; }

function buildSystemPrompt(today) {
  return `너는 대한민국 F&B 업계의 '넥스트 트렌드'만 포착하는 초정밀 트렌드 스나이퍼이다.

오늘 날짜: ${today}
트렌드 판단 기준 시점: 오늘로부터 2~3일 이내. 1주일 전 유행도 이미 늦을 수 있다.

# 미션
인스타그램 텍스트에서 "지금 이 순간 막 태동하는" 마이크로 트렌드만 추출하라.
핵심은 '신선도(Freshness)' — 트렌드는 하루하루가 다르다.

# 절대 제외 기준
1. 이미 유행이 지났거나 대중화된 아이템과 그 변형
2. 일반 음식/음료명, 전국 체인, 노이즈 키워드
3. 매년 반복되는 계절 음식 (콩국수, 팥빙수, 호떡 등)

# 추출 대상
1. 완전 신규 메뉴/디저트: "처음 봤다", "이거 뭐야" 반응 동반
2. 떠오르는 매장: 최근 2~3일 내 웨이팅 급증, "요즘 줄 선다" 표현
3. 해외 직수입 트렌드: 한국 미상륙 해외 F&B의 첫 언급
4. 새로운 식문화 현상: 기존에 없던 소비 패턴

# 신선도 기준
- 5: "처음 보는데?" 반응 다수. 대중 인지도 거의 없음
- 4: 얼리어답터 사이에서 막 퍼지기 시작
- 3: 인플루언서 언급 시작 단계
- 2 이하: 추출하지 마라

# 출력
JSON 배열만 출력. confidence_score 3 이상만. 없으면 [].
[{"keyword":"","category":"디저트/메뉴/매장명(지역)/식문화현상","region":null,"reason":"","confidence_score":3,"co_keywords":[],"freshness_signal":"원문 인용"}]`;
}

function buildValidatorPrompt(today, newsHeadlines) {
  return `너는 F&B 스타트업의 PM이자, 10년차 서비스 기획자와 퍼포먼스 마케터이다.

오늘 날짜: ${today}
트렌드 판단 기준: 오늘 기준 2~3일 이내 신선도. 1주일 전도 늦을 수 있다.

# 미션
1차 AI가 추출한 트렌드 후보를 검증하라. 가짜, 구식, 억지 트렌드를 걸러내라.

# 오늘의 실시간 뉴스 헤드라인 (Google News 자동 수집)
아래는 오늘 수집된 실제 F&B 관련 뉴스이다. 이것을 교차 검증 레퍼런스로 활용하라.
${newsHeadlines}

# 탈락 기준 (하나라도 해당 시 즉시 제거)
1. 너의 학습 데이터에서 "이미 유행했다", "피크 지났다"고 확인되는 아이템이나 그 변형
2. 매년 반복 계절 음식 (콩국수, 팥빙수, 호떡, 냉면 등)
3. 일반 음식 카테고리명 (떡볶이, 크레페, 라떼 등)
4. 이미 뉴스에서 대대적 보도된 메인스트림 아이템

# 통과 기준
1. "이미 유행한 것"이 아닌 새로운 키워드 — 위 탈락 기준에 해당하지 않으면 일단 통과
2. 복수 계정/게시글에서 독립적으로 언급됨 (데이터 내에서 2개 이상 출처)
3. 구체적인 매장명/메뉴명/현상명이 있음 (추상적 카테고리가 아님)

중요: 마이크로 트렌드는 아직 뉴스나 검색엔진에 안 잡히는 게 정상이다. "들어본 적 없다"는 것이 탈락 사유가 아니다. 오히려 들어본 적 없는데 복수 게시글에서 언급되고 있다면 그것이 진짜 마이크로 트렌드 시그널이다.

# 출력
통과한 것만 JSON 배열. "validation_note" 추가. 없으면 [].`;
}

const MAX_CHAR_PER_BATCH = 6000;
const BATCH_SIZE = 8;
const MAX_RETRIES = 3;

const GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-3.5-flash",
  "gemini-2.5-flash-lite",
];
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callGemini(textChunk) {
  const intel = await getTrendIntel();
  const sysPrompt = buildSystemPrompt(intel.date);
  const prompt = sysPrompt + "\n\n# 분석할 데이터\n" + textChunk;
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
  };
  const axiosOpts = { headers: { "Content-Type": "application/json" }, timeout: 90000 };

  for (const model of GEMINI_MODELS) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const url = `${GEMINI_BASE}/${model}:generateContent?key=${config.geminiApiKey}`;
        const response = await axios.post(url, body, axiosOpts);
        const text = response.data.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
        if (model !== GEMINI_MODELS[0]) console.log(`[extractor] ${model} 사용`);
        return JSON.parse(text);
      } catch (err) {
        const status = err.response?.status;
        const isRateLimit = status === 429;
        const isOverloaded = status === 503;
        if (isOverloaded && attempt === 0) break; // try next model immediately
        if (attempt < MAX_RETRIES - 1) {
          const delay = isRateLimit ? 15000 : Math.pow(2, attempt) * 2000;
          console.warn(`[extractor] ${model} 실패 (${status}, 시도 ${attempt + 1}/${MAX_RETRIES}), ${delay / 1000}초 후 재시도...`);
          await sleep(delay);
        }
      }
    }
    console.warn(`[extractor] ${model} 실패, 다음 모델 시도...`);
  }
  console.error("[extractor] 모든 모델 실패");
  return [];
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

async function validateKeywords(keywords, originalText) {
  if (!keywords.length) return [];

  const intel = await getTrendIntel();
  const valPrompt = buildValidatorPrompt(intel.date, intel.headlines);
  const prompt = valPrompt +
    "\n\n# 1차 추출 결과\n" + JSON.stringify(keywords, null, 2) +
    "\n\n# 원본 텍스트 (참고용)\n" + originalText.slice(0, 3000);

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
  };
  const axiosOpts = { headers: { "Content-Type": "application/json" }, timeout: 90000 };

  for (const model of GEMINI_MODELS) {
    try {
      const url = `${GEMINI_BASE}/${model}:generateContent?key=${config.geminiApiKey}`;
      const response = await axios.post(url, body, axiosOpts);
      const text = response.data.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
      const validated = JSON.parse(text);
      return Array.isArray(validated) ? validated : [];
    } catch (err) {
      console.warn(`[validator] ${model} 실패, 다음 모델 시도...`);
    }
  }
  console.warn("[validator] 모든 모델 실패, 1차 결과 그대로 반환");
  return keywords;
}

export async function processBatch(posts) {
  resetTrendIntel();
  const batches = [];
  for (let i = 0; i < posts.length; i += BATCH_SIZE) {
    batches.push(posts.slice(i, i + BATCH_SIZE));
  }

  const total = batches.length;
  const allKeywords = [];
  const allText = [];

  for (let i = 0; i < batches.length; i++) {
    console.log(`[extractor] 1차 추출: Gemini API 호출 (${i + 1}/${total})...`);
    const keywords = await extractKeywords(batches[i]);
    allKeywords.push(...keywords);
    allText.push(...batches[i].map(p => p.caption || ''));

    if (i < batches.length - 1) await sleep(2000);
  }

  const merged = mergeSimilarKeywords(allKeywords);
  console.log(`[extractor] 1차 추출 완료: ${merged.length}개 후보`);

  if (!merged.length) return [];

  console.log(`[extractor] 2차 검증: 기획자/마케터 관점 필터링...`);
  await sleep(2000);
  const validated = await validateKeywords(merged, allText.join('\n'));
  console.log(`[extractor] 2차 검증 완료: ${merged.length}개 → ${validated.length}개 통과`);

  return validated;
}

export default { extractKeywords, mergeSimilarKeywords, processBatch };
