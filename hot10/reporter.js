// hot10/reporter.js — buzzAnalysis 화제성 Top10 리포트 포맷팅 + 발송
// STEP R1~R3(정규화/랭킹/연속성)이 HT-1~HT-6에서 순서대로 채워진다 (docs/hot10-design.md §5, §6).
import { sendTelegram } from './lib/telegram.js';

const REGION_LABELS = { kr: '🇰🇷 한국', global: '🌏 글로벌' };

export function formatSkeletonReport() {
  const date = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
  const time = new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' });

  const lines = [
    '🔥 buzzAnalysis 화제성 Top10',
    '━━━━━━━━━━━━━━━━━━━━━━',
    `📅 ${date} ${time}`,
    '',
    REGION_LABELS.kr,
    '━━━━━━━━━━━━━━━━━━━━━━',
    '수집·랭킹 로직 준비 중 (다음 업데이트에서 제공)',
    '',
    REGION_LABELS.global,
    '━━━━━━━━━━━━━━━━━━━━━━',
    '수집·랭킹 로직 준비 중 (다음 업데이트에서 제공)',
  ];

  return lines.join('\n').trim();
}

export async function sendSkeletonReport() {
  const message = formatSkeletonReport();

  try {
    await sendTelegram(message);
    console.log('[hot10:reporter] 텔레그램 발송 완료');
    return { success: true, channels: ['telegram'] };
  } catch (err) {
    console.error('[hot10:reporter] 텔레그램 전송 실패:', err.message);
    return { success: false, channels: [] };
  }
}
