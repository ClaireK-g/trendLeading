// 키워드 변형 표준화 — "우베 (Ube)" / "우베 디저트" / "우베 (Ube) 디저트"처럼 표기만 다른
// 변형이 매일 새 키워드로 추출·보고되는 반복을 막는다 (2026-07 실데이터: 우베 6일 연속 변형 추출).
// 문자열 완전일치·편집거리로는 못 잡는 케이스라, 범용 수식어를 뺀 "핵심 토큰" 겹침으로 판정한다.

// 범용 카테고리/형태/수식어 — 이 단어만 겹치는 건 같은 소재가 아니다 (예: "선크림 맛 아이스크림" vs "아이스크림 피아노")
const GENERIC_TOKENS = new Set([
  '디저트', '신상', '신메뉴', '메뉴', '맛집', '카페', '팝업', '트렌드', '스타일',
  '재조명', '현상', '열풍', '유행', '인기', '간식', '음료', '전문점', '추천',
  '아이스크림', '케이크', '크림', '빵', '도넛', '빙수', '라떼', '커피', '쿠키', '와플',
  '서울', '성수', '강남', '홍대', '연남', '한남',
]);

export function coreTokens(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[()（）\/,·&]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !GENERIC_TOKENS.has(t));
}

/**
 * pool(기존 키워드 문자열 배열)에서 candidate와 핵심 토큰이 겹치는 항목을 찾는다.
 * 겹치는 토큰 수가 가장 많은 기존 키워드를 반환, 없으면 null.
 * 핵심 토큰이 하나도 없는 candidate(전부 범용어)는 판정 불가 → null.
 */
export function findCanonical(candidate, pool) {
  const candTokens = new Set(coreTokens(candidate));
  if (!candTokens.size) return null;

  let best = null;
  let bestOverlap = 0;
  for (const existing of pool) {
    let overlap = 0;
    for (const t of coreTokens(existing)) {
      if (candTokens.has(t)) overlap++;
    }
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = existing;
    }
  }
  return bestOverlap >= 1 ? best : null;
}

/**
 * 키워드 집합(문자열 배열) 중 candidate의 변형이 존재하는지 여부 — 쿨다운 판정용.
 */
export function isVariantOfAny(candidate, pool) {
  return findCanonical(candidate, pool) !== null;
}

export default { coreTokens, findCanonical, isVariantOfAny };
