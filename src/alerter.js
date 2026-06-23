// Telegram/Discord webhook notifications
import axios from 'axios';
import config from './config.js';
import { logAlert } from './db.js';

export function formatAlertMessage(trendData) {
  const {
    keyword, category, region, reason,
    trendScore, burstRatio, spreadScore, acceleration, uniqueAccounts,
    trendLevel, levelLabel, activeDays, spanDays, sources
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
    `트렌드 레벨: ${levelLabel || '⚪ 관찰 중'}`,
    '',
    '📊 트렌드 지표',
    `├ 트렌드 점수: ${trendScore} ${verdict}`,
    `├ 버스트 비율: ${burstRatio}x (전주 대비)`,
    `├ 확산도: ${spreadScore} (${uniqueAccounts}개 계정)`,
    `├ 가속도: ${acceleration}x`,
    `├ 누적 일수: ${activeDays ?? 0}일 / ${spanDays ?? 0}일`,
    `└ 수집 소스: ${sources || 'Instagram'}`,
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
  const time = new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' });
  const top10 = topKeywords.slice(0, 10);

  const rows = top10.map((kw, i) => {
    const rank = String(i + 1).padStart(2, ' ');
    const name = (kw.keyword || '').padEnd(12);
    const score = kw.trendScore != null ? String(kw.trendScore.toFixed?.(1) ?? kw.trendScore).padStart(5) : '  -  ';
    const level = kw.levelLabel || kw.trendLevel || '⚪';
    const trend = kw.searchTrend || '';
    return `${rank}. ${name} ${score}  ${level}  ${trend}`;
  });

  // 탐침 급등 섹션
  const probeSpikes = topKeywords.probeSpikes || [];
  const probeRows = probeSpikes.slice(0, 8).map(s =>
    `  ${s.signal} ${s.keyword}: +${s.changeRate}% (${s.prevAvg}→${s.recentAvg})`
  );

  const sections = [
    `🔍 trendLeading 일일 리포트`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `📅 ${date} ${time}`,
  ];

  if (probeRows.length) {
    sections.push(
      '',
      '■ 데이터랩 검색량 급등 (선행 시그널)',
      '━━━━━━━━━━━━━━━━━━━━━━',
      ...probeRows,
    );
  }

  if (rows.length) {
    sections.push(
      '',
      '■ LLM 추출 트렌드 키워드',
      '━━━━━━━━━━━━━━━━━━━━━━',
      ...rows,
    );
  }

  sections.push('', `총 ${top10.length + probeSpikes.length}개 시그널 감지`);

  const message = sections.join('\n');

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
