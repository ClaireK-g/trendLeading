// agents-slack 설정 — env → 설정 매핑. 루트 config.js와 동일한 dotenv 패턴.
import 'dotenv/config';

export default {
  // 프로바이더 선택: auto|gemini|anthropic. auto = 무료 Gemini 우선(hermes-dev 원칙).
  provider: process.env.AGENT_PROVIDER || 'auto',

  // 무료 Gemini (주력) — 루트 파이프라인과 키를 공유한다.
  geminiApiKeys: [process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2].filter(Boolean),
  gemini: {
    expertModel: process.env.AGENT_GEMINI_MODEL || 'gemini-2.5-flash',
    synthModel: process.env.AGENT_GEMINI_SYNTH_MODEL || 'gemini-2.5-flash',
  },

  // Anthropic (옵션, 유료) — 명시적 opt-in일 때만.
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    expertModel: process.env.AGENT_EXPERT_MODEL || 'claude-sonnet-5',
    synthModel: process.env.AGENT_SYNTH_MODEL || 'claude-opus-4-8',
  },

  // 프로바이더 공통 출력 토큰 상한.
  maxTokens: parseInt(process.env.AGENT_MAX_TOKENS || '1024', 10),

  slack: {
    botToken: process.env.SLACK_BOT_TOKEN,
    appToken: process.env.SLACK_APP_TOKEN, // Socket Mode용 (xapp-)
    signingSecret: process.env.SLACK_SIGNING_SECRET,
  },
  discussion: {
    // 전문가 발언 라운드 수 (신디사이저 종합은 별도). 비용·RPM 고려해 기본 2.
    rounds: parseInt(process.env.AGENT_ROUNDS || '2', 10),
    // 각 발언 사이 지연(ms) — Slack rate limit·LLM RPM 완화.
    turnDelay: parseInt(process.env.AGENT_TURN_DELAY || '800', 10),
  },
  // 키 없이 배선(orchestration/Slack 포맷)을 검증하는 목업 모드.
  mockLLM: process.env.MOCK_LLM === 'true',
};
