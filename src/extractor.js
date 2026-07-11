// LLM-based entity extraction (Gemini API)
import axios from "axios";
import config from "./config.js";
import { isBlacklisted } from "./blacklist.js";
import { fetchTrendIntelligence } from "./trend-intel.js";
import { getRecentExtractedKeywords } from "./db.js";
import { findCanonical } from "./keyword-canon.js";

let _trendIntel = null;

async function getTrendIntel() {
  if (!_trendIntel) _trendIntel = await fetchTrendIntelligence();
  return _trendIntel;
}

export function resetTrendIntel() { _trendIntel = null; }

function buildSystemPrompt(today, excludeKeywords = []) {
  const excludeBlock = excludeKeywords.length
    ? `\n# 이미 발견된 키워드 (제외 대상 — 동일·유사 변형 포함)\n이 목록과 겹치는 키워드는 완전히 새로운 급등 근거(원문에 명시된 새로운 신선도 신호)가 없는 한 출력하지 마라:\n${excludeKeywords.join(", ")}\n`
    : "";

  return `너는 대한민국 F&B 업계의 '넥스트 트렌드'만 포착하는 초정밀 트렌드 스나이퍼이다.

오늘 날짜: ${today}
트렌드 판단 기준 시점: 오늘로부터 2~3일 이내. 1주일 전 유행도 이미 늦을 수 있다.

# 미션
인스타그램 텍스트에서 "지금 이 순간 막 태동하는" 마이크로 트렌드만 추출하라.
핵심은 '신선도(Freshness)' — 트렌드는 하루하루가 다르다.
${excludeBlock}
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

# search_keyword 규칙 (매우 중요 — 검색 안 되는 키워드는 쓸모없다)
keyword와 별개로 "네이버에 그대로 검색했을 때 이 소재가 검색되는 형태"를 search_keyword에 담아라:
1. 단독 검색으로 의미가 통해야 한다: 브랜드+메뉴("버거킹 콘크리트"), 지역+가게명("성수 설이동"),
   프로그램+소재("언더커버 쉐프 식당"). keyword 자체가 이미 이런 형태면 keyword와 동일하게 채워도 된다.
2. 일반명사·동음이의어를 단독으로 쓰지 마라 (예: "콘크리트", "테이크" 단독 금지 — 건축자재 등과 혼동됨).
3. 원문에서 브랜드/지역/출처를 찾을 수 없으면 search_keyword를 null로 두고 confidence_score를 1 낮춰라.
   추측으로 브랜드를 지어내는 것은 브랜드를 아예 누락하는 것보다 나쁘다.
4. 여러 브랜드가 나열된 뉴스 요약기사(예: "[오늘 뭐 먹지] A사·B사·C사 외...")에서는 브랜드-메뉴 연결이
   끊기기 쉽다 — reason에 브랜드가 원문 근거와 함께 명시되지 않으면 search_keyword를 null로 둬라.

# 출력
JSON 배열만 출력. confidence_score 3 이상만. 없으면 [].
[{"keyword":"","search_keyword":"","category":"디저트/메뉴/매장명(지역)/식문화현상","region":null,"reason":"","confidence_score":3,"co_keywords":[],"freshness_signal":"원문 인용"}]`;
}

function buildCriticPrompt(today) {
  return `너는 극도로 까다로운 F&B 트렌드 리서처이자 통계학자다. Generator AI가 추출한 트렌드 후보 목록의 허점과 논리적 오류를 찾아 사정없이 비판하는 것이 임무다.

오늘 날짜: ${today}

# 비판 가이드라인
각 키워드에 대해 아래 질문을 던져라:
1. "표본이 너무 적어 우연히 겹친 것 아닌가?" — 1~2개 게시글 언급은 통계적 착시일 수 있다
2. "이미 알려진 트렌드의 변형 아닌가?" — 기존 유행어를 살짝 바꾼 것은 신규가 아니다
3. "너무 추상적이거나 카테고리명 아닌가?" — 구체성 없는 키워드는 트렌드 시그널이 아니다
4. "freshness_signal(원문 인용)이 실제로 '처음 봤다' 반응인가, 아니면 단순 소개글인가?"
5. "이 키워드가 진짜 마이크로 트렌드라면, 왜 아직 뉴스에 안 나왔을까? 납득 가능한가?"
6. "search_keyword가 단독 검색해도 이 소재로 검색되는 형태인가, 아니면 동음이의어/일반명사라
   다른 걸 검색하게 되는가?" — 후자면 WARN 또는 REJECT (예: "콘크리트"만 있으면 건축자재와 혼동)

# 출력 형식
JSON 배열. 각 항목에 verdict(PASS/WARN/REJECT)와 critique 포함. 없으면 [].
[{"keyword":"","verdict":"PASS|WARN|REJECT","critique":"비판 내용. PASS면 '반론 없음' 명시","weaknesses":["약점1","약점2"]}]`;
}

function buildSynthesizerPrompt(today, newsHeadlines) {
  return `너는 F&B 트렌드 팀의 최종 의사결정자다. Generator의 초안과 Critic의 날카로운 비판을 종합하여 가장 방어 가능하고 정확한 최종 트렌드 목록을 만들어라.

오늘 날짜: ${today}
트렌드 판단 기준: 오늘 기준 2~3일 이내 신선도.

# 오늘의 실시간 뉴스 헤드라인
${newsHeadlines}

# 합성 규칙
1. Critic이 REJECT한 키워드는 제거하라. 예외 없다.
2. Critic이 WARN한 키워드는 보수적으로 재평가하라. weaknesses가 치명적이면 탈락.
3. Critic이 PASS한 키워드만 confidence_score를 유지하거나 올릴 수 있다.
4. WARN 생존 키워드는 confidence_score를 -1 하향하고 validation_note에 Critic 지적을 반영하라.
5. Critic 비판을 거쳐 살아남은 것만 최종 목록에 남겨라. 의심스러우면 과감히 버려라.

# 탈락 기준 (최종 보루)
- 매년 반복 계절 음식, 일반 카테고리명, 이미 대중화된 메인스트림
- search_keyword가 없거나(null) 동음이의어 단독 형태면 그대로 null 유지 — 추측으로 채우지 마라

# content_type 분류 (블로그 글감 유형 — 아래 5개 중 하나)
- 방송미디어: TV/OTT/유튜브 방송에서 소개된 식당/메뉴. "~에 나온", "~에 나왔던" 표현
- 신메뉴출시: 브랜드/매장의 신제품·시그니처 메뉴 출시 발표
- 지역맛집: 특정 지역의 신규/오픈런 매장 (매장명·지역명이 핵심)
- 식문화현상: 특정 매장에 종속되지 않는 새로운 소비 패턴·트렌드 현상
- 시즌성: 매년 반복되지만 시즌 초입이라 아직 콘텐츠가 적은 소재. Critic이 "매년 반복"으로 REJECT하지
  않았고 살아남았다면, 계절 반복 자체를 이유로 탈락시키지 말고 이 태그로 분류하라(시즌 초입 선점은
  유효한 글감이다 — blog-traffic-dev 스킬 §5)

# 출력
최종 통과 키워드만 JSON 배열. validation_note 포함. 없으면 [].
[{"keyword":"","search_keyword":"","category":"","region":null,"reason":"","confidence_score":3,"co_keywords":[],"freshness_signal":"","validation_note":"","content_type":"방송미디어|신메뉴출시|지역맛집|식문화현상|시즌성"}]`;
}

const MAX_CHAR_PER_BATCH = 12000;
const BATCH_SIZE = 30;
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

let _keyIndex = 0;
function getNextApiKey() {
  const keys = config.geminiApiKeys || [];
  if (!keys.length) throw new Error('GEMINI_API_KEY 미설정');
  const key = keys[_keyIndex % keys.length];
  _keyIndex++;
  return key;
}

async function callGemini(textChunk, excludeKeywords = []) {
  const intel = await getTrendIntel();
  const sysPrompt = buildSystemPrompt(intel.date, excludeKeywords);
  const prompt = sysPrompt + "\n\n# 분석할 데이터\n" + textChunk;
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
  };
  const axiosOpts = { headers: { "Content-Type": "application/json" }, timeout: 90000 };

  for (const model of GEMINI_MODELS) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const url = `${GEMINI_BASE}/${model}:generateContent?key=${getNextApiKey()}`;
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

export async function extractKeywords(textBatch, excludeKeywords = []) {
  const chunks = buildTextBlock(textBatch);
  const allKeywords = [];

  for (const chunk of chunks) {
    let keywords;
    try {
      keywords = await callGemini(chunk, excludeKeywords);
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

async function callGeminiRaw(prompt, temperature = 0.1) {
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", temperature },
  };
  const axiosOpts = { headers: { "Content-Type": "application/json" }, timeout: 90000 };

  for (const model of GEMINI_MODELS) {
    try {
      const url = `${GEMINI_BASE}/${model}:generateContent?key=${getNextApiKey()}`;
      const response = await axios.post(url, body, axiosOpts);
      const text = response.data.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
      return JSON.parse(text);
    } catch (err) {
      console.warn(`[extractor] ${model} 실패, 다음 모델 시도...`);
    }
  }
  return null;
}

async function criticKeywords(keywords, today) {
  const criticPrompt = buildCriticPrompt(today) +
    "\n\n# Generator 추출 결과 (비판 대상)\n" + JSON.stringify(keywords, null, 2);

  const result = await callGeminiRaw(criticPrompt, 0.1);
  if (!Array.isArray(result)) return [];
  return result;
}

async function synthesizeKeywords(generatorOutput, criticOutput, intel, originalText) {
  const synthPrompt = buildSynthesizerPrompt(intel.date, intel.headlines) +
    "\n\n# Generator 초안\n" + JSON.stringify(generatorOutput, null, 2) +
    "\n\n# Critic 비판 결과\n" + JSON.stringify(criticOutput, null, 2) +
    "\n\n# 원본 텍스트 (참고용)\n" + originalText.slice(0, 2000);

  const result = await callGeminiRaw(synthPrompt, 0.1);
  if (!Array.isArray(result)) return generatorOutput; // fallback
  return result;
}

export async function processBatch(posts) {
  resetTrendIntel();
  const batches = [];
  for (let i = 0; i < posts.length; i += BATCH_SIZE) {
    batches.push(posts.slice(i, i + BATCH_SIZE));
  }

  let excludeKeywords = [];
  try {
    excludeKeywords = getRecentExtractedKeywords(7, 40);
  } catch (err) {
    console.warn(`[extractor] 기추출 키워드 조회 실패 (무시): ${err.message}`);
  }
  if (excludeKeywords.length) {
    console.log(`[extractor] 최근 7일 기추출 키워드 ${excludeKeywords.length}개 프롬프트 제외 목록으로 주입`);
  }

  const total = batches.length;
  const allKeywords = [];
  const allText = [];

  for (let i = 0; i < batches.length; i++) {
    console.log(`[extractor] 1차 추출: Gemini API 호출 (${i + 1}/${total})...`);
    const keywords = await extractKeywords(batches[i], excludeKeywords);
    allKeywords.push(...keywords);
    allText.push(...batches[i].map(p => p.caption || ''));

    if (i < batches.length - 1) await sleep(2000);
  }

  const merged = mergeSimilarKeywords(allKeywords);
  console.log(`[extractor] 1차 추출(Generator) 완료: ${merged.length}개 후보`);

  if (!merged.length) return [];

  const intel = await getTrendIntel();

  // 2단계: Critic — Generator 허점 비판
  console.log(`[extractor] 2차 비판(Critic): 통계적 착시·논리 오류 검증...`);
  await sleep(2000);
  const criticResult = await criticKeywords(merged, intel.date);
  const rejectSet = new Set(
    criticResult.filter(c => c.verdict === 'REJECT').map(c => c.keyword?.toLowerCase())
  );
  const warnMap = new Map(
    criticResult.filter(c => c.verdict === 'WARN').map(c => [c.keyword?.toLowerCase(), c])
  );
  const afterCritic = merged.filter(kw => !rejectSet.has(kw.keyword?.toLowerCase()));
  console.log(`[extractor] Critic 완료: ${merged.length}개 → REJECT ${rejectSet.size}개 제거 → ${afterCritic.length}개 생존`);

  if (!afterCritic.length) return [];

  // 3단계: Synthesizer — Critic 반영 최종 정제
  console.log(`[extractor] 3차 종합(Synthesizer): 최종 정교화...`);
  await sleep(2000);
  const synthesized = await synthesizeKeywords(afterCritic, criticResult, intel, allText.join('\n'));
  console.log(`[extractor] Synthesizer 완료: ${afterCritic.length}개 → ${synthesized.length}개 최종 통과`);

  // 4단계: 변형 표준화 — 최근 7일 기추출 키워드와 핵심 토큰이 겹치는 변형("우베 (Ube) 디저트" 등)은
  // 기존 키워드명으로 병합한다. 프롬프트 제외(P0-3)는 표기를 바꾼 변형에 뚫리므로 코드 레벨에서 막는다.
  // 병합하면 daily stats가 한 키워드로 누적돼 activeDays/쿨다운이 정상 작동한다.
  let canonPool = [];
  try {
    canonPool = getRecentExtractedKeywords(7, 200);
  } catch (err) {
    console.warn(`[extractor] 표준화 풀 조회 실패 (무시): ${err.message}`);
  }
  const seen = new Set();
  const canonical = [];
  for (const kw of synthesized) {
    const canon = findCanonical(kw.keyword, canonPool);
    if (canon && canon.trim().toLowerCase() !== (kw.keyword || '').trim().toLowerCase()) {
      console.log(`[extractor] 변형 표준화: "${kw.keyword}" → "${canon}"`);
      kw.keyword = canon;
    }
    const key = (kw.keyword || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue; // 같은 키워드로 접힌 당일 중복 제거
    seen.add(key);
    canonPool.push(kw.keyword); // 당일 내 변형도 서로 병합되도록 풀에 추가
    canonical.push(kw);
  }
  if (canonical.length !== synthesized.length) {
    console.log(`[extractor] 변형 표준화 완료: ${synthesized.length}개 → ${canonical.length}개 (중복 병합)`);
  }

  return canonical;
}

export default { extractKeywords, mergeSimilarKeywords, processBatch };