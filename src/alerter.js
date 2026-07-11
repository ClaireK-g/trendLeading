// Telegram/Discord webhook notifications
import axios from 'axios';
import config from './config.js';
import { logAlert, getRecentDigestTopKeywords, getRecentProbeSpikeKeywords } from './db.js';

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

const CONTENT_TYPE_TAGS = {
  '방송미디어': '📺 방송미디어',
  '신메뉴출시': '🆕 신메뉴출시',
  '지역맛집': '📍 지역맛집',
  '식문화현상': '🌊 식문화현상',
  '시즌성': '🗓️ 시즌성',
};

function heatIcon(trendScore) {
  if (trendScore > 5) return '🔴';
  if (trendScore > 3.5) return '🟠';
  if (trendScore > 2.5) return '🟡';
  if (trendScore > 1) return '🟢';
  return '⚪';
}

// 리포트 한 줄(키워드 라인 + 근거/링크 줄들)을 만든다. 황금 소재/관찰 중 섹션이 공유한다.
function formatDigestRow(kw, rank) {
  const name = (kw.keyword || '').padEnd(12);
  const score = kw.trendScore != null ? kw.trendScore.toFixed?.(1) ?? kw.trendScore : '-';
  const tag = CONTENT_TYPE_TAGS[kw.contentType] || '';
  const level = kw.levelLabel || kw.trendLevel || '';

  const parts = [`${rank}. ${heatIcon(kw.trendScore)} ${name} ${String(score).padStart(5)}`];
  if (tag) parts.push(tag);
  if (level && level !== '⚪ 관찰 중') parts.push(level);

  const lines = [parts.join('  ')];
  if (kw.reason) lines.push(`     └ ${kw.reason}`);

  const searchTerm = kw.searchKeyword || kw.keyword;
  if (searchTerm) lines.push(`     └ 🔎 검색: ${naverSearchLink(searchTerm)}`);
  if (kw.sourceUrl) lines.push(`     └ 📰 근거: ${kw.sourceUrl}`);
  if (kw.docCount != null) lines.push(`     └ 📄 경쟁 블로그 글: 약 ${kw.docCount}건`);

  return lines.join('\n');
}

export async function sendDailyDigest(topKeywords) {
  const date = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
  const time = new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' });
  const probeSpikes = topKeywords.probeSpikes || [];

  // searchable:false(검증 실패)는 상위 랭킹에서 빼고 별도 "검증 필요" 섹션으로 분리 (콘크리트 사건 방지)
  const verified = topKeywords.filter(kw => kw.searchable !== false);
  const needsVerification = topKeywords.filter(kw => kw.searchable === false);

  // activeDays<3(신규) = 오늘의 황금 소재, 그 이상(지속 노출) = 관찰 중 — 새 소재와 지속 트렌드를 분리
  // 표기한다(blog-traffic-dev 스킬 §4). topKeywords는 이미 finalScore(opportunityScore 반영) 내림차순.
  let recentGoldenKeywords = new Set();
  try {
    recentGoldenKeywords = getRecentDigestTopKeywords(7);
  } catch (err) {
    console.warn('[alerter] 다이제스트 쿨다운 조회 실패 (무시):', err.message);
  }

  const goldenCandidates = verified.filter(kw => (kw.activeDays ?? 0) < 3);
  // 최근 7일 내 이미 "황금 소재"로 나갔던 키워드는 쿨다운 — 다음날 "관찰 중"으로 되돌리지 않고
  // 리포트에서 제외한다(어제 황금 소재가 오늘 관찰 중에 재등장하는 반복 체감의 주범).
  // 진짜 지속 트렌드면 activeDays>=3이 되는 시점에 관찰 중으로 자연 재진입한다.
  const golden = goldenCandidates.filter(kw => !recentGoldenKeywords.has((kw.keyword || '').trim().toLowerCase())).slice(0, 5);
  const observing = verified.filter(kw => (kw.activeDays ?? 0) >= 3)
    .sort((a, b) => (b.finalScore ?? b.trendScore ?? 0) - (a.finalScore ?? a.trendScore ?? 0))
    .slice(0, 5);

  const goldenRows = golden.map((kw, i) => formatDigestRow(kw, i + 1));
  const observingRows = observing.map((kw, i) => formatDigestRow(kw, i + 1));

  // 오늘 "황금 소재"로 노출된 키워드를 기록 — 다음 7일간 쿨다운 대상이 된다
  for (const kw of golden) {
    try {
      logAlert(kw.keyword, 'digest_top');
    } catch (err) {
      console.warn(`[alerter] 다이제스트 쿨다운 기록 실패 (${kw.keyword}):`, err.message);
    }
  }

  // 데이터랩 급등 쿨다운 — 최근 3일 내 이미 리포트한 급등 키워드는 제외(롤링 윈도 재감지 반복 방지)
  let recentProbeSpikes = new Set();
  try {
    recentProbeSpikes = getRecentProbeSpikeKeywords(3);
  } catch (err) {
    console.warn('[alerter] 탐침 쿨다운 조회 실패 (무시):', err.message);
  }
  const freshSpikes = probeSpikes
    .filter(s => !recentProbeSpikes.has((s.keyword || '').trim().toLowerCase()))
    .slice(0, 8);

  const probeRows = freshSpikes.map(s =>
    `  ${s.signal} ${s.keyword}: +${s.changeRate}% (${s.prevAvg}→${s.recentAvg})`
  );

  // 오늘 리포트한 급등 키워드 기록 — 다음 3일간 쿨다운 대상
  for (const s of freshSpikes) {
    try {
      logAlert(s.keyword, 'probe_spike');
    } catch (err) {
      console.warn(`[alerter] 탐침 쿨다운 기록 실패 (${s.keyword}):`, err.message);
    }
  }

  // 검증 필요 섹션 — 검색 결과 없음/동음이의 오염 의심 (수동 확인 필요)
  const verifyRows = needsVerification.slice(0, 5).map(kw =>
    `  ⚠️ ${kw.keyword} — 검색 결과 없음/불일치 의심 (수동 확인 필요)`
  );

  const sections = [
    `🔍 trendLeading 블로그 소재 리포트`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `📅 ${date} ${time} — 오늘 글감 추천`,
  ];

  if (probeRows.length) {
    sections.push(
      '',
      '■ 데이터랩 검색량 급등 (선행 시그널)',
      '━━━━━━━━━━━━━━━━━━━━━━',
      ...probeRows,
    );
  }

  if (goldenRows.length) {
    sections.push(
      '',
      '■ 🥇 오늘의 황금 소재 (수요↑ 경쟁↓)',
      '━━━━━━━━━━━━━━━━━━━━━━',
      ...goldenRows,
    );
  }

  if (observingRows.length) {
    sections.push(
      '',
      '■ 관찰 중 (지속 트렌드)',
      '━━━━━━━━━━━━━━━━━━━━━━',
      ...observingRows,
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
    `총 ${goldenRows.length + observingRows.length + probeRows.length}개 시그널 감지`,
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
