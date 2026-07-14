// hot10(buzzAnalysis) 설정 — src/config.js·buzz/config.js와 완전 독립
// (hot10 모듈 격리 원칙, docs/hot10-design.md §1)
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
  telegram: {
    // 봇은 기존 것 재사용. 챗 ID는 HOT10_TELEGRAM_CHAT_ID 우선, 없으면 기존 TELEGRAM_CHAT_ID로 폴백
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.HOT10_TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID,
  },
  // 옵션 소스 — 기본 off(신규 키 필요 또는 크롤링 취약성, 스폰서 결정 사항)
  sources: {
    youtubeEnabled: process.env.HOT10_YOUTUBE_ENABLED === 'true',
    natepannEnabled: process.env.HOT10_NATEPANN_ENABLED === 'true',
  },
  // 소스별 규모 가중치 = reach(도달 규모) × fidelity(신호 충실도) — docs/hot10-design.md §4.1
  // 두 계수를 분리 기재해 신규 소스 추가 시 각각 판단 가능하게 한다.
  sourceWeights: {
    gtrends: { reach: 1.0, fidelity: 1.0 },
    naver_rank: { reach: 1.0, fidelity: 0.9 },
    reddit: { reach: 0.9, fidelity: 0.9 },
    youtube: { reach: 0.8, fidelity: 0.8 },
    wiki: { reach: 0.7, fidelity: 0.7 },
    theqoo: { reach: 0.5, fidelity: 0.8 },
    natepann: { reach: 0.4, fidelity: 0.8 },
    hn: { reach: 0.3, fidelity: 0.8 },
  },
  ranking: {
    crossSourceBonusPerExtra: 0.3, // 교차 등장 보너스 — 소스 1개 추가당 +30%
    persistenceBonusPerRound: 0.1, // 당일 지속성 보너스 — seen_count 1 증가당 +10%
    persistenceMaxRounds: 3, // 최대 캡 (×1.3)
  },
  llm: {
    models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'],
    rateLimitDelay: 15000,
  },
  dbPath: './data/hot10.db',
};
