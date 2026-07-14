// buzz/reporter.js — 화제성 리포트 포맷팅 + 발송
// BZ-0: 타깃 목록만 나열하는 스켈레톤 리포트. 지표(버즈량/감성/연관어/채널분포/스파이크)는
// BZ-1~BZ-6에서 순서대로 각 섹션이 채워진다 (docs/buzz-analysis-design.md §4, §BZ-7 최종 포맷 참고).
import { sendTelegram } from './lib/telegram.js';

export function formatSkeletonReport(targets) {
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
  } else {
    for (const t of targets) {
      lines.push(`■ ${t.name}`);
      lines.push('데이터 수집 준비 중 (버즈량/감성/연관어/채널분포 — 다음 업데이트에서 제공)');
      lines.push('');
    }
  }

  return lines.join('\n').trim();
}

export async function sendSkeletonReport(targets) {
  const message = formatSkeletonReport(targets);

  try {
    await sendTelegram(message);
    console.log('[buzz:reporter] 텔레그램 발송 완료');
    return { success: true, channels: ['telegram'] };
  } catch (err) {
    console.error('[buzz:reporter] 텔레그램 전송 실패:', err.message);
    return { success: false, channels: [] };
  }
}
