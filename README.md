# trendLeading -- 100% 무료 F&B 마이크로 트렌드 감지 파이프라인

인스타그램(Picuki) 게시물을 수집하고, Gemini Flash(무료)로 키워드를 추출한 뒤, 통계적 버스트 감지를 통해 급부상 트렌드를 Telegram으로 알려줍니다.

**월 비용: $0** -- 모든 구성 요소가 무료 티어로 동작합니다.

## 시스템 아키텍처

```
GitHub Actions (cron: 08:00, 17:00 KST)
         |
         v
+------------------+     +------------------+     +------------------+
|  Picuki 스크래핑  |     | Gemini Flash     |     |  Telegram Bot    |
|  (scraper.js)    |     | (extractor.js)   |     |  (alerter.js)    |
+--------+---------+     +--------+---------+     +--------+---------+
         |                        ^                        ^
         v                        |                        |
+--------+------------------------+---------+     +--------+---------+
|              db.js (SQLite)               |     |  scorer.js       |
|  raw_posts / extracted_keywords /         |---->|  버스트 감지      |
|  keyword_daily_stats / blacklist          |     |  트렌드 스코어링   |
+-------------------------------------------+     +------------------+
         ^
         |
+--------+---------+
|  pipeline.js     |  <--- index.js (CLI)
|  오케스트레이터    |
+------------------+
```

### 무료 구성 요소

| 구성 요소 | 서비스 | 무료 한도 | 실사용량 |
|-----------|--------|-----------|---------|
| 스크래핑 | Picuki (공개 웹) | 무제한 | 하루 ~200 페이지 |
| LLM 추출 | Gemini Flash (Google AI Studio) | 1,500 req/day | 하루 ~20 req |
| 데이터베이스 | SQLite (로컬 파일) | 무제한 | ~10MB |
| 알림 | Telegram Bot API | 무제한 | 하루 ~10건 |
| 스케줄링 | GitHub Actions | 2,000분/월 | ~60분/월 |

## 설치 및 설정

### 1. 의존성 설치

```bash
git clone https://github.com/your-username/trendLeading.git
cd trendLeading
npm install
```

### 2. Gemini API 키 발급 (무료)

1. [Google AI Studio](https://aistudio.google.com/) 접속
2. 구글 계정으로 로그인
3. "Get API Key" 클릭 -> "Create API key" 선택
4. 생성된 키를 복사

### 3. Telegram Bot 설정

1. Telegram에서 [@BotFather](https://t.me/BotFather)에게 `/newbot` 전송
2. 봇 이름과 username 입력
3. 발급받은 Bot Token 저장
4. 봇을 채널/그룹에 추가하고 Chat ID 확인:
   - 봇에게 아무 메시지를 보낸 뒤 `https://api.telegram.org/bot<TOKEN>/getUpdates` 접속
   - `chat.id` 값을 복사

### 4. 환경변수 설정

프로젝트 루트에 `.env` 파일을 생성합니다:

```env
GEMINI_API_KEY=AIza...
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
TELEGRAM_CHAT_ID=-100123456789
```

### 5. 시드 계정 설정

`seeds/accounts.json`에 수집 대상 인스타그램 계정을 추가합니다:

```json
["계정1", "계정2", "계정3"]
```

### 6. 데이터 디렉터리 준비

```bash
mkdir -p data
echo '[]' > data/blacklist.json
```

## 사용법

### 전체 파이프라인 실행

```bash
node index.js run
```

수집 -> 추출 -> 스코어링 -> 알림까지 전체 프로세스를 1회 실행합니다.

### 스코어링만 실행

```bash
node index.js score
```

새로운 데이터를 수집하지 않고 기존 데이터에 대해 스코어링만 다시 수행합니다.

### 일일 다이제스트 전송

```bash
node index.js digest
```

상위 키워드 랭킹을 Telegram으로 전송합니다.

### 블랙리스트 관리

```bash
# 키워드 추가
node index.js blacklist add 맞팔

# 목록 조회
node index.js blacklist list
```

### 크론 스케줄러 (로컬)

```bash
node index.js cron
```

매일 09:00, 18:00 (KST)에 파이프라인을 자동 실행합니다.

### 테스트 (API 키 없이 가능)

```bash
node index.js test
```

- GEMINI_API_KEY가 없으면: 목업 데이터로 스코어링 파이프라인을 검증합니다.
- GEMINI_API_KEY가 있으면: 샘플 포스트로 LLM 추출까지 포함한 전체 파이프라인을 테스트합니다.

## GitHub Actions 설정

### 1. Secrets 등록

GitHub 저장소 Settings > Secrets and variables > Actions에서 다음 시크릿을 추가합니다:

| Secret 이름 | 값 |
|-------------|-----|
| `GEMINI_API_KEY` | Google AI Studio에서 발급받은 API 키 |
| `TELEGRAM_BOT_TOKEN` | BotFather에서 발급받은 봇 토큰 |
| `TELEGRAM_CHAT_ID` | 알림을 받을 채팅 ID |

### 2. Workflow 활성화

저장소를 push하면 `.github/workflows/trend-pipeline.yml`이 자동으로 인식됩니다.
Actions 탭에서 워크플로우가 활성화되어 있는지 확인하세요.

- 자동 실행: 매일 오전 8시, 오후 5시 (KST)
- 수동 실행: Actions 탭 > "F&B Trend Pipeline" > "Run workflow" 클릭

### 3. DB 지속성

GitHub Actions는 매 실행마다 새로운 환경이므로, SQLite DB를 아티팩트로 업로드/다운로드하여 데이터를 유지합니다.
`data/trend.db`가 `trend-db`라는 이름의 아티팩트로 저장되며, 다음 실행 시 자동으로 복원됩니다.

## 비용 정리: 왜 $0인가

| 항목 | 비용 | 설명 |
|------|------|------|
| Gemini Flash API | $0 | 무료 티어 1,500 req/day. 하루 2회 실행, 회당 ~10 요청 = 20 req/day |
| Picuki 스크래핑 | $0 | 공개 웹사이트 HTML 파싱. API 키 불필요 |
| GitHub Actions | $0 | 퍼블릭 저장소 무제한, 프라이빗 2,000분/월 무료 |
| Telegram Bot | $0 | 완전 무료 API |
| SQLite | $0 | 로컬 파일 DB |
| **합계** | **$0/월** | |

## 트렌드 스코어링 공식

각 키워드의 트렌드 점수는 4가지 신호의 가중 합으로 계산됩니다:

```
TrendScore = BurstRatio x 0.4
           + SpreadScore x 10 x 0.25
           + Acceleration x 0.2
           + min(CoOccurrenceRichness, 10) x 0.15
```

| 지표 | 설명 | 가중치 |
|------|------|--------|
| **Burst Ratio** | 최근 7일 언급량 / 이전 28일 주간 평균. 신규 키워드는 언급 3회 초과 시 10으로 설정 | 40% |
| **Spread Score** | 고유 계정 수 / 총 언급 수. 1에 가까울수록 다양한 출처에서 언급 | 25% |
| **Acceleration** | 최근 3일 평균 / 최근 7일 평균. 1 초과 시 가속 중 | 20% |
| **Co-occurrence Richness** | 함께 언급된 고유 키워드 수. 연관 키워드가 많을수록 풍부한 트렌드 | 15% |

### 판정 기준

- 5.0 초과: 급상승 (즉시 알림)
- 2.5 ~ 5.0: 주목 (다이제스트에 포함)
- 2.5 미만: 관찰 (데이터 축적 중)

### 알림 발송 조건

모든 조건을 동시에 충족해야 합니다:
- confidence_score >= 4 (LLM 추출 신뢰도)
- 최근 3일 고유 계정 수 >= 5
- trendScore >= 3.0
- 동일 키워드 마지막 알림 후 72시간 경과

## 커스터마이징

### 시드 계정 추가

`seeds/accounts.json`을 편집합니다:

```json
["cafe_account1", "food_blogger2", "dessert_review3"]
```

F&B 관련 인플루언서, 맛집 리뷰 계정, 디저트 전문 계정을 추가하면 감지 품질이 향상됩니다.

### 블랙리스트 관리

노이즈 키워드를 제거하는 두 가지 방법:

```bash
# CLI로 추가
node index.js blacklist add "마라탕"

# 파일 직접 편집
# data/blacklist.json
["맞팔", "이벤트", "공구", "선팔", "소통", "마라탕"]
```

### 알림 채널 설정

`.env` 파일에서 Telegram 토큰을 설정합니다:

- `TELEGRAM_BOT_TOKEN`: BotFather에서 발급받은 봇 토큰
- `TELEGRAM_CHAT_ID`: 알림을 받을 채팅/채널 ID

### 스코어링 임계값 조정

`src/config.js`에서 조정합니다:

```javascript
scoring: {
  burstThreshold: 3.0,      // 버스트 감지 임계값 (낮출수록 민감)
  alertMinConfidence: 4,     // LLM 신뢰도 최소값 (1-5)
  alertMinAccounts: 5,       // 최소 고유 계정 수
  alertCooldownHours: 72,    // 동일 키워드 알림 쿨다운 (시간)
}
```

### 스크래핑 해시태그 변경

`src/config.js`의 `scraper.hashtagsToTrack` 배열을 수정합니다:

```javascript
hashtagsToTrack: ['맛집', '디저트맛집', '서울맛집', '핫플', '성수맛집'],
```

원하는 지역이나 카테고리의 해시태그를 추가/제거하세요.
