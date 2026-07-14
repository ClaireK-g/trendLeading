// buzz/metrics.js — STEP 5 지표 산출. docs/buzz-analysis-design.md §4 BZ-1(버즈량 증감·스파크라인)
import { getDailyStatsForTarget } from './db.js';

const SPARK_BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

function dateStr(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

// buzz_daily_stats 원본 행(채널별)을 날짜별 합산 volume 시계열로 변환.
// datalab 채널은 "관심도 지수"로 단위가 달라 버즈량 합산에서 제외한다.
function toDailyVolumeSeries(rows, days) {
  const byDate = new Map();
  for (const r of rows) {
    if (r.channel === 'datalab') continue;
    byDate.set(r.date, (byDate.get(r.date) || 0) + (r.volume || 0));
  }

  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = dateStr(i);
    series.push({ date, volume: byDate.get(date) || 0 });
  }
  return series;
}

// base가 0이면 비교 기준이 없다는 뜻 — null(신규)로 표시한다(burstRatio의 0-나눗셈 처리 답습).
function ratio(current, base) {
  if (base > 0) return current / base;
  return current > 0 ? null : 0;
}

export function sparkline(values) {
  if (!values.length) return '';
  const max = Math.max(...values, 1);
  return values
    .map((v) => {
      const idx = Math.min(SPARK_BLOCKS.length - 1, Math.floor((v / max) * (SPARK_BLOCKS.length - 1)));
      return SPARK_BLOCKS[idx];
    })
    .join('');
}

// 타깃 하나의 버즈량 요약 지표 — todayVolume/전일비/주평균비/14일 스파크라인
export function computeVolumeMetrics(targetId, days = 14) {
  const rows = getDailyStatsForTarget(targetId, days);
  const series = toDailyVolumeSeries(rows, days);

  const todayVolume = series[series.length - 1]?.volume ?? 0;
  const yesterdayVolume = series[series.length - 2]?.volume ?? 0;
  const last7 = series.slice(-8, -1); // 오늘을 제외한 최근 7일
  const avg7 = last7.length ? last7.reduce((s, d) => s + d.volume, 0) / last7.length : 0;

  return {
    series,
    todayVolume,
    vsYesterday: ratio(todayVolume, yesterdayVolume),
    vs7dayAvg: ratio(todayVolume, avg7),
    sparkline: sparkline(series.map((d) => d.volume)),
  };
}

const CHANNEL_LABELS = { blog: '블로그', news: '뉴스', cafe: '카페' };

// 최근 7일 vs 이전 7일 채널별 volume 비중. 전주 대비 ±15%p 이상 변화 시 화살표 표시.
// (docs/buzz-analysis-design.md §4 BZ-2). datalab은 단위가 달라 제외.
export function computeChannelShare(targetId, days = 7) {
  const rows = getDailyStatsForTarget(targetId, days * 2);
  const recentStart = dateStr(days - 1);
  const prevStart = dateStr(days * 2 - 1);

  const recentByChannel = {};
  const prevByChannel = {};

  for (const r of rows) {
    if (r.channel === 'datalab') continue;
    if (r.date >= recentStart) {
      recentByChannel[r.channel] = (recentByChannel[r.channel] || 0) + r.volume;
    } else if (r.date >= prevStart) {
      prevByChannel[r.channel] = (prevByChannel[r.channel] || 0) + r.volume;
    }
  }

  const recentTotal = Object.values(recentByChannel).reduce((s, v) => s + v, 0);
  const prevTotal = Object.values(prevByChannel).reduce((s, v) => s + v, 0);
  const channels = [...new Set([...Object.keys(recentByChannel), ...Object.keys(prevByChannel)])];

  return channels
    .map((channel) => {
      const share = recentTotal > 0 ? ((recentByChannel[channel] || 0) / recentTotal) * 100 : 0;
      const prevShare = prevTotal > 0 ? ((prevByChannel[channel] || 0) / prevTotal) * 100 : 0;
      const deltaPP = share - prevShare;
      return {
        channel,
        label: CHANNEL_LABELS[channel] || channel,
        share,
        deltaPP,
        arrow: Math.abs(deltaPP) >= 15 ? (deltaPP > 0 ? '↑' : '↓') : '',
      };
    })
    .sort((a, b) => b.share - a.share);
}
