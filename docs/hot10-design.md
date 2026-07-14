# hot10 — 분야 무관 한국/글로벌 화제성 Top 10 데일리 레포팅 설계서

> **문서 성격**: 구현 지시서. 실행(코딩)은 Sonnet이 이 문서의 슬라이스 순서대로 진행한다.
> **작성일**: 2026-07-14 · **스폰서**: 지경
> **전제**: trendLeading 본체·buzzAnalysis와 **소스가 절대 꼬이지 않는 완전 격리 모듈**
> (buzzAnalysis와 동일한 격리 패턴). 100% 무료 스택 원칙 유지.

---

## 0. 목적 정의

**분야 상관없이** 지금 한국에서, 그리고 글로벌에서 가장 화제인 토픽 **Top 10을 각각** 매일 아침
텔레그램으로 리포트한다. 사용자는 타깃을 등록하지 않는다 — 시스템이 스스로 찾는다.

이 레포의 세 모듈은 목적이 서로 다르다. 혼동 금지:

| | trendLeading (src/) | buzzAnalysis (buzz/) | **hot10 (hot10/)** |
|---|---|---|---|
| 질문 | "오늘 뭘 쓰면 블로그 유입이 생기나?" | "내 타깃이 지금 어떤 상태인가?" | **"지금 세상에서 뭐가 제일 화제인가?"** |
| 분야 | F&B 한정 | 사용자 지정 타깃 | **분야 무관 (연예/스포츠/정치/테크/사회/…)** |
| 방식 | 발굴 + 검색유입 랭킹 | 추적 + 4대 지표 | **발굴 + 교차 소스 랭킹** |
| 산출물 | 황금 소재 리포트 | 타깃별 버즈 리포트 | **KR Top 10 + Global Top 10** |

### 핵심 설계 사상 — 교차 검증 랭킹

단일 소스의 순위는 그 플랫폼의 편향(구글=검색, 레딧=커뮤니티, 위키=사후 관심)을 그대로 반영한다.
**여러 독립 소스에 동시에 등장하는 토픽일수록 "진짜 화제"**다. 따라서 소스별 순위를 수집한 뒤
같은 토픽을 병합(클러스터링)하고, **몇 개 소스에서 얼마나 높은 순위로 등장했는가**로 최종 랭킹한다.

---

## 1. 격리 원칙 (buzzAnalysis 격리 패턴 §1 그대로 상속 — 협상 불가)

1. **디렉토리 격리**: 모든 신규 코드는 레포 루트의 **`hot10/`** 아래에만. `src/`·`buzz/` **import 금지**.
   필요한 유틸(텔레그램 전송, Gemini 호출)은 `hot10/lib/`에 **독립 구현(복사)** — buzz/lib의
   telegram.js·gemini.js를 복사해 로그 접두만 `[hot10:...]`로 바꾸면 된다.
2. **DB 격리**: 전용 파일 **`data/hot10.db`**. trend.db·buzz.db는 읽기조차 금지.
3. **워크플로 격리**: 전용 **`.github/workflows/hot10-daily.yml`**. 기존 워크플로 수정 금지.
4. **실행 시간 분리**: trendLeading KST 04:00, buzzAnalysis KST 07:00이므로 hot10은
   **KST 07:30 (cron `30 22 * * *`)**. Gemini RPM·API 쿼터 충돌 방지.
5. **환경변수**: 기존 키(GEMINI_API_KEY~_5, TELEGRAM_*)는 읽기 공유. hot10 전용 신규 변수는
   **`HOT10_` 접두사** (예: `HOT10_TELEGRAM_CHAT_ID` — 미설정 시 TELEGRAM_CHAT_ID 폴백).
   **신규 GitHub Secrets 등록 불필요.**
6. **기존 파일 수정 허용 범위**: `package.json` 스크립트(`hot10`, `hot10:test`),
   `.env.example` hot10 섹션, `CLAUDE.md` 한 단락, `.gitignore`의 `!data/hot10.db`. 그 외 금지.
7. **DB 커밋 경합 대비**: 커밋 스텝은 `git pull --rebase origin main` 후 push, 실패 시 3회 재시도
   (buzz-analysis.yml의 커밋 스텝을 그대로 복사).
8. **스타일 계약 상속**: DB snake_case / JS camelCase, 한국어 주석, `[hot10:모듈명]` 로그 접두,
   한국어 커밋 메시지, `.env`·테스트 산물 DB 커밋 금지.
9. **부분 실패 격리**: 소스 하나가 죽어도 나머지 소스로 리포트를 만든다. 죽은 소스는 리포트
   하단에 `⚠️ (소스명) 수집 실패` 각주로 표기. **테스트 목업은 전용 가짜 데이터로만** —
   buzz BZ-DoD에서 확립한 `__test-*` 격리 패턴을 처음부터 적용한다.

---

## 2. 전체 아키텍처 (5단계 파이프라인)

```
hot10/index.js (CLI: run | test)
  └─ hot10/pipeline.js runHot10Pipeline()
       STEP 1  수집(KR)      hot10/sources-kr.js      (구글트렌드 KR + 위키피디아 KO + 옵션 소스)
       STEP 2  수집(Global)  hot10/sources-global.js  (구글트렌드 US + 레딧 + 위키피디아 EN + HN)
       STEP 3  정규화·병합    hot10/normalizer.js      (Gemini — 소스 간 동일 토픽 클러스터링 + 카테고리 + 1줄 요약)
       STEP 4  랭킹          hot10/ranker.js           (교차 스코어 → 리전별 Top 10 + NEW/연속 판정)
       STEP 5  리포트 발송    hot10/reporter.js         (텔레그램 "오늘의 화제 Top 10")
공통:  hot10/db.js (better-sqlite3, data/hot10.db)
       hot10/config.js (env → 설정, HOT10_ 접두)
       hot10/lib/telegram.js · hot10/lib/gemini.js (buzz/lib에서 복사한 독립 유틸)
```

### 데이터 소스 (전부 무료 — 키 필요 소스는 옵션으로 격리)

| 리전 | 소스 | 접근 방법 | 신뢰도/비고 |
|---|---|---|---|
| KR | **구글 트렌드 급상승 검색어** | RSS `https://trends.google.com/trending/rss?geo=KR` (무키) | 주력. 비공식 피드라 포맷 변경 리스크 → fail-open 필수 |
| KR | **위키피디아 한국어판 최다 조회** | Wikimedia REST `.../metrics/pageviews/top/ko.wikipedia/all-access/{y}/{m}/{d}` (무키, 공식) | 전일 데이터(1일 지연) — "어제 무엇이 궁금했나". 메인페이지·특수문서 제외 필터 필요 |
| KR | 네이버 뉴스 많이 본 뉴스 랭킹 | HTML 스크래핑 (무키) | **옵션(기본 off, `HOT10_NAVER_RANKING_ENABLED`)** — 마크업 변경에 취약. 켜도 실패 시 무시 |
| Global | **구글 트렌드 급상승 검색어 (US)** | RSS `?geo=US` (무키) | 글로벌 프록시. 필요 시 GB·JP 추가 가능하나 초기엔 US만 |
| Global | **Reddit r/all 일간 톱** | JSON `https://www.reddit.com/r/all/top.json?t=day&limit=30` (무키) | User-Agent 헤더 필수(없으면 429). 커뮤니티 화제성 |
| Global | **위키피디아 영어판 최다 조회** | Wikimedia REST (en.wikipedia) | 전일 데이터. 글로벌 관심사 대표 |
| Global | Hacker News 톱 | Firebase API (무키) | 테크 편향 — **보조 가중(0.5)** 으로만 반영 |
| 양쪽 | YouTube 인기 급상승 | Data API `videos?chart=mostPopular&regionCode=` | **옵션(기본 off)** — 무료지만 `YOUTUBE_API_KEY` 신규 발급 필요. 스폰서가 원할 때만 |

- 모든 소스 호출은 try/catch로 감싸고 실패 시 빈 배열 반환. **소스 2개 이상 살아있으면 리포트 발송.**
- Instagram·X 트렌드는 무료 접근 불가(본체 403 이력·X API 유료) — 도입하지 않는다.

### API 예산

- 소스 수집: HTTP GET 6~8콜/일 (전부 무료·무키)
- Gemini: **리전당 1콜 × 2 = 2콜/일** (정규화+카테고리+요약을 한 프롬프트에서 처리).
  buzz(~15콜)·본체와 합쳐도 무료 티어 한도에 여유. 배치 간 지연 불필요(콜 수 적음).

---

## 3. 데이터 모델 (data/hot10.db)

```sql
-- 소스별 원시 수집 (STEP 1~2)
CREATE TABLE IF NOT EXISTS hot10_raw (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  region TEXT NOT NULL,            -- kr | global
  source TEXT NOT NULL,            -- gtrends | wiki | reddit | hn | naver_rank | youtube
  rank INTEGER NOT NULL,           -- 해당 소스 내 순위 (1부터)
  title TEXT NOT NULL,             -- 소스가 준 원문 제목/검색어
  traffic_hint TEXT,               -- 소스가 주는 규모 힌트 (예: "20만+ 검색", 조회수, 업보트)
  url TEXT,                        -- 대표 링크 (뉴스/글)
  collected_date TEXT NOT NULL,    -- YYYY-MM-DD
  UNIQUE(region, source, collected_date, title)
);

-- 최종 랭킹 (STEP 3~4 산출, 리포트·연속성 판정의 원천)
CREATE TABLE IF NOT EXISTS hot10_topics (
  region TEXT NOT NULL,
  date TEXT NOT NULL,
  rank INTEGER NOT NULL,           -- 1~10
  topic TEXT NOT NULL,             -- 정규화된 대표 토픽명 (한국어로 통일)
  category TEXT,                   -- 연예 | 스포츠 | 정치사회 | 경제 | 테크 | 문화 | 사건사고 | 기타
  reason TEXT,                     -- 왜 화제인지 1줄 (LLM)
  sources TEXT DEFAULT '[]',       -- JSON: [{"source":"gtrends","rank":3}, ...]
  score REAL,                      -- 교차 스코어
  url TEXT,                        -- 대표 링크 1개
  PRIMARY KEY (region, date, rank)
);
```

**필드명 계약**: DB snake_case → JS camelCase 매핑은 `hot10/db.js` 한 곳에서만 (buzz/db.js 패턴).

---

## 4. 교차 스코어링 공식 (ranker.js — 초기값, 실데이터 분포 확인 전 임의 조정 금지)

```
소스 가중치 W: gtrends 1.0 / wiki 0.8 / reddit 0.8 / naver_rank 0.8 / youtube 0.7 / hn 0.5
소스 내 순위 점수 P(rank) = (N + 1 - rank) / N     # N = 그 소스의 수집 개수(보통 20~30), 1위=1.0

topicScore = Σ_등장소스 W(source) × P(rank)  ×  (1 + 0.3 × (등장 소스 수 - 1))
```

- 마지막 항이 **교차 등장 보너스**: 2개 소스 등장 시 ×1.3, 3개 소스 ×1.6. 단일 소스 1위보다
  복수 소스 중위권이 이기도록 설계 — "여러 곳에서 동시에 화제 = 진짜 화제" 사상 구현.
- 동점이면 gtrends 순위 빠른 쪽 우선. 상위 10개 컷.
- 가중치·보너스 계수는 `hot10/config.js`에만 정의 (하드코딩·config 이중 정의 금지 — 본체 §4 교훈).

### 연속성 판정 (리포트 가독성의 핵심)

- **NEW 뱃지**: 오늘 Top 10에 있으나 어제 Top 10에 없던 토픽. 토픽명 정규화(trim/lowercase)
  완전일치 + 핵심 토큰 겹침으로 판정(변형 표기 흡수).
- **연속 표시**: 어제도 있던 토픽은 순위 변동 화살표(↑3 / ↓2 / -) + 연속 N일째.
- 3일 이상 연속 토픽은 "지속 이슈"로 접미 표기 — 새 화제와 구분(본체 다이제스트의
  황금 소재/관찰 중 분리와 같은 사상).

---

## 5. 리포트 포맷 (텔레그램, KST 07:30)

```
🔥 오늘의 화제 Top 10 — 07/14(화)

🇰🇷 한국
━━━━━━━━━━━━━━━━━━━━━━
1. 🆕 (토픽명)  [연예]
   └ (왜 화제인지 1줄)  · 출처: 구글트렌드 2위 + 위키 5위
2. ↑3 (토픽명)  [스포츠] (3일째)
   └ ...
...

🌏 글로벌
━━━━━━━━━━━━━━━━━━━━━━
1. 🆕 (토픽명)  [테크]
   └ ...
...

⚠️ Reddit 수집 실패 (오늘 글로벌 랭킹에 미반영)   ← 부분 실패 시에만
```

- 토픽명은 글로벌 것도 **한국어로 번역/표기**(원어 병기: "타이푼 라가사(Typhoon Ragasa)") —
  STEP 3 LLM 프롬프트에서 처리.
- 항목당 최대 2줄 유지. 4096자 초과 시 리전 경계에서 분할(hot10/lib/telegram.js).

---

## 6. 기능단위 수직 슬라이스 (구현 순서 — 각 슬라이스가 끝나면 그대로 배포 가능)

buzzAnalysis에서 검증된 진행 방식 그대로: 슬라이스마다 수집→저장→리포트 반영을 관통, 커밋 1개 이상,
`node hot10/index.js test`(무키 목업) + `node index.js test`(본체 회귀) 통과 후 다음 슬라이스로.

---

### HT-0. 워킹 스켈레톤 — "빈 리포트라도 매일 도착"

- 신규: `hot10/index.js`(CLI run/test), `hot10/pipeline.js`, `hot10/config.js`,
  `hot10/db.js`(스키마), `hot10/lib/telegram.js`·`hot10/lib/gemini.js`(buzz/lib 복사, 로그 접두 변경),
  `hot10/reporter.js`(스켈레톤 메시지), `.github/workflows/hot10-daily.yml`(KST 07:30)
- 기존 파일: package.json 스크립트, .env.example, CLAUDE.md, .gitignore (§1-6 허용분만)
- **DoD**: workflow_dispatch → 텔레그램 스켈레톤 리포트 도착. trend.db·buzz.db diff 없음.
  본체·buzz test 모두 여전히 통과(3중 격리 확인).

### HT-1. 한국 수집 — 구글트렌드 KR + 위키피디아 KO

- 신규: `hot10/sources-kr.js` — RSS 파싱(구글트렌드: title/traffic/news link 추출),
  Wikimedia pageviews API(전일 날짜로 호출, 메인페이지·`특수:`·`위키백과:` 네임스페이스 제외,
  상위 20개). `hot10_raw`에 저장(UNIQUE로 재실행 멱등).
- RSS 파싱은 정규식/cheerio 중 택1 — cheerio가 이미 dependencies에 있으므로 신규 의존성 금지.
- 리포트 반영: 정규화 전이므로 임시로 "소스별 원시 수집 현황: 구글트렌드 N건 · 위키 N건" 한 줄.
- **DoD**: test 목업(가짜 RSS/JSON 응답 파싱 검증 — 실제 페치 함수와 파서 함수를 분리해
  파서만 목업 입력으로 검증). 실 실행에서 hot10_raw에 kr 행 적재 확인.

### HT-2. 글로벌 수집 — 구글트렌드 US + Reddit + 위키피디아 EN + HN

- 신규: `hot10/sources-global.js` — HT-1과 같은 구조. Reddit은 User-Agent 헤더
  (`hot10-daily-report/1.0`) 필수, 30개 요청 후 상위 20개만 저장. HN은 topstories 상위 15개.
- 소스별 try/catch — 하나 죽어도 나머지 진행, 죽은 소스명을 pipeline이 수집해 리포트 각주로.
- **DoD**: test 목업으로 각 파서 검증 + 소스 1개 강제 실패 시나리오에서 나머지가 살아남는지 확인.

### HT-3. LLM 정규화·병합 — 소스 간 동일 토픽 클러스터링

- 신규: `hot10/normalizer.js` — 리전당 Gemini 1콜. 입력: 그 리전의 오늘 hot10_raw 전체
  (source/rank/title/traffic_hint). 출력 계약(JSON 배열 강제, `responseMimeType:"application/json"`,
  temperature 0.2 — 본체 프롬프트 계약 상속):
  ```json
  [{"topic":"대표 토픽명(한국어, 원어 병기)","category":"연예|스포츠|정치사회|경제|테크|문화|사건사고|기타",
    "reason":"왜 화제인지 1줄","members":[{"source":"gtrends","rank":3,"title":"원문"}],"url":"대표링크|null"}]
  ```
  - 같은 이슈의 다른 표기(예: 검색어 "손흥민 이적" ↔ 위키 "손흥민" ↔ reddit "Son Heung-min transfer")를
    한 토픽으로 병합하는 것이 이 STEP의 존재 이유.
  - **환각 방지 규칙**: members에 없는 소스를 지어내지 마라, 병합 확신이 없으면 별개 토픽으로 둬라,
    reason은 입력 title/traffic_hint에서 추론 가능한 범위만.
- LLM 실패 시 fallback: 병합 없이 소스별 원시 토픽을 그대로 사용(topic=title, category=기타) —
  리포트가 결측되는 것보다 낫다.
- **DoD**: test에 MOCK 정규화 결과 주입 경로(키 없이 검증). 실 실행에서 병합 사례
  (members 2개 이상인 토픽) 존재 여부를 로그로 확인.

### HT-4. 교차 스코어링 + Top 10 랭킹

- 신규: `hot10/ranker.js` — §4 공식 구현. normalizer 출력의 members로 topicScore 계산,
  리전별 상위 10개를 `hot10_topics`에 저장(재실행 시 당일 행 DELETE 후 INSERT — 멱등).
- 리포트 반영: 순위·토픽·카테고리·reason·출처 뱃지(§5 포맷의 연속성 표시 제외 버전).
- **DoD**: test 목업 — 단일 소스 1위 토픽 vs 3개 소스 중위권 토픽을 넣어 **후자가 이기는지**
  검증(교차 보너스 동작 확인). 소스 가중치가 config에서만 오는지 확인.

### HT-5. 연속성(NEW/순위변동/N일째) + 리포트 완성 + 운영

- 수정: `hot10/ranker.js`(어제 hot10_topics와 비교), `hot10/reporter.js`(§5 최종 포맷),
  `hot10/pipeline.js`(소스 실패 각주, 로그 마커 정리)
- 운영: 실패 시 텔레그램 에러 알림(hot10 명시), DB 커밋 메시지 `chore: hot10 DB update YYYY-MM-DD`,
  hot10_raw 90일 경과분 주 1회 정리(hot10_topics는 영구 보존 — 연속성 판정 원천).
- 로그 마커(Actions 검증용): `[hot10:sources-kr] N건 수집`, `[hot10:sources-global] N건 수집`,
  `[hot10:normalizer] 병합 완료: N개 토픽 (병합 M건)`, `[hot10:ranker] KR Top10 확정`,
  `[hot10:reporter] 발송 완료`
- **DoD**: test 목업(어제 데이터 시딩 → 오늘 NEW/↑↓/N일째 판정 검증). workflow_dispatch 실 실행
  → 전 섹션 리포트 수신 + 로그 마커 확인. 이후 cron 이틀 연속 자동 발송 확인으로 완료 선언.

---

## 7. 검증 절차 (모든 슬라이스 공통)

```bash
node hot10/index.js test    # 무키 목업 검증 (파서·스코어·연속성·포맷)
node buzz/index.js test     # buzz 회귀 — hot10 작업이 buzz를 못 건드렸는지
node index.js test          # 본체 회귀
node --check hot10/수정파일.js
git status                  # data/*.db(테스트 산물), .env가 staged면 제외
```

- 실키 검증은 GitHub Actions workflow_dispatch(`hot10-daily.yml`)로. 원격 세션엔 `.env` 없음.
- 커밋할 hot10.db는 스키마 전용 상태로 재생성 후 커밋(테스트 산물 금지 — buzz에서 확립한 절차).

## 8. 미리 내린 의사결정 (구현 중 재논쟁 금지)

| 결정 | 이유 |
|---|---|
| `hot10/` 완전 격리, src/·buzz/ import 금지 | 사용자 요구(소스 안 꼬이게) + 검증된 격리 패턴 |
| 구글트렌드 RSS 주력 | 유일한 무키 실시간 급상승 검색어 소스. 비공식이므로 fail-open + 소스 헬스 각주 |
| 위키피디아 pageviews 채택(1일 지연 감수) | 공식 API·무키·안정적. "지연"은 교차 검증 보조 역할로 충분 |
| 글로벌 = US 프록시로 시작 | 리전 추가는 Gemini 콜·리포트 길이 증가 — 스폰서가 원하면 확장 |
| X·Instagram 트렌드 배제 | 무료 접근 불가(X API 유료, IG 403 이력) |
| YouTube·네이버 랭킹은 옵션(기본 off) | 신규 키 발급/스크래핑 취약성 — 스폰서 결정 사항 |
| 정규화·번역·요약을 LLM 1콜/리전에 통합 | 무료 티어 예산 최소화(2콜/일). 형태소/번역 라이브러리 신규 의존성 금지 |
| 교차 등장 보너스(×1.3/1.6) | "복수 소스 동시 등장 = 진짜 화제" — 이 모듈의 존재 이유. 계수 변경은 사용자 확인 후 |
| hot10_topics 영구 보존 | NEW/연속성 판정 원천 + 추후 "이달의 이슈" 회고 리포트 확장 여지 |

## 9. 구현자(Sonnet)에게

- 슬라이스 순서 엄수: **HT-0 → 1 → 2 → 3 → 4 → 5**. 건너뛰기·병합 금지.
- 각 슬라이스 = 커밋 1개 이상, 한국어 커밋 메시지 (예: `hot10 HT-1: 한국 소스 수집 — 구글트렌드 KR + 위키 KO`).
- 시작 전 `docs/buzz-analysis-design.md`(격리 패턴 원본)와 trendleading-dev·telegram-dev·hermes-dev
  스킬을 읽을 것. buzz 구현 커밋 이력(BZ-0~BZ-7)이 살아있는 참고 사례다.
- 테스트 목업은 반드시 `__test-` 접두 전용 데이터로 — 실 데이터 오염 금지(buzz 타깃 등록 시 교훈).
- 막히면 임의 판단하지 말고 사용자에게 질문 — 특히 소스 추가/제거, 가중치, 유료 전환이 걸린 지점.
