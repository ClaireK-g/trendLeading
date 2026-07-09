---
name: trendleading-dev
description: trendLeading(F&B 마이크로 트렌드 감지 파이프라인) 레포에서 코드 수정·기능 추가·버그 수정·디버깅·리팩토링 등 모든 개발 작업을 할 때 반드시 사용. 파이프라인 아키텍처, 모듈 간 필드명 계약, 과거 버그 이력, 검증 절차, 커밋 규칙을 담고 있다. Use when modifying, debugging, or extending any code in this repository (probe/scraper/extractor/scorer/alerter/db/pipeline).
---

# trendLeading 개발 스킬

이 레포에서 작업할 때 지켜야 할 사고 절차, 아키텍처 지식, 과거 버그에서 얻은 교훈을 담은 스킬.
**코드를 한 줄이라도 고치기 전에 이 문서의 해당 섹션을 먼저 확인하라.**

## 0. 작업 원칙 (가장 중요)

1. **수정 전에 호출 체인을 끝까지 읽어라.** 이 레포의 대형 버그(스코어 0.0)는 db.js가 반환하는 필드명(`mention_count`)과 scorer.js가 읽는 필드명(`mentions`)이 달라서 생겼다. 함수 하나를 고칠 때 그 함수의 **호출자와 피호출자 양쪽**의 필드명·반환 형태를 반드시 확인한다.
2. **수치(임계값·가중치·스코어)를 바꾸기 전에 실제 값 범위를 확인하라.** trendScore는 이론상 0~15 범위지만 실데이터에서는 대부분 0~6이다. 임계값 제안 전에 `node index.js test`나 실제 DB로 분포를 확인한다. 참고: 과거에 shouldAlert 임계값을 완화했다가 사용자가 revert한 이력이 있다(#10 → 20e2be8). **알림 임계값 변경은 사용자에게 먼저 물어라.**
3. **커밋 전 반드시 `node index.js test`를 실행하라.** API 키 없이도 목업 데이터로 스코어링 파이프라인 전체가 검증된다. 이것이 이 레포의 유일한 자동 검증 수단이다(별도 테스트 프레임워크 없음).
4. **작은 diff.** 요청받은 것만 고친다. 주변 코드 스타일(한국어 주석, `[모듈명]` 접두 console.log, camelCase JS + snake_case DB)을 그대로 따른다.
5. **커밋 메시지는 한국어**로, 기존 스타일을 따른다. 예: `스코어 0.0 버그 수정 + 알림 가독성 개선`, `다이제스트에 키워드 reason(맥락 설명) 추가`. 본문에 변경 항목을 `-` 리스트로.
6. **법률/비용이 걸린 의사결정(유료 API 도입, 스크래핑 정책 등)은 코드로 결정하지 말고 사용자(스폰서 지경)에게 확인**한다.

## 1. 아키텍처 맵 (6단계 파이프라인)

`pipeline.js runPipeline()`이 오케스트레이터. 순서와 담당 파일:

| STEP | 역할 | 파일 | 핵심 export |
|---|---|---|---|
| 1 | 데이터랩 탐침 — PROBE_KEYWORDS 풀의 검색량 급등 선행 감지 | `src/probe.js` | `runProbe()` |
| 2 | 수집 — 네이버 블로그/뉴스/데이터랩 주력, IG는 기본 off | `src/scraper.js` | `collectDaily()` |
| 3 | LLM 추출 — Gemini 3단계 하네스 | `src/extractor.js` | `processBatch(posts)` |
| 4 | 데이터랩 역검증 — 추출 키워드 검색량 확인 | `src/probe.js` | `verifyWithDatalab(keywords)` |
| 5 | 스코어링 — Burst Detection + L1~L4 레벨 | `src/scorer.js` | `rankAllKeywords()`, `detectBursts()`, `shouldAlert()` |
| 6 | 알림 — 텔레그램 다이제스트 | `src/alerter.js` | `sendAlert()`, `sendDailyDigest()` |

공통: `src/db.js`(better-sqlite3, `data/trend.db`), `src/config.js`(env→설정), `src/blacklist.js`, `src/trend-intel.js`(구글뉴스 RSS + 네이버뉴스 헤드라인 → Synthesizer 프롬프트에 주입).

- 탐침 급등 키워드는 `upsertDailyStats(kw, today, 'datalab_probe', [])`로 DB에 누적된다 (트렌드 레벨 산정용).
- STEP 1·4 실패는 `try/catch`로 **무시하고 계속 진행**한다. 새 STEP을 추가할 때도 부분 실패가 전체를 죽이지 않게 하라.
- CLI 진입점은 `index.js` (`run`/`score`/`digest`/`blacklist`/`cron`/`test`).

## 2. LLM 추출 하네스 (Generator→Critic→Synthesizer)

`extractor.js processBatch()`의 3단계 구조. 프롬프트를 수정할 때 이 계약을 깨지 마라:

1. **Generator** (`buildSystemPrompt`): 배치(BATCH_SIZE=30)별로 키워드 추출. temperature 0.2. `confidence_score` 3 이상만.
2. **Critic** (`buildCriticPrompt`): 통계적 착시·기존 유행 변형·추상성 비판. 출력은 `{keyword, verdict: PASS|WARN|REJECT, critique, weaknesses}`. REJECT는 무조건 제거된다.
3. **Synthesizer** (`buildSynthesizerPrompt`): 뉴스 헤드라인(trend-intel) 컨텍스트와 함께 최종 정제. WARN 생존 키워드는 confidence -1. 실패 시 Generator 출력으로 fallback.

**모든 프롬프트는 "JSON 배열만 출력, 없으면 []"을 강제**하고 `responseMimeType: "application/json"`을 쓴다. 프롬프트를 고쳐도 출력 스키마 필드(`keyword, category, region, reason, confidence_score, co_keywords, freshness_signal, validation_note`)를 바꾸면 db.js `insertExtractedKeywords`와 index.js MOCK_KEYWORDS도 같이 바꿔야 한다.

**Gemini 무료 티어 제약** (건드릴 때 주의):
- 모델 폴백 체인: `gemini-2.5-flash` → `gemini-3.5-flash` → `gemini-2.5-flash-lite` (GEMINI_MODELS 순서).
- 429(rate limit)→15초 대기 재시도, 503(overload)→즉시 다음 모델. 배치 간 `sleep(2000)`.
- 복수 API 키 로테이션(`getNextApiKey()`): GEMINI_API_KEY, GEMINI_API_KEY_2 라운드로빈.
- 호출 횟수를 늘리는 변경(배치 축소, 단계 추가)은 RPM 한도 초과 위험 — 먼저 호출 수를 계산해 보라.

**트렌드 시간 기준: 2~3일.** 월/연 단위 아님. 프롬프트의 신선도 기준을 완화하는 변경은 프로젝트 정체성 훼손 — 하지 마라.

## 3. 필드명 계약 (버그 다발 지점 — 반드시 확인)

DB는 snake_case, JS 레이어는 camelCase. **경계는 `db.js getKeywordStats()`의 매핑 레이어**다:

```
DB 컬럼              → getKeywordStats() 반환 객체 (scorer가 소비)
mention_count        → mentions (mention_count도 중복 제공)
unique_accounts      → uniqueAccounts (unique_accounts도 중복 제공)
co_keywords (JSON)   → coKeywords (파싱된 배열)
(계산)               → daysAgo (오늘 자정 기준, 오늘=0)
(계산)               → confidenceScore (mention_count>0 ? 4 : 0 — 근사치임)
```

- scorer.js는 `d.mentions`, `d.uniqueAccounts`, `d.coKeywords`, `d.daysAgo`, `d.confidenceScore`를 읽는다. **db.js 반환 형태를 바꾸면 scorer.js가 조용히 0을 계산한다** (과거 버그 d54b9b6).
- 키워드는 DB 저장 시 `trim().toLowerCase()` 정규화. 조회할 때도 동일 정규화 필수.
- `getAllRecentKeywords()`는 extracted_keywords를 LEFT JOIN해 `category`, `reason`을 함께 반환 (다이제스트의 `└ reason` 줄에 사용).
- pipeline↔scraper 경계: post 객체는 `commentsText`/`comments_text`, `sourceUrl`/`source_url` 양쪽 케이스를 모두 허용하도록 `??`로 처리되어 있다. 새 소스 추가 시 `account, caption, source` 필드는 필수.

## 4. 스코어링 공식 (scorer.js — 숫자 바꾸기 전에 읽어라)

```
trendScore = burstRatio*0.4 + spreadScore*10*0.25 + acceleration*0.2 + min(coOccurrenceRichness,10)*0.15
```
- burstRatio: 최근 7일 합 ÷ 이전 28일 주평균. 이전 데이터 0이면 (최근 7일 > 3 ? 10 : 0).
- spreadScore: 최근 7일 uniqueAccounts ÷ mentions, 최대 1.
- acceleration: 최근 3일 평균 ÷ 최근 7일 평균.
- verdict: >5 🔥급상승, >2.5 📈주목, 그 외 📊관찰.
- 트렌드 레벨: L1(활동3일+·기간7일+) ~ L4(활동10일+·기간28일+), 미달이면 ⚪관찰중.
- `shouldAlert`: maxConfidence≥4 AND uniqueAccounts3일≥5 AND trendScore≥3.0 AND 72시간 쿨다운. **이 값들은 config.scoring에도 중복 정의되어 있으나 scorer.js에 하드코딩된 쪽이 실제 동작이다** — 값을 바꿀 땐 양쪽을 맞춰라.
- 랭킹은 상위 30개 컷 (`rankAllKeywords`).

## 5. 외부 API 제약 요약

- **네이버 데이터랩**: 1요청 keywordGroups 최대 5개. 각 그룹 수치는 **상대값**이므로 그룹 간 절대 비교 불가 — probe.js는 이 한계를 감수하고 5개씩 배치 호출 중. 검색/데이터랩은 **별도 앱 키**(NAVER_SEARCH_* vs NAVER_DATALAB_*).
- **Instagram**: Picuki/Imginn 403 차단 이력 → `INSTAGRAM_ENABLED=false`로 격리됨. IG 관련 수정 요청이 와도 메인 파이프라인에 의존성을 만들지 마라.
- **텔레그램**: 봇 @TrSetterBot. 다이제스트에 heat indicator 🔴🟠🟡🟢⚪와 `└ reason` 줄 포맷 유지.

## 6. 검증 절차 (커밋 전 필수)

```bash
node index.js test    # API 키 없으면 목업 스코어링 검증, 있으면 LLM 포함 전체 검증
node index.js score   # 기존 DB로 스코어링만 재실행
node --check src/수정한파일.js   # 문법 확인 (빠른 1차 체크)
```
- `test`는 TEST_POSTS에 의도적 함정(TRAP: 구식/대중화/계절반복)과 진짜(REAL) 케이스가 섞여 있다. 프롬프트를 수정했다면 TRAP이 걸러지고 REAL이 살아남는지 출력을 눈으로 확인하라.
- 테스트 실행은 로컬 `data/trend.db`에 목업 데이터를 남긴다. **`data/trend.db` 변경분은 커밋하지 마라** — 이 파일은 GitHub Actions가 매일 `chore: daily DB update` 커밋으로만 갱신한다. 커밋 전 `git status`에서 trend.db가 staged면 제외할 것.
- DB 직접 확인: `node -e "const D=require('better-sqlite3');const d=new D('data/trend.db');console.log(d.prepare('SELECT * FROM keyword_daily_stats ORDER BY date DESC LIMIT 20').all())"`

## 7. GitHub Actions / 운영

- `trend-pipeline.yml`: cron `0 19 * * *` = **KST 04:00** (Actions 지연 감안해 05:00에서 앞당김 — CLAUDE.md의 "05:00/0 20"은 구버전 표기이니 workflow 파일이 진실). 실패해도 `if: always()`로 DB 커밋. 실패 시 텔레그램 에러 알림.
- `keepalive.yml`: 매주 월요일 빈 커밋으로 60일 비활성 방지.
- 시크릿 추가가 필요한 변경이면 사용자가 GitHub Secrets에 등록해야 함을 알려라. `.env`는 절대 커밋 금지.

## 8. 의사결정 히스토리 (다시 논쟁하지 말 것)

| 결정 | 이유 |
|---|---|
| 네이버 주력, Instagram 격리 | Picuki/Imginn 403 차단. IG는 옵션(기본 off) |
| Gemini 무료 티어 + BATCH_SIZE=30 | RPM 한도 내 운영. 유료 전환은 스폰서 결정 사항 |
| DB를 레포에 git 커밋 | 무료 영속성. 외부 스토리지 도입하지 않기로 함 |
| 배치 KST 04:00 | Actions cron 지연 감안 (d386750) |
| shouldAlert 임계값 유지 | 완화 시도했다가 revert됨 (20e2be8). 변경은 사용자 승인 필요 |
| Generator→Critic→Synthesizer 하네스 | 단일 프롬프트 대비 허위 트렌드(통계 착시) 감소 (80ba9fd) |

## 9. 작업 마무리 체크리스트

- [ ] `node index.js test` 통과 및 출력 육안 확인
- [ ] 모듈 경계(필드명) 양쪽 다 수정했는가
- [ ] config.js와 하드코딩 값이 어긋나지 않는가
- [ ] `data/trend.db`, `.env`가 diff에 없는가
- [ ] 한국어 커밋 메시지, 기존 로그 스타일(`[모듈명]` 접두) 유지
- [ ] 프롬프트/스키마 변경 시 CLAUDE.md·MOCK_KEYWORDS·db insert 동기화

## 관련 문서·스킬

- **blog-traffic-dev 스킬** (`.claude/skills/blog-traffic-dev/SKILL.md`) — 이 파이프라인의 진짜 목표(블로그 방문자 유입)와 황금 키워드 공식, 검색가능형 키워드 규칙. **키워드 추출·스코어링·다이제스트를 만질 때 반드시 함께 적용.**
- **재설계 설계서** (`docs/redesign-blog-traffic.md`) — 블로그 소재 발굴 파이프라인으로의 전환 계획 (Phase 0~4). 실행 시 Phase 순서 엄수.

## 관련 프로젝트

**techLeading** (github.com/ClaireK-g/techLeading) — 동일 구조의 기술 트렌드 감지(HN/PH 주력). 여기서 고친 구조적 버그는 techLeading에도 있을 가능성이 높다 — 발견 시 사용자에게 알려라.
