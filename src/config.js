import 'dotenv/config';

export default {
  geminiApiKey: process.env.GEMINI_API_KEY,
  groqApiKey: process.env.GROQ_API_KEY,
  // 네이버 블로그/뉴스 검색용 (검색 API 권한 앱)
  naverSearch: {
    clientId: process.env.NAVER_SEARCH_CLIENT_ID,
    clientSecret: process.env.NAVER_SEARCH_CLIENT_SECRET,
  },
  // 네이버 데이터랩 검색어트렌드용 (데이터랩 권한 앱)
  naverDatalab: {
    clientId: process.env.NAVER_DATALAB_CLIENT_ID,
    clientSecret: process.env.NAVER_DATALAB_CLIENT_SECRET,
  },
  // Instagram 수집 — 기본 비활성. 메인 파이프라인과 의존성 분리.
  // 켜려면 .env에 INSTAGRAM_ENABLED=true
  instagram: {
    enabled: process.env.INSTAGRAM_ENABLED === 'true',
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
  },
  scoring: {
    burstThreshold: 3.0,
    alertMinConfidence: 4,
    alertMinAccounts: 5,
    alertCooldownHours: 72,
  },
  scraper: {
    maxPostsPerAccount: 10,
    requestDelay: [1000, 3000],
    hashtagsToTrack: ['맛집', '디저트맛집', '서울맛집', '핫플', '성수맛집', '광화문맛집', '카페추천'],
  },
  llm: {
    model: 'gemini-2.5-flash',
    maxRetries: 3,
    batchSize: 8,
    rateLimitDelay: 4000,
  },
  dbPath: './data/trend.db',
};
