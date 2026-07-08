// agents-slack 설정 — env → 설정 매핑. 루트 config.js와 동일한 dotenv 패턴.
import 'dotenv/config';

export default {
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    // 전문가 에이전트용 모델 (빠르고 유능). 논의는 다수 호출이라 비용을 고려.
    expertModel: process.env.AGENT_EXPERT_MODEL || 'claude-sonnet-5',
    // 신디사이저(최종 종합)용 모델 — 더 강한 추론.
    synthModel: process.env.AGENT_SYNTH_MODEL || 'claude-opus-4-8',
    maxTokens: parseInt(process.env.AGENT_MAX_TOKENS || '1024', 10),
  },
  slack: {
    botToken: process.env.SLACK_BOT_TOKEN,
    appToken: process.env.SLACK_APP_TOKEN, // Socket Mode용 (xapp-)
    signingSecret: process.env.SLACK_SIGNING_SECRET,
  },
  discussion: {
    // 전문가 발언 라운드 수 (신디사이저 종합은 별도). 비용·RPM 고려해 기본 2.
    rounds: parseInt(process.env.AGENT_ROUNDS || '2', 10),
    // 각 발언 사이 지연(ms) — Slack rate limit·Anthropic RPM 완화.
    turnDelay: parseInt(process.env.AGENT_TURN_DELAY || '800', 10),
  },
  // 키 없이 배선(orchestration/Slack 포맷)을 검증하는 목업 모드.
  // 루트 파이프라인의 `node index.js test` 철학과 동일 — 외부 의존 없이 흐름 확인.
  mockLLM: process.env.MOCK_LLM === 'true',
};
