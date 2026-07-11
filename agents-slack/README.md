# agents-slack — TF팀 멀티에이전트 Slack 논의 서비스

CLAUDE.md에 정의된 **9인 가상 전문가(TF팀)**가 Slack 스레드에서 서로 대화하며
F&B 트렌드 의사결정을 논의하는 서비스. 각 전문가는 레포의 **스킬(SKILL.md)을 주입받아**
동일한 프로젝트 지식 위에서 발언한다.

## 왜 이게 "Slack에서 스킬 쓰기"의 답인가

Slack 자체는 `.claude/skills/` 폴더를 로드하지 않는다. 이 서비스는 **봇 백엔드가
SKILL.md를 직접 읽어 각 에이전트의 시스템 프롬프트에 주입**한다(`src/skills.js`).
그래서 Claude Code/웹에서만 쓰던 스킬 지식을 Slack 위의 에이전트도 그대로 활용한다.

## 구조

```
agents-slack/
  index.js              CLI (discuss | serve)
  src/
    roster.js           9인 전문가 페르소나 + 각자 참조하는 스킬
    skills.js           .claude/skills/*/SKILL.md 로드 → 프롬프트 주입
    trend-context.js    data/trend.db에서 최근 트렌드 그라운딩
    engine.js           Anthropic API 호출 (1인 발언) + MOCK 경로
    orchestrator.js     다중 라운드 논의 진행 + 신디사이저 종합
    slack.js            Bolt(Socket Mode) 봇: 트리거 → 논의 → 스레드 포스트
    config.js           env → 설정
```

**논의 흐름**: 8인 전문가가 순서대로 발언(설정된 라운드 수만큼 반복) → 각자 지금까지의
전체 스레드를 보고 서로 참조·반박 → 마지막에 퍼실리테이터가 종합/결론/액션아이템.
이는 파이프라인의 Generator→Critic→Synthesizer 철학을 팀 논의로 확장한 것.

## LLM 프로바이더 (무료 Gemini 주력)

프로바이더 추상화 계층(`src/llm.js`, hermes-dev 스킬 규칙)으로 **무료 Gemini**와
**Anthropic(옵션·유료)**을 전환한다. `AGENT_PROVIDER=auto`(기본)는 **Gemini 키가 있으면
무료 Gemini를 우선** 쓰고, 없으면 Anthropic으로 폴백한다.

- 무료 Gemini는 루트 파이프라인의 `GEMINI_API_KEY`~`GEMINI_API_KEY_5`(최대 5개)를 **그대로 공유**한다(별도 키 불필요).
- 모델 폴백 체인(`gemini-2.5-flash`→`3.5-flash`→`flash-lite`), 키 로테이션, 429/503 처리는 `extractor.js`와 동일 패턴.

## 로컬 실행 (Slack 없이)

```bash
# 키 없이 배선·포맷만 검증 (오프라인)
MOCK_LLM=true node agents-slack/index.js discuss "우베 디저트 지금 밀어야 하나?"

# 무료 Gemini로 실제 논의 (GEMINI_API_KEY 있으면 auto로 자동 선택)
node agents-slack/index.js discuss "설이동, 지금 콘텐츠로 다뤄야 하나?"

# 프로바이더 강제 지정
AGENT_PROVIDER=gemini    node agents-slack/index.js discuss "..."   # 무료
AGENT_PROVIDER=anthropic node agents-slack/index.js discuss "..."   # 유료(opt-in)
```

## Slack 봇 실행

```bash
node agents-slack/index.js serve   # 또는 npm run agents
```

필요 env (`.env`):
- `ANTHROPIC_API_KEY`
- `SLACK_BOT_TOKEN` (xoxb-), `SLACK_APP_TOKEN` (xapp-, Socket Mode)

### Slack 앱 설정
1. api.slack.com/apps → Create New App
2. **Socket Mode** 켜기 → App-Level Token(xapp-) 발급 (`connections:write`)
3. **OAuth Scopes** (Bot): `chat:write`, `chat:write.customize`, `commands`, `app_mentions:read`
4. **Slash Commands**: `/trend-discuss` 등록
5. **Event Subscriptions**: `app_mention` 구독
6. 워크스페이스에 설치 → Bot Token(xoxb-) 복사

### 트리거
- `/trend-discuss 우베 디저트 지금 밀어야 하나?`
- `@봇 설이동 지금 다뤄야 하나?`

## 설정 (env)

| 변수 | 기본값 | 설명 |
|---|---|---|
| `AGENT_PROVIDER` | `auto` | `auto`(무료 우선)\|`gemini`\|`anthropic` |
| `AGENT_GEMINI_MODEL` | `gemini-2.5-flash` | 무료 전문가 모델 |
| `AGENT_GEMINI_SYNTH_MODEL` | `gemini-2.5-flash` | 무료 종합 모델 |
| `AGENT_EXPERT_MODEL` | `claude-sonnet-5` | Anthropic 전문가 모델 |
| `AGENT_SYNTH_MODEL` | `claude-opus-4-8` | Anthropic 종합 모델 |
| `AGENT_ROUNDS` | `2` | 전문가 발언 라운드 수 |
| `AGENT_TURN_DELAY` | `800` | 발언 간 지연(ms) — rate limit 완화 |
| `MOCK_LLM` | `false` | 목업 모드(오프라인 검증) |

## 비용 주의

논의 1회 = (전문가 8인 × 라운드 수 + 신디사이저 1) 회의 LLM 호출.
기본 2라운드면 17회 호출. `AGENT_ROUNDS`로 조절.

- **기본은 무료 Gemini**(파이프라인과 동일 무료 티어) — 무료 티어 RPM 한도 안에서 운영.
  호출 수를 키우는 변경(라운드·에이전트 증가)은 한도 초과 위험이니 먼저 총 호출 수를 계산할 것.
- **Anthropic은 opt-in 유료**. 상시 유료 운영은 스폰서(지경) 확인 필요.

## 로스터 커스터마이징

`src/roster.js`에서 페르소나·이모지·참조 스킬을 수정한다. 새 전문가를 추가하면
자동으로 논의에 참여한다. 각 멤버의 `skills: [...]`에 스킬 이름을 넣으면 해당
SKILL.md가 그 에이전트에게만 주입된다.
