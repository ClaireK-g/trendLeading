// buzz/reporter.js — 화제성 리포트 포맷팅 + 발송
// 각 지표 섹션(버즈량→BZ-1, 채널분포→BZ-2, 감성→BZ-4, 연관어→BZ-5, 스파이크→BZ-6)이
// 슬라이스 순서대로 하나씩 추가된다 (docs/buzz-analysis-design.md §4, §BZ-7 최종 포맷 참고).
import { sendTelegram } from './lib/telegram.js';
import { computeVolumeMetrics, computeChannelShare, computeSentimentMetrics, computeAssocWordsMetrics } from './metrics.js';
import { getRepresentativeNegativePost } from './db.js';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// null(비교 기준 없음=신규)/0/일반 배율을 사람이 읽는 표기로 변환
function formatRatio(r) {
  if (r === null) return '신규';
  if (r === 0) return '-';
  const arrow = r >= 1 ? '↑' : '↓';
  return `×${r.toFixed(1)} ${arrow}`;
}

function formatChannelShareLine(shares) {
  if (!shares.length) return null;
  const parts = shares.map((s) => `${s.label} ${Math.round(s.share)}%${s.arrow}`);
  return `채널: ${parts.join(' · ')}`;
}

function formatSentimentLine(sent) {
  if (!sent.total) return null;
  return `감성: 😊 ${Math.round(sent.posRatio)}% · 😐 ${Math.round(sent.neuRatio)}% · 😡 ${Math.round(sent.negRatio)}%`;
}

function formatAssocWordsLine(assoc) {
  if (!assoc.words.length) return null;
  const top = assoc.words.slice(0, 4).map((w) => `${w.word}(${w.count})`).join(' · ');
  const lines = [`연관어: ${top}`];
  if (assoc.newEntries.length) {
    lines.push(`🆕 신규: ${assoc.newEntries.map((w) => `"${w}"`).join(', ')}`);
  }
  return lines.join('\n');
}

function formatTargetBlock(target) {
  const vol = computeVolumeMetrics(target.id);
  const shares = computeChannelShare(target.id);
  const sent = computeSentimentMetrics(target.id);
  const assoc = computeAssocWordsMetrics(target.id);
  const lines = [`■ ${target.name}`];

  const volumeNotes = [];
  if (vol.todayNoiseCount > 0) volumeNotes.push(`노이즈 ${vol.todayNoiseCount}건 제외`);
  volumeNotes.push(`전일 ${formatRatio(vol.vsYesterday)}`);
  volumeNotes.push(`주평균 ${formatRatio(vol.vs7dayAvg)}`);
  lines.push(`버즈량 ${vol.todayVolume}건 (${volumeNotes.join(' / ')})  ${vol.sparkline}`);

  const shareLine = formatChannelShareLine(shares);
  if (shareLine) lines.push(shareLine);

  const sentLine = formatSentimentLine(sent);
  if (sentLine) lines.push(sentLine);

  const assocLine = formatAssocWordsLine(assoc);
  if (assocLine) lines.push(assocLine);

  return lines.join('\n');
}

// 부정 급증 리스크 타깃을 리포트 최상단에 승격 (docs/buzz-analysis-design.md §4 BZ-4)
function formatRiskSection(targets) {
  const today = todayStr();
  const riskLines = [];

  for (const target of targets) {
    const sent = computeSentimentMetrics(target.id);
    if (!sent.isRisk) continue;

    riskLines.push(`■ ${target.name}: 부정 ${Math.round(sent.negRatio)}% (전일 대비 +${sent.negDeltaPP.toFixed(0)}%p)`);
    const negPost = getRepresentativeNegativePost(target.id, today);
    if (negPost) {
      if (negPost.title) riskLines.push(`  └ ${negPost.title}`);
      riskLines.push(`  └ ${negPost.url}`);
    }
  }

  if (!riskLines.length) return null;
  return ['🚨 리스크 감지', '━━━━━━━━━━━━━━━━━━━━━━', ...riskLines].join('\n');
}

export function formatReport(targets) {
  const date = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
  const time = new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' });

  const lines = [
    '📊 buzzAnalysis 화제성 리포트',
    '━━━━━━━━━━━━━━━━━━━━━━',
    `📅 ${date} ${time}`,
    '',
  ];

  if (!targets.length) {
    lines.push('⚠️ 추적 타깃이 없습니다. buzz/targets.json에 타깃을 추가하세요.');
    return lines.join('\n').trim();
  }

  const riskSection = formatRiskSection(targets);
  if (riskSection) {
    lines.push(riskSection, '');
  }

  for (const t of targets) {
    lines.push(formatTargetBlock(t));
    lines.push('');
  }

  return lines.join('\n').trim();
}

export async function sendReport(targets) {
  const message = formatReport(targets);

  try {
    await sendTelegram(message);
    console.log('[buzz:reporter] 텔레그램 발송 완료');
    return { success: true, channels: ['telegram'] };
  } catch (err) {
    console.error('[buzz:reporter] 텔레그램 전송 실패:', err.message);
    return { success: false, channels: [] };
  }
}
