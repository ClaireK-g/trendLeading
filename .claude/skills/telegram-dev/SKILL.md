---
name: telegram-dev
description: 이 레포에서 텔레그램으로 메시지를 보내거나 알림/다이제스트 포맷을 만들 때 사용. 4096자 메시지 길이 제한, 분할 전송 규칙, 봇 API 호출 패턴, 쿨다운(alerts_sent) 연동을 담는다. Use when sending Telegram messages, modifying alert/digest formatting, or adding new Telegram notification types anywhere in this repo — alerter.js or any new notification feature.
---

# telegram-dev — 텔레그램 알림 통합 스킬

이 레포는 텔레그램 봇(@TrSetterBot)으로 매일 트렌드 리포트와 즉시 알림을 보낸다. 텔레그램 발송
코드를 만지기 전에 이 문서를 먼저 보라.

## 0. 발송은 반드시 `sendTelegram()`을 거친다

`src/alerter.js`의 `sendTelegram(message, keyword)`가 유일한 발송 통로다. 새 알림 유형을 추가할
때도 `axios.post`를 직접 호출하지 말고 이 함수를 재사용하라. 여기에 4096자 분할·재시도 지점이
모여 있어야 한다.

```js
import { sendTelegram } from './alerter.js';
await sendTelegram(message, 'my_new_alert_type');  // keyword는 alerts_sent 로그용 태그
```

## 1. 4096자 제한과 분할 전송 (필수)

**텔레그램 `sendMessage`는 메시지당 최대 4096자.** 초과하면 API가 `400 Bad Request
(message is too long)`로 거부한다. 이 레포는 다이제스트가 키워드 수·근거 줄이 많아지면
쉽게 이 한계를 넘는다 — 발송 전에 반드시 길이를 확인해야 한다.

`sendTelegram()`은 내부에서 `splitTelegramMessage(text, maxLen=4000)`으로 자동 분할한다:

- 4000자 기준(4096 여유분)으로 **줄 단위**로 자른다. 문장/HTML 태그 중간에서 끊기지 않도록 `\n`
  경계를 우선한다.
- 한 줄 자체가 4000자를 넘는 예외적 경우만 강제 절단한다.
- 2개 이상으로 쪼개지면 각 조각 앞에 `(N/M)` 번호를 붙여 순서를 알 수 있게 한다.
- 조각 사이 `sleep(300)`으로 텔레그램 레이트리밋을 피한다.
- `logAlert(keyword, 'telegram')`은 전체 메시지 기준 **한 번만** 호출한다(조각마다 호출하면
  쿨다운 로그가 중복된다).

**새 알림 포맷을 추가할 때**: 메시지 문자열을 직접 조립해서 axios로 보내지 말고 항상
`sendTelegram()`을 통과시켜라. 그래야 분할 로직을 재구현하지 않아도 된다.

```js
// ❌ 하지 마라 — 4096자 넘으면 조용히 실패
await axios.post(url, { chat_id, text: hugeMessage, parse_mode: 'HTML' });

// ✅ 이렇게 — 자동 분할
await sendTelegram(hugeMessage, 'some_alert');
```

## 2. 봇 API 호출 패턴

```js
const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
await axios.post(url, {
  chat_id: chatId,
  text: message,
  parse_mode: 'HTML',
});
```

- `botToken`/`chatId`는 `config.telegram`(env `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`)에서 가져온다.
- `parse_mode: 'HTML'`을 쓰고 있지만 **현재 메시지에는 HTML 태그를 넣지 않는다**(순수 텍스트 +
  이모지). HTML 태그를 새로 넣으려면 `<b>`/`<i>`/`<code>`/`<a href>`만 지원되고, 분할 시 태그가
  청크 경계에서 끊기지 않도록 별도 검증이 필요하다 — 태그를 쓰기 전 이 스킬을 갱신하라.
- 발송 실패는 호출부에서 `try/catch`로 감싸고 로그만 남긴다(`sendAlert`/`sendDailyDigest` 패턴
  참고) — 파이프라인 전체를 죽이지 않는다.

## 3. 메시지 포맷 규칙

- 개별 알림(`formatAlertMessage`): 🚨 헤더 + 키워드/카테고리/지표 블록 + 💡 분석 + ⏰ 타임스탬프.
- 일일 다이제스트(`sendDailyDigest`): 섹션 순서 고정 — 데이터랩 급등 → 🥇 황금 소재 → 관찰 중 →
  검증 필요. 각 키워드 행은 `formatDigestRow()`로 통일 (heat 아이콘 + content_type 태그 + 레벨 +
  reason/검색링크/근거/경쟁문서수 하위 줄).
- heat 아이콘: 🔴5+ 🟠3.5+ 🟡2.5+ 🟢1+ ⚪미약 (`heatIcon()`).
- 새 섹션을 추가하면 `sections.push()` 배열에 빈 줄로 구분해 넣고, 맨 끝 "총 N개 시그널 감지"
  카운트도 함께 갱신하라 — 실제로 표시된 행 수와 어긋나면 안 된다(과거 버그: probeSpikes.length를
  썼는데 쿨다운으로 걸러진 뒤 실제 표시된 행 수와 달랐음).

## 4. 쿨다운/중복 방지와의 연동

텔레그램 발송 자체와 "무엇을 보낼지 거르는 로직"은 분리되어 있다 — 이 스킬은 발송(포맷+전송)을
다루고, 무엇을 보낼지는 `alerts_sent` 테이블 기반 쿨다운이 결정한다(자세한 스코어링/쿨다운 로직은
trendleading-dev 스킬 §4, blog-traffic-dev 스킬 참고). 새 알림 채널을 추가할 때:

- `channel` 값을 고유하게 부여하라 (`telegram`, `digest_top`, `probe_spike` 등 — `alerts_sent.channel`
  로 구분). 기존 채널과 이름이 겹치면 쿨다운 조회 쿼리가 오염된다.
- 쿨다운이 필요한 신규 채널은 `getRecentXKeywords(days)` 형태 헬퍼를 `db.js`에 추가하고
  `logAlert(keyword, channel)`로 기록하는 기존 패턴을 따르라 (`getRecentDigestTopKeywords`,
  `getRecentProbeSpikeKeywords` 참고).

## 5. 검증 절차

```bash
node --check src/alerter.js
# 분할 로직 단독 검증 (봇 토큰 불필요)
node -e "
const { splitTelegramMessage } = await import('./src/alerter.js');
const long = 'x'.repeat(9000);
console.log(splitTelegramMessage(long).map(c => c.length));
"
```
- 실제 발송 검증(봇 토큰 필요)은 로컬에 `.env`가 있을 때만 가능하다. 원격/웹 세션은 `.env`가
  없으므로 실발송 검증은 GitHub Actions(`workflow_dispatch`)로 한다 — trendleading-dev 스킬 §7 참고.
- 포맷을 바꿨다면 `node index.js test`로 다이제스트 콘솔 출력이 의도대로 나오는지 먼저 확인하고,
  실제 텔레그램 발송은 배치 실행 로그로 확인하라.

## 6. 의사결정 히스토리

| 결정 | 이유 |
|---|---|
| sendTelegram() 단일 통로 | 분할·로그·재시도 로직을 한 곳에 모아 새 알림 유형 추가 시 재구현 방지 |
| 4000자 기준 줄 단위 분할 | 4096자 하드리밋에 여유분 확보 + 문장 중간 절단 방지 |
| 분할 시 (N/M) 번호 표기 | 여러 메시지로 쪼개져도 사용자가 순서/누락 여부를 알 수 있게 |
| 조각당 logAlert 미호출(전체 1회) | alerts_sent 쿨다운 로그 중복 방지 |

## 관련

- 실제 발송 코드: `src/alerter.js` (`sendTelegram`, `splitTelegramMessage`, `sendAlert`,
  `sendDailyDigest`).
- 무엇을 보낼지 결정하는 스코어링/쿨다운: `trendleading-dev` 스킬 §4, `blog-traffic-dev` 스킬.
- 프로바이더 무관 LLM 호출 규칙(관련 없어 보이지만 같은 "직접 호출 금지, 추상화 계층 통과" 원칙을
  공유): `hermes-dev` 스킬.
