# trendLeading — F&B 마이크로 트렌드 감지 파이프라인

## 프로젝트 개요
네이버 데이터랩/블로그/뉴스에서 F&B(음식/디저트/맛집) 마이크로 트렌드를 자동 감지하여 텔레그램으로 알림하는 100% 무료 파이프라인.

## 아키텍처 (6단계 파이프라인)
1. **데이터랩 탐침** (probe.js) — 세부 키워드 검색량 급등 스캔 (선행 지표)
2. **수집** (scraper.js) — 네이버 블로그/뉴스/데이터랩 주력, X 보조, Instagram 옵션(기본 off)
3. **LLM 추출** (extractor.js) — Gemini 2.5 Flash로 키워드 추출 + 2차 검증
4. **데이터랩 역검증** (probe.js) — 추출 키워드의 실제 검색량 확인
5. **스코어링** (scorer.js) — Burst Detection + L1~L4 트렌드 레벨
6. **알림** (alerter.js) — 텔레그램 일일 리포트

## 핵심 기술 결정
- **네이버 주력, Instagram 격리**: Picuki/Imginn 403 차단 → 네이버 공식 API로 전환. IG는 `INSTAGRAM_ENABLED=false` 격리.
- **Gemini 무료 티어**: BATCH_SIZE=30 (5배치)으로 RPM 한도 내 운영. 복수 Google 계정 키 로테이션 지원.
- **DB 영속성**: GitHub Actions에서 매일 `data/trend.db`를 레포에 git commit+push.
- **트렌드 시간 기준**: 월/연 단위 아님. 2~3일 기준. 트렌드는 하루가 다름.

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
GEMINI_API_KEY_2=       # 2번째 Google 계정 키 (로테이션용)
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

## 관련 프로젝트
- **techLeading** (github.com/ClaireK-g/techLeading) — 기술 트렌드 감지 (동일 구조, HN/PH 주력)

## TF팀 역할
PM, 서비스기획자, SA, 개발자, 마케터 등 9명 가상 전문가 관점 융합. 법률/비용 의사결정은 스폰서(지경) 확인 필수.
