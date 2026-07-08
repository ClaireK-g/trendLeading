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

## 로컬 실행 (Slack 없이)

```bash
# 키 없이 배선·포맷만 검증 (오프라인)
MOCK_LLM=true node agents-slack/index.js discuss "우베 디저트 지금 밀어야 하나?"

# 실제 LLM으로 논의 (ANTHROPIC_API_KEY 필요)
node agents-slack/index.js discuss "설이동, 지금 콘텐츠로 다뤄야 하나?"
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
| `AGENT_EXPERT_MODEL` | `claude-sonnet-5` | 전문가 에이전트 모델 |
| `AGENT_SYNTH_MODEL` | `claude-opus-4-8` | 신디사이저(종합) 모델 |
| `AGENT_ROUNDS` | `2` | 전문가 발언 라운드 수 |
| `AGENT_TURN_DELAY` | `800` | 발언 간 지연(ms) — rate limit 완화 |
| `MOCK_LLM` | `false` | 목업 모드(오프라인 검증) |

## 비용 주의

논의 1회 = (전문가 8인 × 라운드 수 + 신디사이저 1) 회의 LLM 호출.
기본 2라운드면 17회 호출. `AGENT_ROUNDS`로 조절. 트렌드 파이프라인의
Gemini 무료 티어와 달리 이 서비스는 **Anthropic 유료 API**를 쓰므로,
운영 비용은 스폰서(지경) 확인이 필요하다.

## 로스터 커스터마이징

`src/roster.js`에서 페르소나·이모지·참조 스킬을 수정한다. 새 전문가를 추가하면
자동으로 논의에 참여한다. 각 멤버의 `skills: [...]`에 스킬 이름을 넣으면 해당
SKILL.md가 그 에이전트에게만 주입된다.
