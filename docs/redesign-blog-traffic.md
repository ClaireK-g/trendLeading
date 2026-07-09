# 재설계 설계서 — "트렌드 알림"에서 "블로그 소재 발굴"로

> **실행자**: Sonnet (Claude Code). **반드시 Phase 순서대로** 실행한다. Phase를 건너뛰거나 병합하지 마라.
> **시작 전 필독**: `.claude/skills/trendleading-dev/SKILL.md` (개발 절차) + `.claude/skills/blog-traffic-dev/SKILL.md` (도메인 지식 — 이 설계의 근거).
> **Phase당 1커밋**. 각 Phase의 "검증" 통과 없이는 커밋하지 않는다.

## 0. 목표 재정의 (이 문서의 존재 이유)

기존 정체성: "F&B 마이크로 트렌드 감지 → 텔레그램 알림".
**새 정체성: "블로그 방문자 유입을 위한 글감(소재) 발굴 파이프라인".**

사용자(블로거)의 실제 사용 흐름:
1. 매일 아침 텔레그램 리포트에서 오늘 쓸 글감을 고른다.
2. 검색 수요는 뜨는데 아직 블로그 글이 적은 키워드(황금 키워드)로 글을 쓴다.
3. 상위 노출 → 방문자 유입. (실증: '언더커버 쉐프 식당' 글이 조회수 급증 — 방송發 소재)

따라서 파이프라인의 최종 판정 기준은 "트렌드가 진짜인가?"에서
**"이 소재로 오늘 글을 쓰면 검색 유입이 생기는가?"**로 바뀐다.

## 1. 진단 (2026-07-09, 실DB 분석 — 재논쟁 금지)

| # | 문제 | 근거 (실측) | 원인 위치 |
|---|---|---|---|
| D1 | 같은 기사 최대 **16회** 재수집 | `raw_posts`에서 동일 URL 16건 (06-25~07-07) | `scraper.js:538` 당일 런 내에서만 dedup, `db.js insertRawPosts`는 무조건 INSERT |
| D2 | 오래된 글 계속 유입 | "[오늘 뭐 먹지]" 요약기사가 13일간 수집됨 | 발행일(pubDate/postdate) 필터 없음 |
| D3 | 매일 같은 키워드 보고 | '설이동' 6일, '쫀득한 버터떡 디저트' 6일 연속 | D1+D2로 LLM이 매일 같은 텍스트를 봄 + "기추출 키워드 제외" 로직 없음 + '설이동'은 `probe.js PROBE_KEYWORDS`에 하드코딩되어 매일 stats에 적재 |
| D4 | 검색 불가 키워드 | '콘크리트 (디저트)' — 버거킹 신메뉴인데 브랜드 누락. 원인: 여러 브랜드가 나열된 뉴스 요약기사에서 브랜드↔메뉴 연결이 끊긴 채 추출 | 프롬프트에 "검색가능형" 규칙 없음, 추출 후 검색가능성 검증 단계 없음 |
| D5 | 유사 변형 중복 | '우베 디저트' / '우베 (ube)' / '우베 (ube) 디저트' 각각 별도 키워드로 존재 | `mergeSimilarKeywords`가 배치 내에서만 동작, DB 누적분과는 비교 안 함 |
| D6 | 목표 부정합 | trendScore는 "트렌드 강도"만 측정. 블로그 유입의 핵심인 **경쟁 문서 수(콘텐츠 공급)** 지표가 없음 | `scorer.js` 설계 자체 |

## 2. 재설계 후 파이프라인 (목표 형상)

```
STEP 1  탐침 (probe)            — [P3] 탐침 풀 동적 로테이션
STEP 2  수집 (scraper)          — [P0] URL 크로스데이 dedup + 발행일≤3일 필터, [P3] 동적 쿼리
STEP 3  LLM 추출 (extractor)    — [P0] 기추출 키워드 제외 주입, [P1] search_keyword(검색가능형) 필드
STEP 4  데이터랩 역검증 (probe)  — 유지 (수요 지표)
STEP 4.5 검색가능성 검증 (신규)  — [P1] 네이버 블로그 검색으로 검색결과 존재+경쟁 문서 수 측정
STEP 5  스코어링 (scorer)       — [P2] opportunityScore = 수요 ÷ 공급 (황금 키워드)
STEP 6  리포트 (alerter)        — [P2] "블로그 소재 리포트"로 개편: 공략 키워드·왜 지금·경쟁도·글 각도·근거 링크
```

---

## Phase 0 — 반복 제거 (위생 수정, 최우선)

같은 소재가 매일 반복되는 3중 원인(D1·D2·D3)을 끊는다. **이 Phase 없이는 이후 Phase의 효과가 안 보인다.**

### P0-1. 크로스데이 URL 중복 제거
- `db.js`에 `getRecentSourceUrls(days = 14)` 추가: 최근 N일 `raw_posts.source_url` 집합(Set) 반환.
- `scraper.js collectDaily()` 마지막 dedup 단계에서 이 집합에 있는 URL 제외. 로그: `[scraper] 기수집 URL n건 스킵`.
- **UNIQUE 인덱스는 만들지 마라** — 기존 DB에 중복이 이미 있어 인덱스 생성이 실패한다. 코드 레벨 필터로 충분. 조회 성능용 일반 인덱스만 추가: `CREATE INDEX IF NOT EXISTS idx_rp_url ON raw_posts(source_url);`
- 주의(스킬 §3): post 객체는 `sourceUrl`/`source_url` 양쪽 케이스 존재 — `??`로 양쪽 처리.

### P0-2. 발행일 필터 (≤3일)
- 네이버 뉴스 API 응답의 `pubDate`(RFC822), 블로그 API의 `postdate`(yyyymmdd)를 파싱해 **3일 초과면 수집 제외**. 트렌드 시간 기준(2~3일)과 일치.
- 파싱 실패 시 통과(제외하지 않음) — 부분 실패가 수집 전체를 죽이면 안 됨.
- 로그: `[scraper] 발행 3일 초과 n건 제외`.

### P0-3. 기추출 키워드 프롬프트 제외
- `db.js`에 `getRecentExtractedKeywords(days = 7, limit = 40)` 추가 (extracted_keywords에서 distinct).
- `extractor.js buildSystemPrompt()`에 제외 블록 주입:
  `"이미 발견된 키워드(제외 대상 — 동일·유사 변형 포함): ..."`. Generator에게 이 목록과 겹치는 키워드는 **완전히 새로운 급등 근거가 없는 한** 출력하지 말라고 지시.
- limit 40 유지 — 프롬프트 크기와 RPM을 지켜라(스킬 §2).

### P0 검증
```bash
node index.js test        # 통과 + TRAP/REAL 판별 육안 확인
node --check src/db.js src/scraper.js src/extractor.js
```
- test 후 `data/trend.db` diff는 커밋 제외(스킬 §6).
- 커밋 예: `수집 반복 제거: 크로스데이 URL dedup + 발행일 3일 필터 + 기추출 키워드 프롬프트 제외`

---

## Phase 1 — 검색가능형 키워드 (콘크리트 문제 해결)

추출 키워드가 "네이버에 그대로 검색했을 때 그 소재가 나오는 형태"임을 보장한다 (D4·D5).

### P1-1. `search_keyword` 필드 추가 (스키마 변경 — 스킬 §2 동기화 규칙 준수)
- Generator·Synthesizer 출력 스키마에 `search_keyword` 추가.
  프롬프트 규칙(blog-traffic-dev 스킬 §3의 규칙을 그대로 프롬프트에 옮겨라):
  - 단독 검색으로 의미가 통해야 함: **브랜드+메뉴**("버거킹 콘크리트"), **지역+가게**("성수 설이동"), **프로그램+소재**("언더커버 쉐프 식당").
  - 일반명사 단독 금지(콘크리트, 테이크 등 동음이의어).
  - 원문에서 브랜드/지역/출처를 찾을 수 없으면 `search_keyword: null` — 이 경우 confidence -1.
- 동기화 필수 4곳: 프롬프트 스키마, `db.js insertExtractedKeywords`(+ `ALTER TABLE`은 쓰지 말고 `CREATE TABLE IF NOT EXISTS`가 못 잡으므로 — 아래 마이그레이션 참고), `index.js MOCK_KEYWORDS`, 다이제스트 소비부.
- **마이그레이션**: `db.js` 초기화에 안전한 컬럼 추가 패턴 사용:
  ```js
  const cols = db.prepare('PRAGMA table_info(extracted_keywords)').all().map(c => c.name);
  if (!cols.includes('search_keyword')) db.exec('ALTER TABLE extracted_keywords ADD COLUMN search_keyword TEXT');
  ```

### P1-2. STEP 4.5 — 검색가능성 자동 검증 (신규 모듈 `src/searchability.js`)
- `verifySearchability(keywords)`: 각 키워드의 `search_keyword`(없으면 keyword)로 **네이버 블로그 검색 API** 호출(`display: 5, sort: 'date'`).
  - `total` 저장 → **경쟁 문서 수(공급 지표)**. P2에서 사용.
  - 결과 0건 → 해당 키워드 `searchable: false`로 강등(다이제스트에서 "검증 필요" 섹션으로 분리, 상위 랭킹 제외).
  - 상위 5건 제목에 키워드 핵심 토큰이 하나도 없으면 동음이의 오염 의심 → 동일하게 강등.
- `pipeline.js`에 STEP 4.5로 삽입. **try/catch로 감싸 실패 시 스킵**(스킬 §1 부분 실패 원칙). API 키는 기존 `NAVER_SEARCH_*` 재사용.
- 호출량 주의: 상위 랭킹 후보(최대 30개)만 검증. 호출 간 `sleep(300)`.
- 결과 저장: `keyword_daily_stats`에 컬럼 추가(`doc_count INTEGER`) — P1-1과 동일한 PRAGMA 마이그레이션 패턴.

### P1-3. 다이제스트에 근거 링크
- 각 키워드 줄에: 네이버 검색 링크 `https://search.naver.com/search.naver?query=<search_keyword URL인코딩>` + 대표 소스 URL 1건(extracted_keywords.post_id → raw_posts.source_url).
- 텔레그램 메시지 길이 한도(4096자) 초과 시 상위 항목 우선 — 기존 다이제스트 포맷(heat indicator, `└ reason`) 유지.

### P1 검증
```bash
node index.js test
node --check src/searchability.js src/extractor.js src/db.js src/alerter.js
```
- MOCK_KEYWORDS에 `search_keyword` 포함 여부 확인. 커밋 예: `검색가능형 키워드 도입: search_keyword 필드 + 검색가능성 검증 STEP 4.5`

---

## Phase 2 — 블로그 소재 스코어링 (목표 재정의의 본체)

"트렌드 강도"가 아니라 "글 쓰면 유입이 생기는가"로 랭킹한다 (D6).

### P2-1. opportunityScore (황금 키워드 공식)
- `scorer.js`에 추가:
  ```
  demand  = burstRatio (기존 수요 급등 지표 재사용)
  supply  = log10(doc_count + 10)        // P1-2에서 저장한 경쟁 문서 수
  opportunityScore = demand / supply
  ```
- 최종 랭킹: `finalScore = trendScore * 0.5 + opportunityScore * 0.5` — 기존 trendScore·shouldAlert 임계값은 **건드리지 마라**(스킬 §8: 임계값 변경은 사용자 승인 사항). opportunityScore는 랭킹 가중에만 사용.
- doc_count가 없는 키워드(STEP 4.5 스킵/실패)는 opportunityScore 0으로 중립 처리.

### P2-2. 소재 유형 태그
- Synthesizer 출력에 `content_type` 필드 추가: `방송미디어 | 신메뉴출시 | 지역맛집 | 식문화현상 | 시즌성`.
  (판정 기준은 blog-traffic-dev 스킬 §5 — 방송미디어發이 실증된 최고 성과 유형.)
- 스키마 동기화 4곳(P1-1과 동일 규칙 + PRAGMA 마이그레이션).

### P2-3. 다이제스트 → "블로그 소재 리포트" 개편 (`alerter.js sendDailyDigest`)
- 항목당 출력 형식:
  ```
  🥇 [방송미디어] 언더커버 쉐프 식당
     공략 키워드: 언더커버 쉐프 식당 위치
     왜 지금: 방송 직후 검색 급증, 블로그 글 12건뿐 (수요↑ 공급↓)
     └ 검색해보기: <네이버 링크> · 근거 기사: <URL>
  ```
- 섹션 구성: ① 오늘의 황금 소재 (opportunityScore 상위 5) ② 관찰 중 (연속 노출 키워드 — P0-3에도 불구하고 살아남은 진짜 지속 트렌드) ③ 검증 필요 (searchable:false).
- 헤더에 날짜 + "오늘 글감 추천" 명시. 기존 heat indicator 이모지 체계 유지.

### P2 검증
```bash
node index.js test && node index.js score   # 실DB로 opportunityScore 분포 육안 확인
```
- 스킬 §0-2: 점수 분포를 실데이터로 먼저 확인하고 가중치(0.5/0.5)가 이상하면 **사용자에게 보고 후** 조정. 커밋 예: `블로그 소재 스코어링: opportunityScore(수요/공급) + 소재 리포트 개편`

---

## Phase 3 — 탐색 다양화 (새 소재 유입 확대)

고정된 탐색 공간(D3의 잔여 원인)을 동적으로 바꾼다.

### P3-1. 동적 discovery 쿼리
- `scraper.js`: 고정 `NAVER_DISCOVERY_QUERIES` 8개에 + **동적 쿼리 최대 4개**: 전일 상위 키워드의 `co_keywords`에서 추출(`db.js getAllRecentKeywords` 재사용), 이미 쿼리에 있는 것 제외.
- 동적 쿼리도 P0-1 dedup의 보호를 받으므로 중복 폭주 위험 없음.

### P3-2. 방송/미디어 시그널 쿼리 추가 (실증된 최고 성과 유형)
- 고정 쿼리에 추가: `'"방송에 나온" 맛집'`, `'"티비에 나온" 식당'`, `'예능 맛집 어디'`, `'"에 나왔던" 맛집 위치'`.
- 뉴스 endpoint에도 동일 적용. 쿼리 총량 증가 → API 호출 수 계산 후 진행(쿼리 12개 × 2 endpoint × display 10 = 240건/일 — 네이버 검색 API 일 25,000회 한도 내 여유).

### P3-3. 탐침 풀 로테이션 + 다이제스트 쿨다운
- `probe.js PROBE_KEYWORDS`: 하드코딩 풀에서 **최근 14일간 급등 0회인 키워드를 로그로 보고**(자동 삭제는 하지 말 것 — 풀 교체는 사용자 결정). 대신 최근 7일 추출 키워드 중 상위 5개를 탐침 풀에 **동적 추가**.
- 다이제스트 쿨다운: 최근 7일 내 "황금 소재" 섹션에 이미 나간 키워드는 ② 관찰 중 섹션으로 이동 (재등장 자체는 허용하되 ①번 자리를 새 소재에 양보). `alerts_sent` 테이블 재사용 가능 — channel='digest_top'로 기록.

### P3 검증
```bash
node index.js test
```
- 커밋 예: `탐색 다양화: 동적 쿼리 + 방송미디어 쿼리 + 다이제스트 쿨다운`

---

## Phase 4 — 마무리 동기화 (필수)

1. `CLAUDE.md` 갱신: 프로젝트 개요를 "블로그 소재 발굴 파이프라인"으로, 아키텍처에 STEP 4.5 추가.
2. `.claude/skills/trendleading-dev/SKILL.md` 갱신: §1 아키텍처 맵에 STEP 4.5·searchability.js 추가, §3 필드명 계약에 `search_keyword`·`doc_count`·`content_type` 추가, §4에 opportunityScore 공식 추가.
3. 이 설계서 상단에 `> 상태: Phase N까지 구현 완료 (커밋 해시)` 줄 추가 — 각 Phase 완료 시마다 갱신.
4. 커밋 예: `문서 동기화: 블로그 소재 발굴 파이프라인 반영`

## 부록 — 하지 말 것

- shouldAlert 임계값·trendScore 공식 변경 (스킬 §8, 사용자 승인 필요)
- 유료 API 도입 (스폰서 확인 사항)
- `data/trend.db` 커밋 (Actions 전용)
- 신선도 기준(2~3일) 완화
- Phase 병합·순서 변경
