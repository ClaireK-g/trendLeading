# trendLeading — F&B 블로그 소재 발굴 파이프라인

## 프로젝트 개요
네이버 데이터랩/블로그/뉴스에서 F&B(음식/디저트/맛집) 마이크로 트렌드를 자동 감지해 **블로그 방문자
유입용 글감**으로 정제, 텔레그램으로 매일 리포트하는 100% 무료 파이프라인. 최종 판정 기준은 "트렌드가
진짜인가?"가 아니라 **"이 소재로 오늘 글을 쓰면 검색 유입이 생기는가?"** — 황금 키워드 공식(검색
수요 ÷ 콘텐츠 공급)으로 랭킹한다. 실증 사례: '언더커버 쉐프 식당'(방송發 소재) 글 조회수 급증.
자세한 도메인 지식은 `.claude/skills/blog-traffic-dev/SKILL.md` 참고.

## 아키텍처 (7단계 파이프라인)
1. **데이터랩 탐침** (probe.js) — 세부 키워드 검색량 급등 스캔 (선행 지표). 최근 7일 추출 키워드
   상위 5개를 당일 한정 동적 추가
2. **수집** (scraper.js) — 네이버 블로그/뉴스/데이터랩 주력, X 보조, Instagram 옵션(기본 off).
   크로스데이 URL 중복 제거 + 발행 3일 초과 필터 + 방송/미디어 시그널 쿼리 + 동적 쿼리
3. **LLM 추출** (extractor.js) — Gemini 2.5 Flash Generator→Critic→Synthesizer 3단계. 검색가능형
   키워드(search_keyword) 강제, 최근 7일 기추출 키워드 프롬프트 제외, content_type 분류
4. **데이터랩 역검증** (probe.js) — 추출 키워드의 실제 검색량 확인
5. **검색가능성 검증** (searchability.js) — 네이버 블로그 검색으로 실제 검색되는지 + 경쟁 문서
   수(doc_count) 측정. 검색 불가/동음이의 오염 키워드는 강등(searchable:false)
6. **스코어링** (scorer.js) — Burst Detection + L1~L4 트렌드 레벨 + opportunityScore(수요÷공급)로
   finalScore 산출
7. **알림** (alerter.js) — 텔레그램 "블로그 소재 리포트": 오늘의 황금 소재 / 관찰 중 / 검증 필요

## 핵심 기술 결정
- **네이버 주력, Instagram 격리**: Picuki/Imginn 403 차단 → 네이버 공식 API로 전환. IG는 `INSTAGRAM_ENABLED=false` 격리.
- **Gemini 무료 티어**: BATCH_SIZE=30 (5배치)으로 RPM 한도 내 운영. 최대 5개 Google 계정 키 로테이션 지원.
- **DB 영속성**: GitHub Actions에서 매일 `data/trend.db`를 레포에 git commit+push.
- **트렌드 시간 기준**: 월/연 단위 아님. 2~3일 기준. 트렌드는 하루가 다름.
- **황금 키워드 공식**: opportunityScore = burstRatio ÷ log10(경쟁 문서 수+10). 수요↑ 공급↓인 소재를
  우선 추천. `docs/redesign-blog-traffic.md`(Phase 0~4) 참고.

## 실행
```bash
node index.js run      # 전체 파이프라인
node index.js test     # 테스트 데이터
node index.js score    # 스코어링만
node index.js cron     # 로컬 크론 (05:00 KST)
```

## 환경변수 (.env)
```
GEMINI_API_KEY=         # Google AI Studio (aistudio.google.com)
GEMINI_API_KEY_2=       # 2~5번째 Google 계정 키 (로테이션용, _3/_4/_5도 지원)
NAVER_SEARCH_CLIENT_ID= # 네이버 검색 API 앱
NAVER_SEARCH_CLIENT_SECRET=
NAVER_DATALAB_CLIENT_ID= # 네이버 데이터랩 앱 (별도)
NAVER_DATALAB_CLIENT_SECRET=
TELEGRAM_BOT_TOKEN=     # @TrSetterBot
TELEGRAM_CHAT_ID=
```

## GitHub Actions
- 매일 새벽 4시 KST 자동 실행 (cron: "0 19 * * *", Actions 지연 감안해 05:00→04:00으로 앞당김)
- 실패 시 텔레그램 에러 알림
- DB를 레포에 커밋하여 영구 보관
- keepalive.yml로 60일 비활성 방지

## 타깃 추적 관찰 (buzz/ 모듈 — 구 "buzzAnalysis")
사용자가 지정한 타깃(브랜드/제품/키워드 — 예: "냉장고 털기")의 버즈량·감성·연관어·채널분포를 매일
텔레그램으로 리포트하는 **완전 격리된 별도 모듈**. 리포트 타이틀은 "🔍 타깃 추적 관찰"(제네릭 —
여러 타깃을 등록해도 이름이 어색하지 않도록). "buzzAnalysis"라는 이름은 hot10(분야 무관 자동발굴
Top10, 아래 참고)이 물려받았다 — 이 모듈과 혼동하지 말 것. `buzz/` 디렉토리에만 존재하며
`src/`를 import하지 않고, 전용 DB(`data/buzz.db`)와 전용 워크플로(`buzz-analysis.yml`, KST 07:00)를
쓴다. 실행: `node buzz/index.js run` / `test`. 타깃은 `buzz/targets.json`에 사용자가 직접 등록.
설계·구현 순서(BZ-0~BZ-7)는 `docs/buzz-analysis-design.md` 참고(문서 내 "buzzAnalysis" 표기는
과거 이름 — 리포트에는 "타깃 추적 관찰"로 나간다).

## buzzAnalysis (hot10/ 모듈 — 분야 무관 한국/글로벌 화제성 Top10, 개발 중)
사용자 타깃 등록 없이 **분야 상관없이** 한국/글로벌에서 가장 화제인 토픽 Top10을 각각 매일 자동
발굴해 텔레그램으로 리포트하는 모듈. 완성 시 리포트 타이틀은 "🔥 buzzAnalysis 화제성 Top10"
(이름을 이 모듈이 물려받음 — 위 타깃 추적 관찰 모듈과 혼동 금지). `hot10/` 디렉토리에만 존재하며
`src/`·`buzz/`를 import하지 않는 완전 격리 모듈. 구글트렌드/위키피디아/네이버 뉴스랭킹/더쿠/레딧/HN
등 교차 소스를 규모 가중치(reach×fidelity)·교차 등장·당일 지속성으로 랭킹한다. 하루 4회 raw 수집
(`hot10-collect.yml`) + 아침 1회 리포트(`hot10-report.yml`, KST 07:30)로 수집·리포트를 분리한다.
설계·구현 순서(HT-0~HT-6)는 `docs/hot10-design.md` 참고.

## 배포 정책 (병합·검증 — 항상 적용, 매번 되묻지 말 것)
작업이 로컬 검증(관련 `node .../index.js test` 통과 + 회귀 확인 + `.env`·테스트 산물 DB가 diff에
없음 확인)을 마치면, **사용자에게 다시 묻지 말고**:
1. 작업 브랜치를 **main에 병합**한다(PR 생성 후 병합, 또는 직접 병합 — 상황에 맞게 선택).
2. 병합 직후 해당 모듈의 GitHub Actions 워크플로를 **workflow_dispatch로 1회 수동 실행**해
   실키 기준 테스트 배치를 돌린다(로컬 test는 무키 목업일 뿐 실제 검증이 아님 — 각 모듈 스킬의
   "실제 파이프라인 검증은 GitHub Actions로" 원칙과 동일).
3. 실행 로그에서 실패가 없는지 확인하고 결과를 요약 보고한다. 실패 시 원인 조사 후 수정 —
   조용히 무시하지 않는다.
이 정책은 이 레포의 세 파이프라인(trendLeading 본체 `src/`, 타깃 추적 관찰 `buzz/`,
buzzAnalysis `hot10/`) 모두에 동일하게 적용된다. 단, 임계값 변경·타깃 등록·유료 API 도입 등
**사용자 판단이 필요한 결정**은 이 정책과 별개로 여전히 사용자에게 확인한다(§8/§6 의사결정
히스토리 참고).

## 작업 루프 규칙 (Loop Engineering)
1. **커밋 전 점검 필수**: `node index.js test` 통과 + `node --check 수정파일` + `git status`에서
   `data/trend.db`/`.env`가 staged 아님을 확인한 뒤에만 커밋한다 (trendleading-dev 스킬 §6·§9).
2. **루프 시작 전 예산 명시**: 반복 작업(배치 재실행, API 폴링, LLM 호출 루프, 재시도)은 시작 전에
   최대 시도 횟수·최대 실행 시간·최대 호출(토큰) 비용을 정해서 선언하고 시작한다. LLM은 총 호출 수를
   먼저 계산(hermes-dev 스킬 §2), 파이프라인은 Actions `timeout-minutes: 60`이 상한.
3. **이상 패턴 자동 중단**: 같은 오류가 3회 반복되거나, 재시도해도 진전이 없거나, 출력·호출량이
   예상 범위를 벗어나면 루프를 즉시 멈추고 원인을 보고한다 — 예산이 남았어도 계속 돌리지 않는다.
   코드 루프도 동일 원칙(재시도 상한 MAX_RETRIES=3, 모델 폴백 체인, 부분 실패 fail-open 후 로그 보고).

## 관련 프로젝트
- **techLeading** (github.com/ClaireK-g/techLeading) — 기술 트렌드 감지 (동일 구조, HN/PH 주력)

## TF팀 역할
PM, 서비스기획자, SA, 개발자, 마케터 등 9명 가상 전문가 관점 융합. 법률/비용 의사결정은 스폰서(지경) 확인 필수.
