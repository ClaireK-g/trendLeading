// Telegram/Discord webhook notifications
import axios from 'axios';
import config from './config.js';
import { logAlert } from './db.js';

export function formatAlertMessage(trendData) {
  const {
    keyword, category, region, reason,
    trendScore, burstRatio, spreadScore, acceleration, uniqueAccounts
  } = trendData;

  let verdict;
  if (trendScore >= 80) verdict = '🔴 매우 강함';
  else if (trendScore >= 60) verdict = '🟠 강함';
  else if (trendScore >= 40) verdict = '🟡 보통';
  else verdict = '🟢 약함';

  const timestamp = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

  return [
    '🚨 마이크로 트렌드 감지',
    '',
    `키워드: ${keyword}`,
    `카테고리: ${category}`,
    `지역: ${region || '전국'}`,
    '',
    '📊 트렌드 지표',
    `├ 트렌드 점수: ${trendScore} ${verdict}`,
    `├ 버스트 비율: ${burstRatio}x (전주 대비)`,
    `├ 확산도: ${spreadScore} (${uniqueAccounts}개 계정)`,
    `└ 가속도: ${acceleration}x`,
    '',
    `💡 분석: ${reason}`,
    '',
    `⏰ ${timestamp}`
  ].join('\n');
}

export async function sendTelegram(message, keyword = 'unknown') {
  const { botToken, chatId } = config.telegram;
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  const res = await axios.post(url, {
    chat_id: chatId,
    text: message,
    parse_mode: 'HTML'
  });

  await logAlert(keyword, 'telegram');
  return res.data;
}

export async function sendAlert(trendData) {
  const message = formatAlertMessage(trendData);

  try {
    await sendTelegram(message, trendData.keyword);
    return { success: true, channels: ['telegram'] };
  } catch (err) {
    console.error(`[alerter] 텔레그램 전송 실패:`, err.message);
    return { success: false, channels: [] };
  }
}

export async function sendDailyDigest(topKeywords) {
  const date = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
  const top10 = topKeywords.slice(0, 10);

  const rows = top10.map((kw, i) => {
    const rank = String(i + 1).padStart(2, ' ');
    const score = String(kw.trendScore ?? kw.score ?? 0).padStart(5, ' ');
    return `${rank}. ${kw.keyword.padEnd(15)} ${score}점  ${kw.category || ''}`;
  });

  const message = [
    `📋 일일 트렌드 리포트 (${date})`,
    '',
    '순위  키워드              점수   카테고리',
    '─'.repeat(45),
    ...rows,
    '',
    `총 ${topKeywords.length}개 트렌드 감지됨`
  ].join('\n');

  const channels = [];

  try {
    if (config.telegram?.botToken) {
      await sendTelegram(message, 'daily_digest');
      channels.push('telegram');
    }
  } catch (err) {
    console.error('[alerter] 일일 리포트 텔레그램 전송 실패:', err.message);
  }

  return { success: channels.length > 0, channels };
}
