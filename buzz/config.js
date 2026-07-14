// buzzAnalysis 설정 — src/config.js와 완전 독립 (buzz 모듈 격리 원칙, docs/buzz-analysis-design.md §1)
import 'dotenv/config';

export default {
  // 기존 Gemini 키를 그대로 공유(읽기 전용) — 신규 발급 불필요
  geminiApiKeys: [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY_4,
    process.env.GEMINI_API_KEY_5,
  ].filter(Boolean),
  naverSearch: {
    clientId: process.env.NAVER_SEARCH_CLIENT_ID,
    clientSecret: process.env.NAVER_SEARCH_CLIENT_SECRET,
  },
  naverDatalab: {
    clientId: process.env.NAVER_DATALAB_CLIENT_ID,
    clientSecret: process.env.NAVER_DATALAB_CLIENT_SECRET,
  },
  telegram: {
    // 봇은 기존 것 재사용. 챗 ID는 BUZZ_TELEGRAM_CHAT_ID 우선, 없으면 기존 TELEGRAM_CHAT_ID로 폴백
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.BUZZ_TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID,
  },
  // X(트위터) 보조 수집 — 기본 off (BZ-1 이후 슬라이스에서 사용)
  x: {
    enabled: process.env.BUZZ_X_ENABLED === 'true',
  },
  scoring: {
    // 리스크 경보(감성 급변) 임계값 — 초기값, 변경은 사용자 확인 후 (설계서 §6)
    riskNegativeRatio: 0.3,
    riskNegativeMinCount: 5,
    riskNegativeDeltaPP: 15,
    // 스파이크(버즈량 급증) 임계값
    spikeRatio: 3.0,
    spikeMinVolume: 10,
  },
  llm: {
    models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'],
    batchSize: 30,
    rateLimitDelay: 15000,
    interBatchDelay: 2000,
  },
  dbPath: './data/buzz.db',
};
