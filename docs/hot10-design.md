# hot10 — 분야 무관 한국/글로벌 화제성 Top 10 데일리 레포팅 설계서 (완성 시 브랜드명: buzzAnalysis)

> **문서 성격**: 구현 지시서. 실행(코딩)은 Sonnet이 이 문서의 슬라이스 순서대로 진행한다.
> **작성일**: 2026-07-14 · **개정**: 2026-07-14 v3 (이름 체계 정리 — §0.2 참고) · **스폰서**: 지경
> **전제**: trendLeading 본체·타깃 추적 관찰(`buzz/`)과 **소스가 절대 꼬이지 않는 완전 격리 모듈**
> (`buzz/`와 동일한 격리 패턴). 100% 무료 스택 원칙 유지.
>
> **v3 이름 체계 (중요 — 문서 전체에서 헷갈리지 말 것)**: 사용자 지정에 따라 "buzzAnalysis"라는
> 브랜드명은 **이 hot10 모듈이 물려받는다** — 완성 후 텔레그램 리포트 타이틀은
> "🔥 buzzAnalysis 화제성 Top10"으로 나간다(§5). 기존에 "buzzAnalysis"로 불리던 타깃 등록형
> 추적 모듈(`buzz/` 디렉토리, 냉장고 털기 등)은 리포트 타이틀이 "🔍 타깃 추적 관찰"로 바뀌었다.
> **디렉토리명(`hot10/`, `buzz/`)과 DB 경로(`data/hot10.db`, `data/buzz.db`)는 바뀌지 않는다** —
> 이름 변경은 리포트 타이틀·문서 설명에만 적용된다. 이 문서 본문의 "buzzAnalysis" 언급은 전부
> "타깃 추적 관찰(`buzz/`)"을 가리키던 과거 표기이니 아래처럼 치환해서 읽는다.

---

## 0. 목적 정의

**분야 상관없이** 지금 한국에서, 그리고 글로벌에서 가장 화제인 토픽 **Top 10을 각각** 매일 아침
텔레그램으로 리포트한다. 사용자는 타깃을 등록하지 않는다 — 시스템이 스스로 찾는다.

이 레포의 세 모듈은 목적이 서로 다르다. 혼동 금지(리포트 타이틀 기준 — §0.2):

| | trendLeading (src/) | 타깃 추적 관찰 (buzz/) | **hot10 (hot10/) = buzzAnalysis** |
|---|---|---|---|
| 질문 | "오늘 뭘 쓰면 블로그 유입이 생기나?" | "내 타깃이 지금 어떤 상태인가?" | **"지금 세상에서 뭐가 제일 화제인가?"** |
| 분야 | F&B 한정 | 사용자 지정 타깃 | **분야 무관 (연예/스포츠/정치/테크/사회/…)** |
| 방식 | 발굴 + 검색유입 랭킹 | 추적 + 4대 지표 | **발굴 + 교차 소스 랭킹** |
| 산출물 | 황금 소재 리포트 | 타깃별 버즈 리포트 | **KR Top 10 + Global Top 10** |
| 리포트 타이틀 | 🔍 블로그 소재 리포트 | 🔍 타깃 추적 관찰 | **🔥 buzzAnalysis 화제성 Top10** |

### 0.2 이름 체계 정리 (v3 — CLAUDE.md와 동일)

사용자 지정(2026-07-14): "buzzAnalysis"라는 이름은 원래 타깃 추적 모듈(`buzz/`)에 붙였었지만,
실제로는 이 hot10 모듈(분야 무관 자동발굴 Top10)의 컨셉에 더 맞는 이름이라 **hot10이 물려받는다**.
타깃 추적 모듈은 "타깃 추적 관찰"로 리포트 타이틀만 변경(디렉토리·DB 경로는 `buzz/`·
`data/buzz.db` 그대로). 이 문서 본문에서 "buzzAnalysis"를 언급하는 곳은 **hot10 자신**을
가리키는 것으로 읽는다(§5 리포트 포맷에 최종 타이틀 반영).

### 0.1 v2 개정 사항 (스폰서 지시 3건 — 구현 시 반드시 반영)

1. **한국 대중 여론 소스 보강**: 구글/위키만으로는 한국 여론이 안 잡힌다. 네이버 뉴스 랭킹을
   옵션에서 **기본 on 주력**으로 승격하고, **대형 커뮤니티 트렌딩(크롤링)을 최소 1개 이상** 추가한다. → §2.1
2. **플랫폼 규모 기반 가중치 레이어**: 단순 동시 출현 보너스만으로는 부족. 소스별
   **reach(도달 규모) × fidelity(신호 충실도)** 2계수 가중치 레이어를 명시적으로 설계한다. → §4.1
3. **수집·리포트 분리 + 누적 데이터셋**: 리포트(LLM 호출)는 하루 1~2회여도, **raw 수집은 하루
   4회 크론으로 주기 실행**해 누적 데이터셋을 만들고, 이를 기반으로 당일 지속성·연속성(N일째)을
   계산한다. → §2.2, §4.3

### 핵심 설계 사상 — 교차 검증 랭킹

단일 소스의 순위는 그 플랫폼의 편향(구글=검색, 레딧=커뮤니티, 위키=사후 관심, 커뮤니티=특정
성향)을 그대로 반영한다. **여러 독립 소스에 동시에 등장하는 토픽일수록 "진짜 화제"**다. 따라서
소스별 순위를 수집한 뒤 같은 토픽을 병합(클러스터링)하고, **어떤 규모의 플랫폼에서(§4.1) 몇 개
소스에 걸쳐(§4.2) 하루 중 얼마나 지속적으로(§4.3) 등장했는가**로 최종 랭킹한다.

---

## 1. 격리 원칙 (타깃 추적 관찰 `buzz/`의 격리 패턴 §1 그대로 상속 — 협상 불가)

1. **디렉토리 격리**: 모든 신규 코드는 레포 루트의 **`hot10/`** 아래에만. `src/`·`buzz/` **import 금지**.
   필요한 유틸(텔레그램 전송, Gemini 호출)은 `hot10/lib/`에 **독립 구현(복사)** — buzz/lib의
   telegram.js·gemini.js를 복사해 로그 접두만 `[hot10:...]`로 바꾸면 된다.
2. **DB 격리**: 전용 파일 **`data/hot10.db`**. trend.db·buzz.db는 읽기조차 금지.
3. **워크플로 격리**: 전용 워크플로 2개(**`hot10-collect.yml`**, **`hot10-report.yml`** — §2.2).
   기존 워크플로 수정 금지.
4. **실행 시간 분리**: trendLeading KST 04:00, 타깃 추적 관찰(`buzz/`) KST 07:00과 겹치지 않게
   배치(§2.2 표). Gemini 호출이 있는 리포트 실행은 buzz와 30분 이상 간격 유지.
5. **환경변수**: 기존 키(GEMINI_API_KEY~_5, TELEGRAM_*)는 읽기 공유. hot10 전용 신규 변수는
   **`HOT10_` 접두사** (예: `HOT10_TELEGRAM_CHAT_ID` — 미설정 시 TELEGRAM_CHAT_ID 폴백).
   **신규 GitHub Secrets 등록 불필요.**
6. **기존 파일 수정 허용 범위**: `package.json` 스크립트(`hot10`, `hot10:collect`, `hot10:test`),
   `.env.example` hot10 섹션, `CLAUDE.md` 한 단락, `.gitignore`의 `!data/hot10.db`. 그 외 금지.
7. **DB 커밋 경합 대비**: 커밋 스텝은 `git pull --rebase origin main` 후 push, 실패 시 3회 재시도
   (buzz-analysis.yml의 커밋 스텝을 그대로 복사). **수집 워크플로가 하루 4회 커밋**하므로 이
   재시도 로직은 hot10에서 특히 중요하다.
8. **스타일 계약 상속**: DB snake_case / JS camelCase, 한국어 주석, `[hot10:모듈명]` 로그 접두,
   한국어 커밋 메시지, `.env`·테스트 산물 DB 커밋 금지.
9. **부분 실패 격리**: 소스 하나가 죽어도 나머지 소스로 리포트를 만든다. 죽은 소스는 리포트
   하단에 `⚠️ (소스명) 수집 실패` 각주로 표기. **테스트 목업은 전용 가짜 데이터로만** —
   buzz에서 확립한 `__test-` 격리 패턴을 처음부터 적용한다.

---

## 2. 전체 아키텍처

### 2.0 파이프라인 (수집과 리포트를 분리 — v2 §0.1-3)

```
hot10/index.js (CLI: collect | report | run | test)
  ├─ collect  →  hot10/pipeline.js runCollect()          # 하루 4회, LLM 0콜
  │     STEP C1  수집(KR)      hot10/sources-kr.js        (구글트렌드 KR + 위키 KO + 네이버 뉴스 랭킹 + 커뮤니티)
  │     STEP C2  수집(Global)  hot10/sources-global.js    (구글트렌드 US + 레딧 + 위키 EN + HN)
  │     → hot10_raw에 누적(당일 라운드 병합: best_rank/seen_count 갱신)
  │
  └─ report   →  hot10/pipeline.js runReport()           # 하루 1회(아침), LLM 2콜
        STEP R0  당일 수집분 보강     runCollect() 1회 포함 (아침 최신 데이터 확보)
        STEP R1  정규화·병합         hot10/normalizer.js  (Gemini — 동일 토픽 클러스터링 + 카테고리 + 1줄 요약)
        STEP R2  랭킹               hot10/ranker.js       (가중치 레이어 × 교차 × 지속성 → 리전별 Top 10)
        STEP R3  연속성 판정         hot10/ranker.js       (누적 데이터셋 기반 NEW/↑↓/N일째)
        STEP R4  리포트 발송         hot10/reporter.js     (텔레그램 "buzzAnalysis 화제성 Top10")

run = collect + report (수동 전체 실행용). 공통: hot10/db.js, hot10/config.js, hot10/lib/*
```

### 2.1 데이터 소스 (전부 무료 — v2에서 한국 여론 소스 보강)

| 리전 | 소스 | source 코드 | 접근 방법 | 기본 | 비고 |
|---|---|---|---|---|---|
| KR | **구글 트렌드 급상승 검색어** | `gtrends` | RSS `trends.google.com/trending/rss?geo=KR` (무키) | **on** | 실시간 검색 급상승. 비공식 피드 → fail-open |
| KR | **네이버 뉴스 많이 본 뉴스 랭킹** | `naver_rank` | `news.naver.com/main/ranking/popularDay.naver` HTML 크롤링 (무키) | **on (v2 승격)** | 국내 최대 포털의 대중 클릭 여론. 마크업 변경 취약 → 파서 분리 + fail-open |
| KR | **커뮤니티 트렌딩 — 더쿠 HOT** | `theqoo` | `theqoo.net/hot` HTML 크롤링 (무키) | **on (v2 신설)** | 대형 커뮤니티 실시간 화제글 제목. 연예/이슈 여론 강함 |
| KR | 커뮤니티 트렌딩 — 네이트판 톡커들의 선택 | `natepann` | `pann.nate.com` 랭킹 HTML 크롤링 | off (`HOT10_NATEPANN_ENABLED`) | 보조 커뮤니티. 더쿠 크롤링이 막히면 대체재로 승격 |
| KR | **위키피디아 한국어판 최다 조회** | `wiki` | Wikimedia REST pageviews/top (무키, 공식) | **on** | 전일 데이터(1일 지연). 메인페이지·`특수:`·`위키백과:` 제외 |
| Global | **구글 트렌드 급상승 검색어 (US)** | `gtrends` | RSS `?geo=US` (무키) | **on** | 글로벌 프록시. 리전 추가는 스폰서 결정 |
| Global | **Reddit r/all 일간 톱** | `reddit` | `reddit.com/r/all/top.json?t=day&limit=30` (무키) | **on** | User-Agent 헤더 필수(없으면 429) |
| Global | **위키피디아 영어판 최다 조회** | `wiki` | Wikimedia REST (en.wikipedia) | **on** | 전일 데이터 |
| Global | Hacker News 톱 | `hn` | Firebase API (무키) | **on** | 테크 편향 — 낮은 가중치(§4.1)로만 반영 |
| 양쪽 | YouTube 인기 급상승 | `youtube` | Data API mostPopular | off | 무료지만 신규 키 필요 — 스폰서 결정 |

- 크롤링 소스(naver_rank/theqoo/natepann) 공통 규칙: 브라우저형 User-Agent, 요청 간 1~3초 지연,
  **읽기 1페이지만**(랭킹/핫 목록 1회 GET — 과도한 크롤링 금지), 실패 시 빈 배열(fail-open).
  파싱(cheerio)과 페치를 분리해 파서는 목업 HTML로 단위 검증한다. 신규 의존성 금지(cheerio 기존 보유).
- **소스 2개 이상 살아있으면 리포트 발송.** X·Instagram 트렌드는 무료 접근 불가 — 도입하지 않는다.

### 2.2 실행 스케줄 (v2 — 수집·리포트 분리)

| 워크플로 | cron (UTC) | KST | 하는 일 | LLM |
|---|---|---|---|---|
| `hot10-collect.yml` | `0 3,9,15,21 * * *` | **12:00 / 18:00 / 24:00 / 06:00** | `node hot10/index.js collect` — raw 수집·누적 + DB 커밋 | 0콜 |
| `hot10-report.yml` | `30 22 * * *` | **07:30** | `node hot10/index.js report` — 수집 1회 보강 + 정규화·랭킹·리포트 + DB 커밋 | 2콜 |

- 수집 4회로 하루의 화제 변화를 스냅샷으로 누적 — 아침 리포트가 "지금 이 순간"이 아니라
  **"지난 24시간 동안 꾸준히 화제였던 것"**을 잡는다. 반짝 1회 노출과 종일 지속 이슈가 구분됨(§4.3).
- 리포트는 기본 아침 1회. 저녁 리포트가 필요해지면 `hot10-report.yml`에 cron 한 줄
  (`30 10 * * *` = KST 19:30) 추가만으로 확장 가능(LLM +2콜) — 스폰서 요청 시.
- 기존 배치와 충돌 없음: trend 04:00 / buzz 07:00 / hot10 수집 06:00·12:00·18:00·24:00 / hot10 리포트 07:30.

### API 예산

- 소스 수집: HTTP GET 8~9콜 × 4회 = ~36콜/일 (전부 무료·무키·자체 서버 아님)
- Gemini: **리포트 실행당 2콜(리전당 1콜)** = 기본 2콜/일. buzz(~15콜)·본체와 합쳐도 무료 티어 여유.
- GitHub Actions: 수집 4회 × ~2분 + 리포트 1회 × ~5분 ≈ 13분/일 — 무료 한도(공개 레포 무제한) 문제없음.

---

## 3. 데이터 모델 (data/hot10.db)

```sql
-- 소스별 원시 수집 — 하루 4회 라운드를 누적 병합하는 데이터셋 (v2 §0.1-3의 핵심)
CREATE TABLE IF NOT EXISTS hot10_raw (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  region TEXT NOT NULL,            -- kr | global
  source TEXT NOT NULL,            -- gtrends | wiki | reddit | hn | naver_rank | theqoo | natepann | youtube
  title TEXT NOT NULL,             -- 소스가 준 원문 제목/검색어
  best_rank INTEGER NOT NULL,      -- 당일 관측된 최고 순위 (숫자 최소값)
  traffic_hint TEXT,               -- 규모 힌트 (검색량/조회수/업보트 등 소스 제공값)
  url TEXT,                        -- 대표 링크
  collected_date TEXT NOT NULL,    -- YYYY-MM-DD (KST 기준)
  first_seen_at TEXT NOT NULL,     -- 당일 최초 관측 시각 (ISO)
  last_seen_at TEXT NOT NULL,      -- 당일 마지막 관측 시각
  seen_count INTEGER DEFAULT 1,    -- 당일 몇 번의 수집 라운드에서 관측됐나 (1~4, 지속성 지표)
  UNIQUE(region, source, collected_date, title)
);
-- 수집 라운드 병합 규칙: ON CONFLICT 시 best_rank=min(기존,신규), seen_count+=1, last_seen_at 갱신.
-- 같은 라운드 재실행(수동 dispatch)이 seen_count를 부풀리지 않도록, 라운드 식별자(collected_at의
-- 시각을 6시간 버킷으로 절사)를 비교해 같은 버킷이면 seen_count를 올리지 않는다.

-- 최종 랭킹 (리포트·연속성 판정의 원천 — 영구 보존)
CREATE TABLE IF NOT EXISTS hot10_topics (
  region TEXT NOT NULL,
  date TEXT NOT NULL,
  rank INTEGER NOT NULL,           -- 1~10
  topic TEXT NOT NULL,             -- 정규화된 대표 토픽명 (한국어 통일, 원어 병기)
  category TEXT,                   -- 연예 | 스포츠 | 정치사회 | 경제 | 테크 | 문화 | 사건사고 | 기타
  reason TEXT,                     -- 왜 화제인지 1줄 (LLM)
  sources TEXT DEFAULT '[]',       -- JSON: [{"source":"gtrends","rank":3,"seenCount":4}, ...]
  score REAL,                      -- 최종 스코어
  url TEXT,                        -- 대표 링크 1개
  PRIMARY KEY (region, date, rank)
);

-- 연속성 보조 — Top10 밖이어도 raw에 관측된 토픽의 일별 이력 (N일째 정확도용, v2)
CREATE TABLE IF NOT EXISTS hot10_topic_history (
  region TEXT NOT NULL,
  topic_key TEXT NOT NULL,         -- 정규화 키 (trim/lowercase/공백정리)
  date TEXT NOT NULL,
  in_top10 INTEGER DEFAULT 0,      -- 그날 Top10 진입 여부
  PRIMARY KEY (region, topic_key, date)
);
```

**필드명 계약**: DB snake_case → JS camelCase 매핑은 `hot10/db.js` 한 곳에서만 (buzz/db.js 패턴).

---

## 4. 랭킹 공식 (ranker.js — 3개 레이어. 초기값이며, 실데이터 분포 확인 전 임의 조정 금지)

### 4.1 레이어 1 — 플랫폼 규모 가중치 W (v2 §0.1-2의 핵심)

단순 "소스 수 세기"가 아니라, **그 소스가 대변하는 모집단의 크기(reach)와 화제성 신호의
충실도(fidelity)**를 분리해 정의한다. 두 계수는 `hot10/config.js`의 `sourceWeights`에
**명시적으로 분리 기재**한다(합성값만 적으면 나중에 근거를 잃는다 — 신규 소스 추가 시 두 계수를
각각 판단해 슬롯인).

```
W(source) = reach × fidelity
```

| source | reach (도달 규모) | fidelity (신호 충실도) | W | 근거 |
|---|---|---|---|---|
| gtrends (KR/US) | 1.0 — 전 국민/전 세계 검색 | 1.0 — 실시간 급상승 그 자체 | **1.00** | 기준점 |
| naver_rank | 1.0 — 국내 최대 포털 | 0.9 — 당일 클릭 집계(뉴스 한정) | **0.90** | 한국 대중 여론 대표 |
| reddit | 0.9 — 글로벌 최대 커뮤니티 | 0.9 — 당일 업보트 | **0.81** | |
| youtube (옵션) | 0.8 | 0.8 — 알고리즘 개입 있음 | 0.64 | |
| wiki (KO/EN) | 0.7 — 넓지만 능동적 조회층 | 0.7 — 1일 지연 + 사후적 관심 | **0.49** | |
| theqoo | 0.5 — 대형이나 특정 성향 | 0.8 — 실시간 핫글 | **0.40** | 여론 조기 감지 보조 |
| natepann (옵션) | 0.4 | 0.8 | 0.32 | |
| hn | 0.3 — 테크 커뮤니티 한정 | 0.8 | **0.24** | |

### 4.2 레이어 2 — 소스 내 순위 + 교차 등장

```
P(rank) = (N + 1 - rank) / N          # N = 그 소스의 당일 수집 개수, best_rank 사용. 1위=1.0
base = Σ_등장소스 W(source) × P(best_rank)
cross = 1 + 0.3 × (등장 소스 수 - 1)   # 2소스 ×1.3, 3소스 ×1.6 — 교차 검증 보너스
```

### 4.3 레이어 3 — 당일 지속성 (v2 §0.1-3: 누적 수집이 만드는 지표)

```
persistence = 1 + 0.1 × min(max_seen_count - 1, 3)   # 소스들 중 최대 seen_count 기준. 최대 ×1.3
```
- 하루 4회 수집 중 여러 라운드에서 계속 관측된 토픽(종일 이슈)이 반짝 1회 노출을 이긴다.

```
topicScore = base × cross × persistence
```
- 동점이면 W 높은 소스의 best_rank 빠른 쪽 우선. 리전별 상위 10개 컷.
- 모든 계수(reach/fidelity/0.3/0.1/캡)는 `hot10/config.js`에만 정의. 하드코딩·이중 정의 금지(본체 §4 교훈).

### 4.4 연속성 판정 (누적 데이터셋 기반 — v2)

- 리포트 확정 시 Top10 토픽뿐 아니라 **정규화된 전체 토픽을 `hot10_topic_history`에 기록**
  (in_top10 플래그로 구분).
- **NEW 뱃지**: 오늘 Top 10 진입 && 직전 7일 history에 없던 토픽.
- **N일째**: history에서 topic_key의 연속 관측일 수 — Top10 밖에서 잠복하다 진입해도 정확한
  일수가 나온다(예: 이틀간 raw에만 보이다 3일째 Top10 진입 → "3일째").
- **순위 변동**: 어제 Top10과 비교해 ↑n / ↓n / - 표시. 3일 이상 연속 Top10은 "(N일째)" 접미.
- topic_key 매칭: trim/lowercase/공백 정규화 완전일치 + 핵심 토큰 겹침(변형 표기 흡수).

---

## 5. 리포트 포맷 (텔레그램, KST 07:30)

```
🔥 buzzAnalysis 화제성 Top10 — 07/14(화)

🇰🇷 한국
━━━━━━━━━━━━━━━━━━━━━━
1. 🆕 (토픽명)  [연예]
   └ (왜 화제인지 1줄)  · 구글 2위 + 네이버뉴스 1위 + 더쿠
2. ↑3 (토픽명)  [스포츠] (3일째)
   └ ...
...

🌏 글로벌
━━━━━━━━━━━━━━━━━━━━━━
1. 🆕 (토픽명)  [테크]
   └ ...
...

⚠️ 더쿠 수집 실패 (오늘 한국 랭킹에 미반영)   ← 부분 실패 시에만
```

- 글로벌 토픽명은 **한국어 번역 + 원어 병기**("타이푼 라가사(Typhoon Ragasa)") — STEP R1 프롬프트에서 처리.
- 출처 뱃지는 W 상위 소스 최대 3개까지만 표기(가독성). 항목당 최대 2줄.
- 4096자 초과 시 리전 경계에서 분할(hot10/lib/telegram.js).

---

## 6. 기능단위 수직 슬라이스 (구현 순서 — 각 슬라이스가 끝나면 그대로 배포 가능)

타깃 추적 관찰(`buzz/`)에서 검증된 진행 방식 그대로: 슬라이스마다 수집→저장→리포트 반영을 관통,
커밋 1개 이상, `node hot10/index.js test`(무키 목업) + buzz·본체 test 회귀 통과 후 다음 슬라이스로.

### HT-0. 워킹 스켈레톤 — collect/report 분리 골격 + "빈 리포트라도 도착"

- 신규: `hot10/index.js`(CLI collect/report/run/test), `hot10/pipeline.js`(runCollect/runReport 골격),
  `hot10/config.js`(sourceWeights 2계수 표 포함), `hot10/db.js`(스키마 3테이블),
  `hot10/lib/telegram.js`·`hot10/lib/gemini.js`(buzz/lib 복사, 로그 접두 변경),
  `hot10/reporter.js`(스켈레톤 메시지), `.github/workflows/hot10-collect.yml`(4회) +
  `hot10-report.yml`(07:30)
- 기존 파일: package.json 스크립트, .env.example, CLAUDE.md, .gitignore (§1-6 허용분만)
- **DoD**: report workflow_dispatch → 스켈레톤 리포트 도착. collect dispatch → 빈 수집이라도
  정상 종료 + DB 커밋. trend.db·buzz.db diff 없음(3중 격리).

### HT-1. 한국 수집 1차 — 구글트렌드 KR + 위키피디아 KO

- 신규: `hot10/sources-kr.js` — RSS 파싱(제목/traffic/뉴스링크), Wikimedia pageviews(전일,
  네임스페이스 필터, 상위 20). **페치와 파서 분리**(파서는 목업 입력으로 단위 검증).
- `hot10_raw` 누적 병합 구현: ON CONFLICT best_rank=min / seen_count 라운드 버킷 규칙(§3 주석).
- **DoD**: test — 목업 RSS/JSON 파싱 + **같은 제목 2라운드 시딩 → seen_count=2, best_rank=min
  검증 + 같은 버킷 재실행 → seen_count 불변 검증**. 실 실행에서 kr 행 적재 확인.

### HT-2. 한국 여론 소스 — 네이버 뉴스 랭킹 + 더쿠 HOT (v2 신설 슬라이스)

- `hot10/sources-kr.js` 확장: naver_rank(랭킹 페이지 1회 GET, 섹션별 상위 기사 제목 → 통합 상위 20),
  theqoo(HOT 목록 1회 GET, 글 제목 상위 20). 크롤링 공통 규칙(§2.1) 준수 — 브라우저형 UA,
  1~3초 지연, 1페이지만, fail-open.
- natepann은 코드만 준비하고 `HOT10_NATEPANN_ENABLED=false` 기본 off.
- **DoD**: test — 저장해둔 목업 HTML로 두 파서 검증(마크업 변경 시 파서만 고치면 되는 구조 확인).
  실 실행에서 naver_rank·theqoo 행 적재 + 차단(403/429) 시 빈 배열로 살아남는지 로그 확인.

### HT-3. 글로벌 수집 — 구글트렌드 US + Reddit + 위키피디아 EN + HN

- 신규: `hot10/sources-global.js` — HT-1과 같은 구조. Reddit User-Agent(`hot10-daily-report/1.0`),
  30개 요청 → 상위 20개 저장. HN topstories 상위 15개.
- **DoD**: test 목업 파서 검증 + 소스 1개 강제 실패 시나리오에서 나머지 생존 확인.

### HT-4. LLM 정규화·병합 — 소스 간 동일 토픽 클러스터링

- 신규: `hot10/normalizer.js` — 리전당 Gemini 1콜. 입력: 그 리전의 **당일 hot10_raw 누적 전체**
  (source/best_rank/seen_count/title/traffic_hint). 출력 계약(JSON 배열 강제,
  `responseMimeType:"application/json"`, temperature 0.2):
  ```json
  [{"topic":"대표 토픽명(한국어, 원어 병기)","category":"연예|스포츠|정치사회|경제|테크|문화|사건사고|기타",
    "reason":"왜 화제인지 1줄","members":[{"source":"gtrends","rank":3,"title":"원문"}],"url":"대표링크|null"}]
  ```
  - 같은 이슈의 다른 표기(검색어 "손흥민 이적" ↔ 위키 "손흥민" ↔ reddit "Son Heung-min transfer" ↔
    더쿠 "손흥민 이적설 떴다")를 한 토픽으로 병합하는 것이 이 STEP의 존재 이유.
  - **환각 방지**: members에 없는 소스 창작 금지, 병합 확신 없으면 별개 유지, reason은 입력에서
    추론 가능한 범위만.
- LLM 실패 시 fallback: 병합 없이 원시 토픽 그대로(topic=title, category=기타) — 리포트 결측보다 낫다.
- **DoD**: test MOCK 주입 경로(무키 검증). 실 실행에서 병합 사례(members 2개 이상) 존재를 로그 확인.

### HT-5. 3레이어 랭킹 — 가중치 × 교차 × 지속성 + Top 10

- 신규: `hot10/ranker.js` — §4.1~4.3 구현. 리전별 상위 10개를 `hot10_topics`에 저장
  (당일 행 DELETE 후 INSERT — 멱등). 전체 정규화 토픽을 `hot10_topic_history`에 기록.
- 리포트 반영: 순위·토픽·카테고리·reason·출처 뱃지(연속성 표시는 HT-6).
- **DoD**: test 목업 3종 — ① 단일 소스(gtrends) 1위 vs 3개 소스 중위권 → **후자 승** (교차 확인),
  ② 같은 조건에서 seen_count 4 vs 1 → **전자 승** (지속성 확인), ③ theqoo 단독 상위 vs
  naver_rank 단독 상위 → **후자 승** (규모 가중 확인). 계수가 config에서만 오는지 확인.

### HT-6. 연속성(NEW/↑↓/N일째) + 리포트 완성 + 운영

- 수정: `hot10/ranker.js`(history 기반 §4.4), `hot10/reporter.js`(§5 최종 포맷),
  `hot10/pipeline.js`(소스 실패 각주, 로그 마커 정리)
- 운영: 실패 시 텔레그램 에러 알림(hot10 명시), DB 커밋 메시지 `chore: hot10 DB update`(수집)/
  `chore: hot10 report YYYY-MM-DD`(리포트), hot10_raw 90일 경과분 주 1회 정리
  (hot10_topics·hot10_topic_history는 영구 보존 — 연속성 원천).
- 로그 마커(Actions 검증용): `[hot10:sources-kr] N건 수집(소스별 내역)`,
  `[hot10:sources-global] N건 수집`, `[hot10:normalizer] 병합 완료: N개 토픽 (병합 M건)`,
  `[hot10:ranker] KR Top10 확정`, `[hot10:reporter] 발송 완료`
- **DoD**: test — 어제 history 시딩 → NEW/↑↓/N일째 판정 검증(잠복 2일 후 진입 → "3일째" 케이스 포함).
  collect·report workflow_dispatch 실 실행 → 로그 마커 확인. 이후 수집 4회 + 리포트 1회가
  하루 자동으로 도는 것 확인으로 완료 선언.

---

## 7. 검증 절차 (모든 슬라이스 공통)

```bash
node hot10/index.js test    # 무키 목업 검증 (파서·누적병합·3레이어 스코어·연속성·포맷)
node buzz/index.js test     # buzz 회귀 — hot10 작업이 buzz를 못 건드렸는지
node index.js test          # 본체 회귀
node --check hot10/수정파일.js
git status                  # data/*.db(테스트 산물), .env가 staged면 제외
```

- 실키 검증은 GitHub Actions workflow_dispatch(`hot10-collect.yml` → `hot10-report.yml` 순)로.
- 커밋할 hot10.db는 스키마 전용 상태로 재생성 후 커밋(테스트 산물 금지 — buzz에서 확립한 절차).
- CLAUDE.md 배포 정책에 따라, 슬라이스 검증 완료분은 main 반영 + 테스트 배치 실행으로 마무리한다.

## 8. 미리 내린 의사결정 (구현 중 재논쟁 금지)

| 결정 | 이유 |
|---|---|
| `hot10/` 완전 격리, src/·buzz/ import 금지 | 사용자 요구(소스 안 꼬이게) + 검증된 격리 패턴 |
| 구글트렌드 RSS 주력 | 유일한 무키 실시간 급상승 검색어 소스. 비공식 → fail-open + 헬스 각주 |
| **네이버 뉴스 랭킹 기본 on 승격 + 더쿠 HOT 신설** | **스폰서 지시(2026-07-14): 한국 대중 여론 소스 최소 1개 이상 추가. 크롤링은 1페이지 읽기 전용 + fail-open으로 부담 최소화** |
| **가중치 = reach × fidelity 2계수 레이어** | **스폰서 지시: 단순 동시 출현이 아닌 플랫폼 규모 반영. 계수 분리 기재로 신규 소스 슬롯인 가능** |
| **수집(4회/일)·리포트(1회/일) 워크플로 분리** | **스폰서 지시: 주기 수집으로 누적 데이터셋 구축. LLM은 리포트 때만 2콜 — 지속성(§4.3)·연속성(§4.4)의 데이터 기반** |
| 위키피디아 pageviews 채택(1일 지연 감수) | 공식 API·무키·안정적. 교차 검증 보조 역할로 충분 |
| 글로벌 = US 프록시로 시작 | 리전 추가는 Gemini 콜·리포트 길이 증가 — 스폰서가 원하면 확장 |
| X·Instagram 트렌드 배제 | 무료 접근 불가(X API 유료, IG 403 이력) |
| YouTube·네이트판은 옵션(기본 off) | 신규 키 발급/추가 크롤링 — 스폰서 결정 사항 |
| 정규화·번역·요약을 LLM 1콜/리전에 통합 | 무료 티어 예산 최소화(2콜/일). 신규 NLP 의존성 금지 |
| hot10_topics·topic_history 영구 보존 | NEW/연속성 판정 원천 + 추후 "이달의 이슈" 회고 확장 여지 |

## 9. 구현자(Sonnet)에게

- 슬라이스 순서 엄수: **HT-0 → 1 → 2 → 3 → 4 → 5 → 6**. 건너뛰기·병합 금지.
- 각 슬라이스 = 커밋 1개 이상, 한국어 커밋 메시지 (예: `hot10 HT-2: 한국 여론 소스 — 네이버 뉴스 랭킹 + 더쿠 HOT`).
- 시작 전 `docs/buzz-analysis-design.md`(격리 패턴 원본)와 trendleading-dev·telegram-dev·hermes-dev
  스킬, CLAUDE.md **배포 정책**(검증 완료 → main 반영 → 테스트 배치)을 읽을 것.
  buzz 구현 커밋 이력(BZ-0~BZ-7)이 살아있는 참고 사례다.
- 테스트 목업은 반드시 `__test-` 접두 전용 데이터로 — 실 데이터 오염 금지(buzz 타깃 등록 시 교훈).
- 크롤링 소스는 상대 서버 부담 최소화 원칙(1페이지·지연·fail-open)을 절대 완화하지 마라.
- 막히면 임의 판단하지 말고 사용자에게 질문 — 특히 소스 추가/제거, 가중치 계수, 유료 전환이 걸린 지점.
