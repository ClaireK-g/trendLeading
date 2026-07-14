# buzzAnalysis — 화제성 분석 데일리 레포팅 설계서 (buzz/ 모듈 — 현재 이름: "타깃 추적 관찰")

> **이름 변경 안내(2026-07-14)**: 이 문서와 코드 내 "buzzAnalysis"라는 이름은 이 문서 작성 당시의
> 표기다. 사용자 지정에 따라 "buzzAnalysis" 브랜드명은 hot10 모듈(`hot10/`, 분야 무관 자동발굴
> Top10, `docs/hot10-design.md`)이 물려받았고, 이 모듈(`buzz/`, 타깃 등록형 추적)의 텔레그램
> 리포트 타이틀은 **"🔍 타깃 추적 관찰"**로 변경됐다. 디렉토리명(`buzz/`)·DB 경로(`data/buzz.db`)·
> 워크플로 파일명(`buzz-analysis.yml`)은 그대로다 — 아래 본문의 "buzzAnalysis" 언급은 전부 이
> 모듈(현재 리포트 타이틀 "타깃 추적 관찰")을 가리키는 과거 표기로 읽는다.
>
> **문서 성격**: 구현 지시서. 실행(코딩)은 Sonnet이 이 문서의 슬라이스 순서대로 진행한다.
> **작성일**: 2026-07-14 · **스폰서**: 지경
> **전제**: trendLeading(블로그 소재 발굴)과 **소스가 절대 꼬이지 않는 완전 격리 모듈**로 만든다.
> 100% 무료 스택(네이버 API + Gemini 무료 티어 + 텔레그램 + GitHub Actions) 원칙은 동일하게 유지.

---

## 0. 목적 정의

**화제성 분석(Buzz Analysis)**: 사용자가 지정한 특정 브랜드/제품/콘텐츠(이하 "타깃")가
온라인에서 **얼마나 많이**(양적) · **어떤 반응으로**(질적) 언급되는지 매일 아침 텔레그램으로 리포트.

trendLeading과의 목적 차이 — 헷갈리면 안 되는 지점:

| | trendLeading | buzzAnalysis |
|---|---|---|
| 질문 | "오늘 뭘 쓰면 유입이 생기나?" (소재 **발굴**) | "내가 지켜보는 타깃이 지금 어떤 상태인가?" (타깃 **추적**) |
| 키워드 | 파이프라인이 스스로 찾음 | 사용자가 미리 지정 (`targets.json`) |
| 산출물 | 황금 소재 랭킹 | 타깃별 버즈량·감성·연관어·채널분포·스파이크 원인 |

### 4대 핵심 지표 (리포트의 뼈대)

1. **버즈량 (Volume)** — 채널별 언급 총량 + 시계열 추이 + 전일/전주 대비
2. **감성 (Sentiment)** — 긍정/부정/중립 비율 + 급변 감지 (부정 급증 = 리스크 경보)
3. **연관어 (Associated Words)** — 함께 언급된 단어 톱N + 신규 진입 연관어
4. **채널별 분포 (Channel Share)** — 블로그/뉴스/카페 (+옵션 X) 비중

추가로 **스파이크 감지 + 트리거 역추적** — 버즈량이 튄 날, 그 숫자를 만든 원문(가장 많이 퍼진
글/뉴스)을 찾아 리포트에 붙인다. "전체 숫자보다 그 숫자를 만든 계기 하나가 인사이트"라는 원칙.

---

## 1. 격리 원칙 (가장 중요 — 모든 슬라이스에 적용)

trendLeading 본체와 코드·데이터·실행이 섞이면 안 된다. 아래 규칙은 협상 불가:

1. **디렉토리 격리**: 모든 신규 코드는 레포 루트의 **`buzz/`** 아래에만 둔다.
   `src/`의 어떤 파일도 **import 금지**. 필요한 유틸(네이버 클라이언트, 텔레그램 전송,
   Gemini 호출)은 `buzz/lib/`에 **독립 구현(복사·단순화)** 한다.
   — 이유: `src/`는 필드명 계약이 예민한 영역(과거 스코어 0.0 버그). 공유 import를 만들면
   한쪽 수정이 다른 쪽을 조용히 깨뜨린다. `agents-slack/`이 같은 방식으로 격리된 선례.
2. **DB 격리**: 전용 파일 **`data/buzz.db`**. `data/trend.db`는 읽기조차 금지.
3. **워크플로 격리**: 전용 **`.github/workflows/buzz-analysis.yml`**.
   `trend-pipeline.yml`은 한 줄도 수정하지 않는다.
4. **실행 시간 분리**: trendLeading이 KST 04:00(cron `0 19 * * *`)이므로 buzz는
   **KST 07:00(cron `0 22 * * *`)**. Gemini 무료 티어 RPM·네이버 API 쿼터가 계정 단위로
   공유되기 때문에 동시 실행 금지.
5. **환경변수**: 기존 키(GEMINI_API_KEY~_5, NAVER_SEARCH_*, NAVER_DATALAB_*, TELEGRAM_*)는
   **읽기 공유**(같은 계정/봇 재사용 — 신규 발급 불필요). buzz 전용 신규 변수는 반드시
   **`BUZZ_` 접두사** (예: `BUZZ_TELEGRAM_CHAT_ID` — 미설정 시 기존 챗 ID로 폴백).
6. **기존 파일 수정 최소화**: 허용되는 기존 파일 변경은 딱 3가지 —
   `package.json`에 `"buzz": "node buzz/index.js run"` 스크립트 추가,
   `.env.example`에 buzz 섹션 추가, `CLAUDE.md`에 buzz 모듈 한 단락 추가. 그 외 금지.
7. **DB 커밋 경합 대비**: 두 워크플로가 같은 레포에 DB를 커밋하므로, buzz 워크플로의
   커밋 스텝은 `git pull --rebase origin main` 후 push, 실패 시 최대 3회 재시도.
8. **스타일 계약은 동일 상속**: DB snake_case / JS camelCase, 한국어 주석, `[buzz:모듈명]`
   접두 console.log, 한국어 커밋 메시지, `.env` 및 `data/*.db` 로컬 변경분 커밋 금지
   (buzz.db는 워크플로만 커밋).
9. **부분 실패 격리**: 각 STEP은 try/catch로 감싸 실패해도 다음 STEP과 리포트 발송은
   진행한다(본체와 동일한 원칙). 리포트에 "⚠️ 감성 분석 실패" 식으로 결측을 표기.

---

## 2. 전체 아키텍처 (6단계 파이프라인)

```
buzz/index.js (CLI: run | test | report | targets)
  └─ buzz/pipeline.js runBuzzPipeline()
       STEP 1  타깃 로드         buzz/targets.json          (키워드 세팅)
       STEP 2  수집              buzz/collector.js           (버즈량 원천 — 블로그/뉴스/카페 + 데이터랩)
       STEP 3  정제·필터링       buzz/cleaner.js             (광고/도배/동음이의 노이즈 제거)
       STEP 4  질적 분석(LLM)    buzz/analyzer.js            (감성 + 연관어, Gemini 배치)
       STEP 5  지표 산출         buzz/metrics.js             (시계열/증감/채널분포/스파이크/트리거)
       STEP 6  리포트 발송       buzz/reporter.js            (텔레그램 "화제성 리포트")
공통:  buzz/db.js (better-sqlite3, data/buzz.db)
       buzz/config.js (env → 설정, BUZZ_ 접두)
       buzz/lib/naver.js · buzz/lib/gemini.js · buzz/lib/telegram.js (독립 유틸)
```

### 데이터 소스 (전부 무료)

| 지표 | 소스 | API | 비고 |
|---|---|---|---|
| 버즈량(문서수) | 네이버 블로그/뉴스/**카페** 검색 | `/v1/search/{blog,news,cafearticle}.json` | `total` 필드 = 채널별 총량 프록시, 정렬 `date` |
| 검색 관심도 | 네이버 데이터랩 | `/v1/datalab/search` | 1요청 keywordGroups ≤5, 그룹 간 절대 비교 불가(본체와 동일 제약) |
| 감성/연관어 | 수집된 본문 텍스트 | Gemini 2.5 Flash | 무료 티어, 키 로테이션 재사용 |
| (옵션) X 버즈 | 본체 scraper의 X 보조 수집 패턴 참고해 **독립 구현** | — | 기본 off (`BUZZ_X_ENABLED=false`) |

### API 예산 (기본 5타깃 기준 — 한도 내 여유 확인)

- 네이버 검색: 타깃 5 × 쿼리 변형 ≤3 × 채널 3 = **≤45콜/일** (일 한도 25,000 — 여유 충분)
- 데이터랩: 5타깃 ÷ 그룹5 = **1콜/일**
- Gemini: 타깃당 정제 후 최대 60건 본문 → 감성 배치(30건/콜) 2콜 + 연관어 1콜 = 타깃당 3콜,
  5타깃 = **~15콜/일** + 트리거 요약 ≤5콜. 배치 간 `sleep(2000)`, 429→15초 재시도, 503→모델
  폴백 체인(`gemini-2.5-flash`→`gemini-2.5-flash-lite`) — 본체 extractor.js의 검증된 패턴을
  `buzz/lib/gemini.js`에 이식.

---

## 3. 데이터 모델 (data/buzz.db)

```sql
-- 수집 원문 (채널 공통)
CREATE TABLE IF NOT EXISTS buzz_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target      TEXT NOT NULL,          -- 타깃 id (targets.json의 id)
  channel     TEXT NOT NULL,          -- blog | news | cafe | x
  url         TEXT NOT NULL,
  title       TEXT,
  description TEXT,                   -- API가 주는 요약 텍스트 (분석 입력)
  published_at TEXT,                  -- YYYY-MM-DD
  collected_at TEXT NOT NULL,         -- YYYY-MM-DD (수집일)
  is_noise    INTEGER DEFAULT 0,      -- STEP 3 판정 (1=노이즈)
  noise_reason TEXT,                  -- ad | spam | homonym | event
  sentiment   TEXT,                   -- positive | negative | neutral (STEP 4)
  UNIQUE(target, url)                 -- 신규 DB라 UNIQUE 인덱스 사용 가능 (본체와 달리 기존 중복 없음)
);

-- 일별 지표 (리포트/시계열의 원천)
CREATE TABLE IF NOT EXISTS buzz_daily_stats (
  target TEXT NOT NULL,
  date   TEXT NOT NULL,               -- YYYY-MM-DD
  channel TEXT NOT NULL,              -- blog | news | cafe | x | datalab
  volume INTEGER DEFAULT 0,           -- 당일 신규 언급 수 (datalab이면 관심도 지수)
  total_hint INTEGER,                 -- 검색 API total (채널 총량 프록시, 추이 비교용)
  pos_count INTEGER DEFAULT 0,
  neg_count INTEGER DEFAULT 0,
  neu_count INTEGER DEFAULT 0,
  PRIMARY KEY (target, date, channel)
);

-- 일별 연관어
CREATE TABLE IF NOT EXISTS buzz_assoc_words (
  target TEXT NOT NULL,
  date   TEXT NOT NULL,
  word   TEXT NOT NULL,
  count  INTEGER DEFAULT 0,
  PRIMARY KEY (target, date, word)
);

-- 스파이크 이벤트 (감지 이력 + 트리거)
CREATE TABLE IF NOT EXISTS buzz_spikes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target TEXT NOT NULL,
  date   TEXT NOT NULL,
  ratio  REAL,                        -- 베이스라인 대비 배율
  trigger_urls TEXT,                  -- JSON 배열 [{url,title,channel}]
  trigger_summary TEXT,               -- LLM 1줄 원인 요약
  UNIQUE(target, date)
);
```

**필드명 계약**: DB는 snake_case. JS 레이어로 나올 때 camelCase로 매핑하는 함수는
`buzz/db.js` 한 곳에만 둔다(본체 `getKeywordStats()` 매핑 레이어의 교훈).
소비자(metrics.js/reporter.js)는 camelCase만 읽는다. **매핑을 바꾸면 소비자도 같이 바꾼다.**

### targets.json 스키마 (STEP 1 — 키워드 세팅)

```jsonc
// buzz/targets.json — 사용자가 직접 편집하는 유일한 파일
{
  "targets": [
    {
      "id": "1kg-daifuku",                 // 영문 슬러그 (DB 키)
      "name": "1kg 딸기 찹쌀떡",            // 리포트 표시명
      "queries": ["1kg 찹쌀떡", "일키로 찹쌀떡", "1키로 찹쌀떡"], // 본명+줄임말+오탈자 변형
      "exclude": ["레시피 재료 1kg"],       // 동음이의/오염 컨텍스트 제외 힌트 (cleaner가 사용)
      "competitors": ["OO당 찹쌀떡"],       // 선택 — 있으면 버즈량 비교 줄 추가
      "datalabGroup": "1kg 찹쌀떡"          // 데이터랩 keywordGroups용 대표어 (선택)
    }
  ]
}
```

- 타깃 수 권장 3~7개 (텔레그램 4096자 제한 + 데이터랩 그룹 5개 제약 고려. 5개 초과 시 데이터랩 2콜).
- 초기값은 예시 1건만 넣고, 실제 타깃은 **사용자(지경)가 채운다** — 구현자가 임의로 브랜드를 넣지 말 것.

---

## 4. 기능단위 수직 슬라이스 (구현 순서 — 각 슬라이스가 끝나면 그대로 배포 가능)

각 슬라이스는 "수집→저장→리포트 반영"까지 관통하는 세로 조각이다.
**슬라이스 하나 끝날 때마다 커밋**하고, 리포트가 실제로 한 단계씩 풍성해지는지 확인한다.

---

### BZ-0. 워킹 스켈레톤 — "빈 리포트라도 매일 도착"

**목적**: 격리 구조 전체를 먼저 세우고, 텔레그램에 뼈대 리포트가 매일 도착하게 만든다.

- 신규: `buzz/index.js`(CLI: run/test/report), `buzz/pipeline.js`, `buzz/config.js`,
  `buzz/db.js`(스키마 생성만), `buzz/lib/telegram.js`, `buzz/targets.json`(예시 1건),
  `buzz/reporter.js`(타깃 목록+"데이터 수집 준비 중" 스켈레톤 메시지),
  `.github/workflows/buzz-analysis.yml`(KST 07:00, 격리 원칙 §1-7 커밋 스텝 포함)
- 기존 파일: `package.json` 스크립트, `.env.example` buzz 섹션, `CLAUDE.md` 한 단락 (§1-6 허용분)
- `buzz/lib/telegram.js`: 4096자 초과 시 섹션 경계 분할 전송 (telegram-dev 스킬 규칙 준수)
- **test 모드**: `node buzz/index.js test` — API 키 없이 목업 데이터로 파이프라인 전 단계 통과
  검증. 본체 `index.js test`와 같은 역할. **이후 모든 슬라이스는 test 모드에 목업을 추가한다.**
- **DoD**: workflow_dispatch 수동 실행 → 텔레그램에 스켈레톤 리포트 도착. `data/trend.db`
  diff 없음. `node index.js test`(본체) 여전히 통과 — 격리 확인.

---

### BZ-1. 버즈량 (Volume) — 지표 ①

**목적**: 타깃별·채널별 언급량을 매일 쌓고, 리포트에 총 버즈량 + 전일/전주 대비를 싣는다.

- 신규: `buzz/collector.js`, `buzz/lib/naver.js`, `buzz/metrics.js`(증감 계산부)
- 수집: 타깃의 `queries` 각각을 블로그/뉴스/카페 3채널 검색(display=100, sort=date).
  `published_at`이 당일±1일인 것만 당일 volume으로 집계(발행일 필터 — 본체 P0-2 교훈).
  URL 기준 크로스데이 dedup(`UNIQUE(target,url)` + INSERT OR IGNORE).
  데이터랩 관심도 지수도 `channel='datalab'` 행으로 저장.
- 지표: `todayVolume`, `vsYesterday`(배율), `vs7dayAvg`(배율), 14일 미니 추이(▁▂▅▇ 스파크라인 문자).
- 리포트 반영:
  ```
  ■ 1kg 딸기 찹쌀떡
  버즈량 47건 (전일 ×2.1 ↑ / 주평균 ×1.6)  ▁▂▂▃▅▇
  ```
- **DoD**: test 모드에서 목업 3일치로 증감 배율 계산 검증. 실 실행에서 buzz_daily_stats에
  타깃×채널 행 적재 확인.

---

### BZ-2. 채널별 분포 (Channel Share) — 지표 ④

**목적**: "이야기가 어디서 나오는가"를 비율로 보여준다.

- 수정: `buzz/metrics.js`(채널 비율), `buzz/reporter.js`(분포 줄)
- 지표: 최근 7일 채널별 volume 합의 비율. 전주 대비 비중 변화가 ±15%p 이상이면 화살표 표시.
- 리포트 반영: `채널: 블로그 55% · 카페 30%↑ · 뉴스 15%`
- **DoD**: test 목업에서 비율 합 100% ±1, 급변 화살표 로직 검증.

**참고**: BZ-2는 BZ-1의 데이터만 소비하므로 가장 작다. 여세를 몰아 빨리 끝내고 BZ-3으로.

---

### BZ-3. 정제·필터링 — 분석 정확도의 기반

**목적**: 도배/광고/동음이의 노이즈를 걸러 이후 감성·연관어 분석의 입력 품질을 확보한다.
('콘크리트 디저트' 사건 — 오염 키워드는 리포트 가치 0 — 의 buzz판 예방.)

- 신규: `buzz/cleaner.js`
- 규칙 기반(무료·LLM 0콜) 우선:
  - **광고/이벤트**: title/description에 광고 시그널(`협찬`, `이벤트 참여`, `체험단`, `원고료`,
    `쿠팡파트너스` 등 사전) → `noise_reason='ad'|'event'`
  - **도배**: 같은 날 동일 계정/블로그 도메인에서 유사 제목 3건 이상 → `spam`
  - **동음이의**: `targets.json`의 `exclude` 힌트 문자열 포함 → `homonym`
- 노이즈는 삭제하지 않고 `is_noise=1` 마킹만 — 버즈량은 **정제 후 기준**으로 재계산하되,
  리포트에 `(노이즈 12건 제외)` 각주. 원본 보존으로 규칙 튜닝 가능하게.
- 리포트 반영: `버즈량 35건 (노이즈 12건 제외, 전일 ×1.8)`
- **DoD**: test 목업에 의도적 함정(협찬 글, 동음이의 글, 도배 3연글)을 넣고 전부 마킹되는지
  육안 확인 — 본체 TEST_POSTS의 TRAP/REAL 패턴 답습.

---

### BZ-4. 감성 분석 (Sentiment) — 지표 ②

**목적**: 긍/부/중 비율 산출 + **부정 급증 리스크 경보**.

- 신규: `buzz/lib/gemini.js`(키 로테이션·폴백·429/503 처리 — extractor.js 패턴 독립 이식),
  `buzz/analyzer.js`(감성부)
- 프롬프트 계약(본체 규칙 상속): **"JSON 배열만 출력, 없으면 []"** 강제 +
  `responseMimeType:"application/json"`, temperature 0.2.
  입력: 정제 통과 post의 title+description 배치 30건. 출력: `[{id, sentiment, evidence}]`
  (`evidence`=판단 근거 짧은 인용 — 리스크 경보 시 근거 제시용).
- 지표: 당일 긍/부/중 비율. **리스크 규칙**: 부정 비율 ≥30% AND 부정 건수 ≥5 AND
  전일 대비 부정 비율 +15%p → 리포트 최상단 `🚨 리스크 감지` 섹션으로 승격.
  (이 임계값은 `buzz/config.js`에만 정의 — 하드코딩·config 이중정의 금지, 본체 §4 교훈.)
- 리포트 반영: `감성: 😊 62% · 😐 28% · 😡 10%` / 리스크 시 부정 대표글 1건 링크.
- **DoD**: test 모드에 MOCK 감성 결과 주입 경로 마련(키 없이 검증). 실 실행 Gemini 콜 수가
  §2 예산(~15콜) 이내인지 로그로 확인.

---

### BZ-5. 연관어 (Associated Words) — 지표 ③

**목적**: 타깃이 어떤 맥락·이미지와 함께 언급되는지 톱N + 신규 진입어.

- 수정: `buzz/analyzer.js`(연관어부)
- 방식: 타깃당 1콜 — 정제 통과 본문 전체(최대 60건 title+description)를 주고
  `[{word, count_hint, context}]` 톱15 추출. (형태소 분석기 의존성 추가 대신 LLM 활용 —
  무료 티어 예산 내이고 불용어/조사 처리가 공짜로 됨. 별도 라이브러리 도입은 스폰서 승인 사항.)
- 저장: `buzz_assoc_words`. **신규 진입어** = 오늘 톱10에 있으나 직전 7일 톱10에 없던 단어.
- 리포트 반영(텔레그램은 이미지 불가 → 워드클라우드 대신 텍스트 랭킹):
  ```
  연관어: 쫀득(21) · 딸기(18) · 웨이팅(11) · 선물(9)
  🆕 신규: "품절대란" (어제까지 없던 단어)
  ```
- **DoD**: test 목업으로 신규 진입어 판정(7일 비교) 검증.

---

### BZ-6. 스파이크 감지 + 트리거 역추적 — 인사이트의 핵심

**목적**: 버즈량 급증 지점을 자동 감지하고 **그 숫자를 만든 원문**을 찾아 붙인다.

- 수정: `buzz/metrics.js`(스파이크 판정), `buzz/analyzer.js`(트리거 요약)
- 스파이크 판정: `todayVolume ÷ 직전 7일 일평균 ≥ 3.0` AND `todayVolume ≥ 10`
  (베이스라인 0이면 todayVolume ≥ 10으로 대체 — 본체 burstRatio의 0-나눗셈 처리 답습.
  임계값은 config에 정의, 실데이터 분포 확인 전 임의 조정 금지).
- 트리거 역추적: 스파이크 당일 post 중 ① 뉴스 우선 ② 제목에 타깃명 정확 포함 ③ 발행 시각
  빠른 순으로 톱3 후보 선정 → Gemini 1콜로 "무슨 일이 있었나" 1줄 요약(`trigger_summary`).
- 저장: `buzz_spikes` (같은 target+date 재감지 시 중복 발송 방지 — UNIQUE가 쿨다운 역할).
- 리포트 반영:
  ```
  ⚡ 스파이크: 어제 대비 ×4.2
  └ 원인 추정: MBC '오늘 뭐 먹지' 방송 소개 (07/13)
  └ https://news.naver.com/...
  ```
- **DoD**: test 목업(평평한 6일 + 급증 1일)으로 감지·중복방지 검증. 트리거 요약은 MOCK 경로.

---

### BZ-7. 리포트 완성 + 운영 안정화

**목적**: 6개 지표를 하나의 완결된 데일리 리포트로 통합하고 운영 루틴을 굳힌다.

- 최종 리포트 포맷 (타깃당 1블록, 4096자 초과 시 타깃 경계에서 분할):
  ```
  📊 화제성 리포트 — 07/14(화)

  🚨 리스크 감지            ← 있을 때만, 최상단
  ■ (타깃명): 부정 34%↑ …

  ■ 1kg 딸기 찹쌀떡
  버즈량 47건 (노이즈 12 제외 · 전일 ×2.1↑)  ▁▂▂▃▅▇
  채널: 블로그 55% · 카페 30%↑ · 뉴스 15%
  감성: 😊 62% · 😐 28% · 😡 10%
  연관어: 쫀득(21) · 딸기(18) · 웨이팅(11)  🆕 품절대란
  ⚡ 스파이크 ×4.2 — MBC 방송 소개 추정
  └ https://news.naver.com/...

  ■ (다음 타깃) …

  ⚠️ 데이터랩 수집 실패 (오늘 관심도 지수 결측)   ← 부분 실패 표기
  ```
- 운영:
  - 워크플로 실패 시 텔레그램 에러 알림(본체 패턴, 메시지에 `buzzAnalysis` 명시)
  - DB 커밋 메시지: `chore: buzz DB update YYYY-MM-DD` (본체 `daily DB update`와 구분)
  - 데이터 보존: buzz_posts는 90일 경과분 자동 삭제(주 1회, DB 비대화 방지 — 지표 테이블은 영구 보존)
- **DoD**: workflow_dispatch 실 실행 → 전 섹션 포함 리포트 수신. 로그 마커
  (`[buzz:collector] N건 수집`, `[buzz:cleaner] 노이즈 N건 마킹`, `[buzz:analyzer] 감성 배치 N콜`,
  `[buzz:metrics] 스파이크 감지`, `[buzz:reporter] 발송 완료`) 전부 확인.
  이후 cron 이틀 연속 자동 발송 확인으로 완료 선언.

---

## 5. 검증 절차 (모든 슬라이스 공통)

```bash
node buzz/index.js test          # 목업으로 buzz 파이프라인 검증 (키 불필요)
node index.js test               # 본체 회귀 확인 — buzz 작업이 본체를 못 건드렸는지
node --check buzz/수정파일.js     # 문법 1차 체크
git status                       # data/*.db, .env가 staged면 제외
```

- **실키 검증은 로컬이 아니라 GitHub Actions**(workflow_dispatch)로 한다 — 원격 세션에는
  `.env`가 없다(본체 스킬 §6·§7과 동일). 트리거: GitHub MCP `actions_run_trigger`
  (workflow_id `buzz-analysis.yml`, ref `main`) → `get_job_logs`로 로그 마커 확인.
- 신규 GitHub Secrets는 **불필요** (기존 시크릿 재사용). 단 `buzz-analysis.yml`의 `env:`에
  기존 시크릿들을 명시적으로 매핑해야 런타임에 보인다(본체 교훈: workflow env에 없으면
  Secrets에 있어도 안 보임).

## 6. 미리 내린 의사결정 (구현 중 재논쟁 금지)

| 결정 | 이유 |
|---|---|
| `buzz/` 완전 격리, `src/` import 금지 | 사용자 요구("소스 안 꼬이게") + agents-slack 격리 선례 |
| 채널 = 네이버 블로그/뉴스/카페 3종 주력 | 무료 API로 커버 가능한 최대 조합. X는 옵션 off, Instagram은 본체와 동일하게 배제(403 이력) |
| 연관어를 형태소 분석기 대신 LLM으로 | 신규 의존성 0, 무료 예산 내, 불용어 처리 내장. 유료/무거운 NLP 도입은 스폰서 결정 |
| 노이즈는 삭제 대신 is_noise 마킹 | 규칙 튜닝 가능성 보존, 리포트에 제외 건수 투명 표기 |
| KST 07:00 실행 | 본체(04:00)와 API 쿼터·RPM 충돌 방지 + 출근 전 수신 |
| buzz.db에 UNIQUE 인덱스 사용 | 신규 DB라 본체의 "기존 중복 때문에 코드 레벨 dedup" 제약이 없음 |
| 리스크 경보 임계값(부정 30%/5건/+15%p) | 초기값. **변경은 사용자 확인 후** — 본체 shouldAlert revert(20e2be8) 교훈 |
| targets.json은 사용자가 채움 | 무엇을 추적할지는 스폰서 결정 사항. 예시 1건만 커밋 |

## 7. 구현자(Sonnet)에게

- 슬라이스 순서 엄수: **BZ-0 → 1 → 2 → 3 → 4 → 5 → 6 → 7**. 건너뛰기·병합 금지.
- 각 슬라이스 = 커밋 1개 이상, 한국어 커밋 메시지 (예: `buzz BZ-1: 버즈량 수집·증감 지표 추가`).
- 시작 전 `.claude/skills/trendleading-dev/SKILL.md`(작업 원칙·검증)와
  `telegram-dev`(4096자 분할), `hermes-dev`(Gemini 무료 티어) 스킬을 읽을 것.
- 막히면 임의 판단하지 말고 사용자에게 질문 — 특히 임계값, 타깃 목록, 유료 전환이 걸린 지점.
