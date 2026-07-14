// Gemini 호출 유틸 — 키 로테이션·모델 폴백·429/503 처리. src/extractor.js·buzz/lib/gemini.js와
// 완전 독립 구현(hot10 모듈 격리 원칙). 무료 티어 제약 대응 패턴은 동일하게 이식.
import axios from 'axios';
import config from '../config.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_RETRIES = 3;

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

// prompt(시스템+데이터 전체)를 받아 JSON을 반환. 모든 모델·재시도 실패 시 [] (fail-open).
export async function callGeminiJSON(prompt) {
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
  };
  const axiosOpts = { headers: { 'Content-Type': 'application/json' }, timeout: 90000 };

  for (const model of config.llm.models) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const url = `${GEMINI_BASE}/${model}:generateContent?key=${getNextApiKey()}`;
        const response = await axios.post(url, body, axiosOpts);
        const text = response.data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
        if (model !== config.llm.models[0]) console.log(`[hot10:gemini] ${model} 사용`);
        return JSON.parse(text);
      } catch (err) {
        const status = err.response?.status;
        const isRateLimit = status === 429;
        const isOverloaded = status === 503;
        if (isOverloaded && attempt === 0) break; // 다음 모델로 즉시 전환
        if (attempt < MAX_RETRIES - 1) {
          const delay = isRateLimit ? config.llm.rateLimitDelay : Math.pow(2, attempt) * 2000;
          console.warn(`[hot10:gemini] ${model} 실패 (${status}, 시도 ${attempt + 1}/${MAX_RETRIES}), ${delay / 1000}초 후 재시도...`);
          await sleep(delay);
        }
      }
    }
    console.warn(`[hot10:gemini] ${model} 실패, 다음 모델 시도...`);
  }
  console.error('[hot10:gemini] 모든 모델 실패');
  return [];
}
