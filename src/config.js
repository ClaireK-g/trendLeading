import 'dotenv/config';

export default {
  geminiApiKey: process.env.GEMINI_API_KEY,
  groqApiKey: process.env.GROQ_API_KEY,
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
