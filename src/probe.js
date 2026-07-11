// 데이터랩 탐침(Probe) — 세부 키워드 수백 개를 돌려 검색량 급등을 선행 탐지
import axios from 'axios';
import config from './config.js';
import { getRecentExtractedKeywords, getKeywordSpikeHistory } from './db.js';

function getDateStr(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// 데이터랩 API는 1회 요청에 keywordGroups 최대 5개, 각 그룹에 keywords 최대 5개.
// 각 그룹은 상대 비교이므로 1그룹씩 호출해야 절대 수치를 비교할 수 있음.

// F&B 마이크로 트렌드 탐침 키워드 풀 — 여기에 추가하면 매일 자동 스캔
const PROBE_KEYWORDS = [
  // 특정 매장/브랜드 탐침 — 검색량이 평소 낮다가 급등하면 트렌드 시그널
  '설이동', '보카도버터', '누다케', '노티드', '올드페리도넛',
  '아우어베이커리', '카멜커피', '빵지순례', '디저트투어',
  // 신조어/트렌드 용어 — 일상어가 아닌 것만
  '오마카세', '스시오마카세', '고기오마카세',
  '우베라떼', '콤부차', '수제청',
  '팝업맛집', '팝업카페', '팝업스토어',
  '오픈런맛집', '웨이팅맛집', '예약필수맛집',
  // 최근 언급된 트렌드 후보 (매일 결과 보고 여기에 추가)
  '크런치롤', '마시멜로우샌드', '솔티드카라멜', '피스타치오디저트',
  '흑당크로플', '모찌도넛', '수건디저트', '찹쌀누룽지',
];

export async function runProbe() {
  const { clientId, clientSecret } = config.naverDatalab || {};
  if (!clientId || !clientSecret) {
    console.warn('[probe] NAVER_DATALAB 키 미설정 → 탐침 스킵');
    return [];
  }

  // 동적 탐침 — 최근 7일 추출 키워드 상위 5개를 고정 풀에 임시 추가(당일 스캔용, PROBE_KEYWORDS는 불변)
  let dynamicProbe = [];
  try {
    dynamicProbe = getRecentExtractedKeywords(7, 5).filter(kw => !PROBE_KEYWORDS.includes(kw));
  } catch (err) {
    console.warn(`[probe] 동적 탐침 키워드 조회 실패 (무시): ${err.message}`);
  }
  const probeList = [...PROBE_KEYWORDS, ...dynamicProbe];

  console.log(`[probe] ${probeList.length}개 키워드 탐침 시작 (고정 ${PROBE_KEYWORDS.length} + 동적 ${dynamicProbe.length})...`);

  const startDate = getDateStr(14);
  const endDate = getDateStr(0);
  const spikes = [];

  // 5개씩 묶어서 배치 요청 (API 제한: 1요청 5그룹)
  for (let i = 0; i < probeList.length; i += 5) {
    const batch = probeList.slice(i, i + 5);
    const keywordGroups = batch.map(kw => ({
      groupName: kw,
      keywords: [kw],
    }));

    try {
      const res = await axios.post(
        'https://openapi.naver.com/v1/datalab/search',
        { startDate, endDate, timeUnit: 'date', keywordGroups },
        {
          headers: {
            'X-Naver-Client-Id': clientId,
            'X-Naver-Client-Secret': clientSecret,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        }
      );

      for (const result of res.data?.results || []) {
        const data = result.data || [];
        if (data.length < 5) continue;

        const recent3 = data.slice(-3);
        const prev7 = data.slice(-10, -3);

        const recentAvg = recent3.reduce((s, d) => s + d.ratio, 0) / recent3.length;
        const prevAvg = prev7.length
          ? prev7.reduce((s, d) => s + d.ratio, 0) / prev7.length
          : 0;

        // 급등 조건: 최근 3일이 이전 7일 대비 30%+ 상승
        // 또는 이전 7일 거의 0인데 최근 3일 갑자기 등장
        const changeRate = prevAvg > 0
          ? (recentAvg - prevAvg) / prevAvg
          : (recentAvg > 5 ? 10 : 0);

        if (changeRate >= 0.3) {
          spikes.push({
            keyword: result.keywords?.[0] || result.title,
            recentAvg: +recentAvg.toFixed(1),
            prevAvg: +prevAvg.toFixed(1),
            changeRate: +(changeRate * 100).toFixed(1),
            signal: prevAvg < 1 ? '🆕 신규 등장' : changeRate >= 1.0 ? '🚀 폭등' : '📈 급상승',
          });
        }
      }

      await sleep(200);
    } catch (err) {
      console.warn(`[probe] 배치 실패 (${batch.join(',')}): ${err.message}`);
      await sleep(1000);
    }
  }

  spikes.sort((a, b) => b.changeRate - a.changeRate);
  console.log(`[probe] 탐침 완료: ${spikes.length}개 급등 키워드 감지`);
  spikes.slice(0, 10).forEach(s =>
    console.log(`  ${s.signal} ${s.keyword}: +${s.changeRate}% (${s.prevAvg} → ${s.recentAvg})`)
  );

  // 고정 탐침 풀(PROBE_KEYWORDS) 중 최근 14일간 한 번도 급등 이력이 없는 키워드 보고.
  // 풀 교체는 사용자 결정 사항이므로 자동 삭제는 하지 않는다(blog-traffic-dev 스킬 §7).
  try {
    const active = getKeywordSpikeHistory(PROBE_KEYWORDS, 14);
    const inactive = PROBE_KEYWORDS.filter(kw => !active.has(kw.trim().toLowerCase()));
    if (inactive.length) {
      console.log(`[probe] 최근 14일간 급등 이력 없음(${inactive.length}개, 풀 교체 검토 대상 — 자동 삭제 안 함): ${inactive.join(', ')}`);
    }
  } catch (err) {
    console.warn(`[probe] 탐침 풀 이력 조회 실패 (무시): ${err.message}`);
  }

  return spikes;
}

// 블로그에서 추출된 키워드를 데이터랩에 역으로 검증
export async function verifyWithDatalab(keywords) {
  const { clientId, clientSecret } = config.naverDatalab || {};
  if (!clientId || !clientSecret || !keywords.length) return keywords;

  console.log(`[probe] ${keywords.length}개 추출 키워드 데이터랩 역검증...`);

  const startDate = getDateStr(14);
  const endDate = getDateStr(0);
  const verified = [];

  for (let i = 0; i < keywords.length; i += 5) {
    const batch = keywords.slice(i, i + 5);
    const keywordGroups = batch.map(kw => ({
      groupName: kw.keyword,
      keywords: [kw.keyword],
    }));

    try {
      const res = await axios.post(
        'https://openapi.naver.com/v1/datalab/search',
        { startDate, endDate, timeUnit: 'date', keywordGroups },
        {
          headers: {
            'X-Naver-Client-Id': clientId,
            'X-Naver-Client-Secret': clientSecret,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        }
      );

      for (const result of res.data?.results || []) {
        const data = result.data || [];
        const kw = batch.find(k => k.keyword === (result.keywords?.[0] || result.title));
        if (!kw || data.length < 5) continue;

        const recent3 = data.slice(-3);
        const prev7 = data.slice(-10, -3);
        const recentAvg = recent3.reduce((s, d) => s + d.ratio, 0) / recent3.length;
        const prevAvg = prev7.length ? prev7.reduce((s, d) => s + d.ratio, 0) / prev7.length : 0;
        const changeRate = prevAvg > 0 ? (recentAvg - prevAvg) / prevAvg : (recentAvg > 5 ? 10 : 0);

        verified.push({
          ...kw,
          datalabVerified: true,
          searchTrend: changeRate >= 0.1 ? '📈 상승' : changeRate <= -0.1 ? '📉 하락' : '➡️ 유지',
          searchChangeRate: +(changeRate * 100).toFixed(1),
        });
      }
      await sleep(200);
    } catch (err) {
      // 검증 실패해도 키워드 자체는 유지
      batch.forEach(kw => verified.push({ ...kw, datalabVerified: false }));
    }
  }

  // 검증 못 한 키워드도 포함
  for (const kw of keywords) {
    if (!verified.find(v => v.keyword === kw.keyword)) {
      verified.push({ ...kw, datalabVerified: false });
    }
  }

  const rising = verified.filter(v => v.searchChangeRate > 0);
  const falling = verified.filter(v => v.searchChangeRate < 0);
  console.log(`[probe] 역검증 완료: 상승 ${rising.length}개, 하락 ${falling.length}개`);

  return verified;
}
