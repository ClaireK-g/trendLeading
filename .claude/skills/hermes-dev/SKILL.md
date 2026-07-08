---
name: hermes-dev
description: 이 레포에서 LLM 프로바이더(무료 Gemini 주력, Anthropic 옵션)를 호출·추가·전환하는 모든 작업에 사용. 프로바이더 추상화 계층, Gemini 무료 티어 제약(모델 폴백·키 로테이션·429/503·RPM), 프로바이더별 요청/응답 스키마 차이, 비용 원칙을 담는다. Use when calling, adding, or switching LLM providers (Gemini free tier vs Anthropic) anywhere in this repo — extractor.js, agents-slack, or any new LLM feature.
---

# hermes-dev — LLM 프로바이더 통합 스킬

이 레포는 **무료 Gemini를 주력**으로, **Anthropic을 옵션(유료)**으로 쓴다. LLM을 호출하는
코드를 만지기 전에 이 문서를 먼저 보라. 헤르메스(전령)처럼 여러 프로바이더 사이를 오가는
계층의 규칙을 담는다.

## 0. 비용 원칙 (가장 중요)

1. **무료 Gemini가 기본이다.** 프로젝트 정체성이 "100% 무료 파이프라인"이다. 새 LLM 기능은
   반드시 Gemini 무료 티어로 먼저 동작해야 한다. Anthropic은 **명시적 opt-in**일 때만 쓴다.
2. **유료 API(Anthropic) 도입·상시화는 스폰서(지경) 확인 사항.** 코드 기본값을 유료로 두지 마라.
3. **프로바이더는 `AGENT_PROVIDER`로 전환**하고, `auto`는 "Gemini 키 있으면 Gemini, 없으면 Anthropic"
   순으로 해석한다. 무료를 항상 우선.

## 1. 프로바이더 추상화 계층

LLM 호출은 **직접 하지 말고 추상화 함수를 거친다**:
- 파이프라인(추출): `src/extractor.js`의 `callGemini`/`callGeminiRaw` (Gemini 전용, JSON 모드).
- 에이전트 서비스: `agents-slack/src/llm.js`의 `chat({system, user, provider, tier, temperature})`
  — 프로바이더 무관 채팅. 내부에서 gemini/anthropic으로 분기.

새 LLM 기능을 추가할 때 이 계층을 우회해 axios/SDK를 직접 부르지 마라. 폴백·키로테이션·에러처리가
계층에 모여 있어야 한다.

## 2. Gemini 무료 티어 제약 (반드시 지켜라)

`extractor.js`에서 검증된 패턴을 그대로 재사용한다:

- **엔드포인트**: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEY}`
- **모델 폴백 체인**: `gemini-2.5-flash` → `gemini-3.5-flash` → `gemini-2.5-flash-lite`.
  앞 모델 실패 시 다음으로. 첫 모델이 주력.
- **에러 처리**:
  - `429`(rate limit) → **15초 대기** 후 재시도(같은 모델, 최대 3회).
  - `503`(overload) → **즉시 다음 모델**로 폴백(대기 없음).
  - 그 외 → 지수 백오프 `2^attempt * 2000ms`.
- **키 로테이션**: `getNextApiKey()`가 `GEMINI_API_KEY`, `GEMINI_API_KEY_2`를 라운드로빈.
  복수 구글 계정 키로 RPM 한도를 분산한다. 호출마다 다음 키를 쓴다.
- **RPM 주의**: 호출 수를 늘리는 변경(배치 축소, 라운드 추가, 에이전트 증가)은 무료 티어 한도
  초과 위험. **먼저 총 호출 수를 계산하라.** 예: 에이전트 8인 × N라운드 + 종합 = (8N+1) 호출/논의.
- **배치 간 지연**: 연속 호출 사이 `sleep(2000)` 이상 권장.

## 3. 프로바이더별 요청/응답 스키마 차이 (버그 다발 지점)

| 항목 | Gemini | Anthropic |
|---|---|---|
| SDK/전송 | axios REST (SDK 불필요) | `@anthropic-ai/sdk` |
| 시스템 프롬프트 | `systemInstruction: { parts:[{text}] }` | `system` 파라미터 |
| 대화 | `contents:[{role:"user",parts:[{text}]}]` | `messages:[{role,content}]` |
| 응답 텍스트 | `data.candidates[0].content.parts[0].text` | `resp.content.filter(b=>b.type==='text')...` |
| 토큰 상한 | `generationConfig.maxOutputTokens` | `max_tokens` |
| 온도 | `generationConfig.temperature` | `temperature` |
| JSON 강제 | `generationConfig.responseMimeType:"application/json"` | 프롬프트로 유도 |

- **응답 파싱은 항상 옵셔널 체이닝 + 폴백**: `?.[0]?.content?.parts?.[0]?.text ?? ''`.
  Gemini는 안전필터·빈 후보로 candidates가 비어 올 수 있다.
- Gemini `role`은 `user`/`model`만 유효(assistant 아님). 멀티턴 시 이전 응답은 `model` 역할.

## 4. 모델 선택 기본값

| tier | Gemini(무료) | Anthropic(유료) |
|---|---|---|
| expert (일반 에이전트) | `gemini-2.5-flash` | `claude-sonnet-5` |
| synth (종합/최종 추론) | `gemini-2.5-flash` | `claude-opus-4-8` |

무료 티어엔 프리미엄 구분이 없으므로 synth도 flash를 쓰되, 필요 시 `AGENT_GEMINI_SYNTH_MODEL`로
상향 모델을 지정할 수 있게 열어둔다. 모델 ID는 env로 오버라이드 가능해야 한다.

## 5. 환경변수 계약

```
# 무료 Gemini (주력) — 루트 파이프라인과 공유
GEMINI_API_KEY=            # Google AI Studio
GEMINI_API_KEY_2=          # 2번째 계정 키(로테이션)
# Anthropic (옵션, 유료)
ANTHROPIC_API_KEY=
# 프로바이더 선택
AGENT_PROVIDER=auto        # auto|gemini|anthropic  (auto=무료 우선)
AGENT_GEMINI_MODEL=gemini-2.5-flash
AGENT_GEMINI_SYNTH_MODEL=gemini-2.5-flash
```

- `GEMINI_API_KEY*`는 파이프라인과 **공유**한다(별도 키 만들지 마라). config에서 동일 배열로 로드.
- 키가 하나도 없고 `MOCK_LLM`도 아니면 명확한 에러로 안내한다.

## 6. 검증 절차

```bash
# 키 없이 배선 검증 (오프라인)
MOCK_LLM=true node agents-slack/index.js discuss "테스트 주제"
# 무료 Gemini로 실제 논의
AGENT_PROVIDER=gemini node agents-slack/index.js discuss "설이동 지금 다뤄야 하나?"
# 프로바이더 분기 문법 확인
node --check agents-slack/src/llm.js
```
- 프로바이더를 추가/수정하면 **양쪽(gemini/anthropic) 모두 MOCK 아닌 경로로 최소 1회** 검증하라
  (키 있을 때). 스키마 차이(3번 표)를 어긋나게 두면 응답이 조용히 빈 문자열이 된다.

## 7. 의사결정 히스토리 (다시 논쟁 말 것)

| 결정 | 이유 |
|---|---|
| 무료 Gemini 주력 | 100% 무료 파이프라인 정체성. 유료는 스폰서 결정 |
| 모델 폴백 체인 + 키 로테이션 | 무료 티어 RPM/가용성 한계 우회 (extractor.js에서 검증됨) |
| 프로바이더 추상화(llm.js) | 호출부가 프로바이더를 몰라도 되게 — 전환·폴백을 한 곳에 |
| auto=무료 우선 | 실수로 유료 과금되는 것 방지 |

## 관련

- 파이프라인의 Gemini 원본 패턴: `src/extractor.js` (`GEMINI_MODELS`, `getNextApiKey`, `callGeminiRaw`).
- 에이전트에서 이 스킬은 SA·개발자·퍼실리테이터에게 주입되어, 프로바이더 관련
  발언의 근거가 된다(`agents-slack/src/roster.js`).
