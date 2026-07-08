// 오케스트레이터 — 9인 전문가의 다중 라운드 논의를 진행한다.
// 각 발언자는 '지금까지의 전체 스레드'를 보고 발언 → 서로 참조·반박하는
// 실제 커뮤니케이션이 일어난다. 마지막에 신디사이저가 종합/결론을 낸다.

import config from './config.js';
import { ROSTER, SYNTHESIZER } from './roster.js';
import { runAgentTurn } from './engine.js';
import { loadTrendContext } from './trend-context.js';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 논의를 진행한다.
 * @param {string} topic - 논의 주제
 * @param {(msg:{member,text,round})=>Promise<void>} onMessage - 발언마다 호출(스트리밍 출력/Slack post)
 * @returns {Promise<{transcript, conclusion}>}
 */
export async function runDiscussion(topic, onMessage = async () => {}) {
  const trend = await loadTrendContext();
  const trendText = trend.text;
  const transcript = []; // { id, name, text, round }

  const rounds = Math.max(1, config.discussion.rounds);

  for (let round = 1; round <= rounds; round++) {
    for (const member of ROSTER) {
      let text;
      try {
        text = await runAgentTurn(member, { topic, trendText, transcript });
      } catch (err) {
        text = `(발언 실패: ${err.message})`;
      }
      const entry = { id: member.id, name: member.name, text, round };
      transcript.push(entry);
      await onMessage({ member, text, round });
      if (config.discussion.turnDelay) await sleep(config.discussion.turnDelay);
    }
  }

  // 신디사이저 — 전체 논의를 종합해 결론 + 액션아이템.
  let conclusion;
  try {
    conclusion = await runAgentTurn(SYNTHESIZER, {
      topic,
      trendText,
      transcript,
      model: config.anthropic.synthModel,
    });
  } catch (err) {
    conclusion = `(종합 실패: ${err.message})`;
  }
  transcript.push({ id: SYNTHESIZER.id, name: SYNTHESIZER.name, text: conclusion, round: 'final' });
  await onMessage({ member: SYNTHESIZER, text: conclusion, round: 'final' });

  return { transcript, conclusion, trendAvailable: trend.available };
}
