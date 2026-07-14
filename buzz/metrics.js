// buzz/metrics.js — STEP 5 지표 산출. docs/buzz-analysis-design.md §4 BZ-1(버즈량 증감·스파크라인)
import { getDailyStatsForTarget, getNoiseCountForDate, getAssocWordsForDate, getTopAssocWordsInRange } from './db.js';
import config from './config.js';

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

  const todayNoiseCount = getNoiseCountForDate(targetId, dateStr(0));

  return {
    series,
    todayVolume,
    todayNoiseCount,
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

// 날짜 하나의 채널 합산 감성 카운트(datalab 제외)
function sumSentimentForDate(rows, date) {
  let pos = 0, neg = 0, neu = 0;
  for (const r of rows) {
    if (r.channel === 'datalab' || r.date !== date) continue;
    pos += r.posCount || 0;
    neg += r.negCount || 0;
    neu += r.neuCount || 0;
  }
  const total = pos + neg + neu;
  return { pos, neg, neu, total };
}

// 오늘 감성 비율 + 전일 대비 부정 비율 급변 리스크 판정 (docs/buzz-analysis-design.md §4 BZ-4).
// 임계값은 config.scoring에만 정의 — 변경은 사용자 확인 후(본체 shouldAlert 원칙과 동일).
export function computeSentimentMetrics(targetId) {
  const rows = getDailyStatsForTarget(targetId, 14);
  const today = sumSentimentForDate(rows, dateStr(0));
  const yesterday = sumSentimentForDate(rows, dateStr(1));

  const negRatioToday = today.total > 0 ? today.neg / today.total : 0;
  const negRatioYesterday = yesterday.total > 0 ? yesterday.neg / yesterday.total : 0;
  const negDeltaPP = (negRatioToday - negRatioYesterday) * 100;

  const isRisk =
    today.total > 0 &&
    negRatioToday >= config.scoring.riskNegativeRatio &&
    today.neg >= config.scoring.riskNegativeMinCount &&
    negDeltaPP >= config.scoring.riskNegativeDeltaPP;

  return {
    ...today,
    posRatio: today.total > 0 ? (today.pos / today.total) * 100 : 0,
    negRatio: negRatioToday * 100,
    neuRatio: today.total > 0 ? (today.neu / today.total) * 100 : 0,
    negDeltaPP,
    isRisk,
  };
}

// 스파이크(버즈량 급증) 판정 — 7일 평균 대비 spikeRatio배 이상 AND 최소 volume 이상.
// 베이스라인이 0이면 비율 비교가 무의미하므로 volume 최소치만으로 판정(docs/buzz-analysis-design.md §4 BZ-6).
export function detectSpike(targetId) {
  const vol = computeVolumeMetrics(targetId);
  const ratio = vol.vs7dayAvg; // null = 비교 기준 없음(신규)
  const ratioMet = ratio === null ? vol.todayVolume > 0 : ratio >= config.scoring.spikeRatio;
  const isSpike = ratioMet && vol.todayVolume >= config.scoring.spikeMinVolume;
  if (isSpike) {
    console.log(`[buzz:metrics] ${targetId} 스파이크 감지 (오늘 ${vol.todayVolume}건, 비율 ${ratio === null ? '신규' : ratio.toFixed(2)})`);
  }
  return { isSpike, ratio, todayVolume: vol.todayVolume };
}

// 오늘 연관어 톱10 + 신규 진입어(직전 7일 톱10에 없던 단어) (docs/buzz-analysis-design.md §4 BZ-5)
export function computeAssocWordsMetrics(targetId) {
  const today = dateStr(0);
  const todayWords = getAssocWordsForDate(targetId, today, 10);
  if (!todayWords.length) return { words: [], newEntries: [] };

  const prevTopSet = getTopAssocWordsInRange(targetId, dateStr(7), today, 10);
  const newEntries = todayWords.filter((w) => !prevTopSet.has(w.word)).map((w) => w.word);

  return { words: todayWords, newEntries };
}
