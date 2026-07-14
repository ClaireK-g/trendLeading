// buzz/collector.js — STEP 2 수집 (버즈량 원천). docs/buzz-analysis-design.md §4 BZ-1
import { searchNaver, parsePublishedDate, searchDatalab } from './lib/naver.js';
import { insertBuzzPost, upsertDailyStat } from './db.js';
import config from './config.js';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// 날짜 필드가 없는 채널(카페)은 필터링 없이 통과시킨다(fail-open) — 네이버 cafearticle API 제약.
function isWithinOneDay(dateStr, today) {
  if (!dateStr) return true;
  const diffDays = Math.abs((new Date(today) - new Date(dateStr)) / (1000 * 60 * 60 * 24));
  return diffDays <= 1;
}

// 저장용 channel id와 네이버 검색 API endpoint 매핑(cafearticle → 'cafe')
const CHANNELS = [
  { id: 'blog', endpoint: 'blog' },
  { id: 'news', endpoint: 'news' },
  { id: 'cafe', endpoint: 'cafearticle' },
];

// 타깃 하나 × 채널 하나 — 쿼리 변형 전체를 훑어 dedup 후 신규 건수·total 프록시 반환
async function collectTargetChannel(target, channel) {
  const today = todayStr();
  const seenUrls = new Set();
  let newCount = 0;
  let totalHintSum = 0;

  for (const query of target.queries) {
    try {
      const { items, total } = await searchNaver(channel.endpoint, query, 100);
      totalHintSum += total;

      for (const item of items) {
        if (seenUrls.has(item.link)) continue;
        seenUrls.add(item.link);

        const publishedAt = parsePublishedDate(item);
        if (!isWithinOneDay(publishedAt, today)) continue;

        const title = (item.title || '').replace(/<[^>]+>/g, '');
        const description = (item.description || '').replace(/<[^>]+>/g, '');

        const inserted = insertBuzzPost({
          target: target.id,
          channel: channel.id,
          url: item.link,
          title,
          description,
          publishedAt,
          collectedAt: new Date().toISOString(),
        });
        if (inserted) newCount++;
      }

      await sleep(300);
    } catch (err) {
      console.warn(`[buzz:collector] ${target.id}/${channel.id} 검색 실패 (${query}): ${err.message}`);
    }
  }

  return { newCount, totalHint: totalHintSum };
}

// 데이터랩 관심도 지수 — datalabGroup이 설정된 타깃만, 5개씩 배치 호출(API 제약)
async function collectDatalabForTargets(targets) {
  const { clientId, clientSecret } = config.naverDatalab || {};
  const candidates = targets.filter((t) => t.datalabGroup);
  if (!clientId || !clientSecret || !candidates.length) return;

  const today = todayStr();
  const startDate = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  })();

  for (let i = 0; i < candidates.length; i += 5) {
    const batch = candidates.slice(i, i + 5);
    const keywordGroups = batch.map((t) => ({ groupName: t.id, keywords: [t.datalabGroup] }));

    try {
      const results = await searchDatalab(keywordGroups, startDate, today);
      for (const result of results) {
        const data = result.data || [];
        const latest = data[data.length - 1];
        if (!latest) continue;
        const target = batch.find((t) => t.id === result.title);
        if (!target) continue;
        upsertDailyStat({
          target: target.id,
          date: today,
          channel: 'datalab',
          volume: Math.round(latest.ratio),
          totalHint: null,
        });
      }
    } catch (err) {
      console.warn(`[buzz:collector] 데이터랩 수집 실패: ${err.message}`);
    }

    await sleep(300);
  }
}

export async function collectDaily(targets) {
  const today = todayStr();
  const summary = [];

  for (const target of targets) {
    for (const channel of CHANNELS) {
      const { newCount, totalHint } = await collectTargetChannel(target, channel);
      upsertDailyStat({ target: target.id, date: today, channel: channel.id, volume: newCount, totalHint });
      summary.push({ target: target.id, channel: channel.id, newCount });
    }
  }

  try {
    await collectDatalabForTargets(targets);
  } catch (err) {
    console.warn(`[buzz:collector] 데이터랩 STEP 실패 (무시): ${err.message}`);
  }

  const totalNew = summary.reduce((sum, s) => sum + s.newCount, 0);
  console.log(`[buzz:collector] 수집 완료 — 신규 ${totalNew}건 (타깃 ${targets.length}개 × 채널 ${CHANNELS.length}개)`);

  return summary;
}
