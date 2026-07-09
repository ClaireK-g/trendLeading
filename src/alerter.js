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
  if (trendScore > 5) verdict = '🔴 급상승';
  else if (trendScore > 3.5) verdict = '🟠 강함';
  else if (trendScore > 2.5) verdict = '🟡 주목';
  else if (trendScore > 1) verdict = '🟢 관찰';
  else verdict = '⚪ 미약';

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

function naverSearchLink(term) {
  return `https://search.naver.com/search.naver?query=${encodeURIComponent(term)}`;
}

export async function sendDailyDigest(topKeywords) {
  const date = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
  const time = new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' });

  // searchable:false(검증 실패)는 상위 랭킹에서 빼고 별도 "검증 필요" 섹션으로 분리 (콘크리트 사건 방지)
  const verified = topKeywords.filter(kw => kw.searchable !== false);
  const needsVerification = topKeywords.filter(kw => kw.searchable === false);
  const top10 = verified.slice(0, 10);

  const rows = top10.map((kw, i) => {
    const rank = String(i + 1).padStart(2, ' ');
    const name = (kw.keyword || '').padEnd(12);
    const score = kw.trendScore != null ? kw.trendScore.toFixed?.(1) ?? kw.trendScore : '-';

    let heat;
    if (kw.trendScore > 5) heat = '🔴';
    else if (kw.trendScore > 3.5) heat = '🟠';
    else if (kw.trendScore > 2.5) heat = '🟡';
    else if (kw.trendScore > 1) heat = '🟢';
    else heat = '⚪';

    const level = kw.levelLabel || kw.trendLevel || '';
    const trend = kw.searchTrend || '';
    const parts = [`${rank}. ${heat} ${name} ${String(score).padStart(5)}`];
    if (level && level !== '⚪ 관찰 중') parts.push(level);
    if (trend) parts.push(trend);
    const lines = [parts.join('  ')];
    if (kw.reason) lines.push(`     └ ${kw.reason}`);

    const searchTerm = kw.searchKeyword || kw.keyword;
    if (searchTerm) lines.push(`     └ 🔎 검색: ${naverSearchLink(searchTerm)}`);
    if (kw.sourceUrl) lines.push(`     └ 📰 근거: ${kw.sourceUrl}`);
    if (kw.docCount != null) lines.push(`     └ 📄 경쟁 블로그 글: 약 ${kw.docCount}건`);

    return lines.join('\n');
  });

  // 탐침 급등 섹션
  const probeSpikes = topKeywords.probeSpikes || [];
  const probeRows = probeSpikes.slice(0, 8).map(s =>
    `  ${s.signal} ${s.keyword}: +${s.changeRate}% (${s.prevAvg}→${s.recentAvg})`
  );

  // 검증 필요 섹션 — 검색 결과 없음/동음이의 오염 의심 (수동 확인 필요)
  const verifyRows = needsVerification.slice(0, 5).map(kw =>
    `  ⚠️ ${kw.keyword} — 검색 결과 없음/불일치 의심 (수동 확인 필요)`
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

  if (verifyRows.length) {
    sections.push(
      '',
      '■ 검증 필요 (검색 안 되는 키워드 — 자동 제외됨)',
      '━━━━━━━━━━━━━━━━━━━━━━',
      ...verifyRows,
    );
  }

  sections.push(
    '',
    `총 ${top10.length + probeSpikes.length}개 시그널 감지`,
    '🔴5+ 🟠3.5+ 🟡2.5+ 🟢1+ ⚪미약',
  );

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
