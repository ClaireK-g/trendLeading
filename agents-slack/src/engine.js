// 에이전트 엔진 — 한 전문가의 발언 1회를 생성한다.
// 프로바이더 무관 llm.chat() 사용(무료 Gemini 주력 / Anthropic 옵션) + 스킬 주입.
// MOCK_LLM=true면 목업 응답.

import config from './config.js';
import { renderSkillsForPrompt } from './skills.js';
import { chat } from './llm.js';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// 한 멤버의 시스템 프롬프트를 구성: persona + 주입된 스킬 지식.
function buildSystemPrompt(member) {
  const skillBlock = renderSkillsForPrompt(member.skills || []);
  return `${member.persona}

# 발언 규칙
- 너는 F&B 마이크로 트렌드 대응 TF팀의 일원으로 Slack 스레드에서 동료 전문가들과 논의 중이다.
- 이전 발언들을 반드시 반영하라. 동의/반박할 때는 상대 역할을 명시하라(예: "SA님 말씀대로", "분석가님 우려와 달리").
- 너의 관점에서만 발언하라. 다른 전문가의 역할을 침범하지 마라.
- 3~5문장으로 간결하게. 근거 있는 주장만. 근거 없으면 "판단 보류"라고 말하라.
- 마크다운 헤더나 목록 남발 금지 — Slack 채팅 말투로 자연스럽게.${skillBlock}`;
}

// 지금까지의 논의 스레드를 유저 메시지로 렌더링.
function buildTranscript(topic, trendText, transcript, roleName) {
  const history = transcript.length
    ? transcript.map((t) => `[${t.name}] ${t.text}`).join('\n\n')
    : '(아직 발언 없음 — 네가 첫 발언자다)';
  return `# 논의 주제\n${topic}\n\n${trendText}\n\n# 지금까지의 논의\n${history}\n\n---\n이제 너(${roleName})의 차례다. 위 논의를 이어서 네 관점으로 발언하라.`;
}

// 목업 응답 — 키 없이 배선을 검증하기 위한 결정론적 스텁.
function mockReply(member, topic, transcript) {
  const ref = transcript.length ? `${transcript[transcript.length - 1].name}님 발언을 이어받자면, ` : '';
  const skillNote = (member.skills || []).length
    ? ` (스킬 '${member.skills.join(', ')}' 기준으로 보면 확인이 더 필요함)`
    : '';
  return `${ref}${member.name} 관점에서 "${topic}"에 대해선 신선도와 근거를 더 따져봐야 합니다${skillNote}. [MOCK]`;
}

// 한 멤버의 발언 1회 생성. tier: 'expert'|'synth'(신디사이저).
export async function runAgentTurn(member, { topic, trendText, transcript, tier = 'expert' }) {
  if (config.mockLLM) {
    await sleep(50);
    return mockReply(member, topic, transcript);
  }

  const system = buildSystemPrompt(member);
  const user = buildTranscript(topic, trendText, transcript, member.name);
  return chat({ system, user, tier });
}
