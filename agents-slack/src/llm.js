// 프로바이더 무관 LLM 채팅 계층 (hermes-dev 스킬 규칙 구현).
// 무료 Gemini 주력 + Anthropic 옵션. 호출부는 프로바이더를 몰라도 된다.
//
// Gemini 패턴은 src/extractor.js에서 검증된 것을 재사용: 모델 폴백 체인,
// 키 로테이션, 429=15초 재시도 / 503=즉시 다음 모델.

import axios from 'axios';
import config from './config.js';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── 프로바이더 결정 ────────────────────────────────────────────────
// auto = 무료 우선: Gemini 키 있으면 gemini, 없으면 anthropic.
export function resolveProvider() {
  const p = config.provider;
  if (p === 'gemini' || p === 'anthropic') return p;
  if (config.geminiApiKeys.length) return 'gemini';
  if (config.anthropic.apiKey) return 'anthropic';
  return 'none';
}

// tier: 'expert' | 'synth' → 프로바이더별 모델 이름 해석.
function modelFor(provider, tier) {
  if (provider === 'gemini') {
    return tier === 'synth' ? config.gemini.synthModel : config.gemini.expertModel;
  }
  return tier === 'synth' ? config.anthropic.synthModel : config.anthropic.expertModel;
}

// ── Gemini ─────────────────────────────────────────────────────────
const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-2.5-flash-lite'];
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_RETRIES = 3;

let _keyIndex = 0;
function nextGeminiKey() {
  const keys = config.geminiApiKeys;
  if (!keys.length) throw new Error('GEMINI_API_KEY 미설정');
  const key = keys[_keyIndex % keys.length];
  _keyIndex++;
  return key;
}

// 선호 모델을 폴백 체인 맨 앞에 두고 중복 제거.
function geminiChain(preferred) {
  return [preferred, ...GEMINI_MODELS.filter((m) => m !== preferred)];
}

async function chatGemini({ system, user, tier, temperature }) {
  const preferred = modelFor('gemini', tier);
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: {
      temperature: temperature ?? 0.5,
      maxOutputTokens: config.maxTokens,
    },
  };
  const opts = { headers: { 'Content-Type': 'application/json' }, timeout: 90000 };

  for (const model of geminiChain(preferred)) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const url = `${GEMINI_BASE}/${model}:generateContent?key=${nextGeminiKey()}`;
        const resp = await axios.post(url, body, opts);
        const text = resp.data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        if (model !== preferred) console.log(`[llm] gemini ${model} 사용(폴백)`);
        return text.trim() || '(응답 없음)';
      } catch (err) {
        const status = err.response?.status;
        if (status === 503 && attempt === 0) break; // 즉시 다음 모델
        if (attempt < MAX_RETRIES - 1) {
          const delay = status === 429 ? 15000 : Math.pow(2, attempt) * 2000;
          console.warn(`[llm] gemini ${model} 실패(${status}, ${attempt + 1}/${MAX_RETRIES}), ${delay / 1000}s 후 재시도`);
          await sleep(delay);
        }
      }
    }
    console.warn(`[llm] gemini ${model} 실패 → 다음 모델`);
  }
  throw new Error('gemini 모든 모델 실패');
}

// ── Anthropic ──────────────────────────────────────────────────────
let _anthropic = null;
async function getAnthropic() {
  if (_anthropic) return _anthropic;
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  _anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });
  return _anthropic;
}

async function chatAnthropic({ system, user, tier, temperature }) {
  const client = await getAnthropic();
  const resp = await client.messages.create({
    model: modelFor('anthropic', tier),
    max_tokens: config.maxTokens,
    temperature: temperature ?? 0.5,
    system,
    messages: [{ role: 'user', content: user }],
  });
  const text = resp.content
    ?.filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  return text || '(응답 없음)';
}

// ── 공개 API ───────────────────────────────────────────────────────
// { system, user, tier='expert', temperature? } → 응답 텍스트
export async function chat({ system, user, tier = 'expert', temperature }) {
  const provider = resolveProvider();
  if (provider === 'gemini') return chatGemini({ system, user, tier, temperature });
  if (provider === 'anthropic') return chatAnthropic({ system, user, tier, temperature });
  throw new Error(
    'LLM 키 없음: GEMINI_API_KEY(무료 권장) 또는 ANTHROPIC_API_KEY 설정, 혹은 MOCK_LLM=true'
  );
}

export function activeProviderLabel() {
  const p = resolveProvider();
  if (p === 'gemini') return `Gemini(무료) · ${config.gemini.expertModel}`;
  if (p === 'anthropic') return `Anthropic · ${config.anthropic.expertModel}`;
  return '없음';
}
