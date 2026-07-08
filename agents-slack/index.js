#!/usr/bin/env node
// agents-slack CLI — Slack 위 TF팀 멀티에이전트 논의 서비스.
//
//   node agents-slack/index.js discuss "<주제>"   로컬에서 논의 실행(콘솔 출력)
//   node agents-slack/index.js serve               Slack 봇 서버 시작(Socket Mode)
//
// 키 없이 배선만 검증하려면:  MOCK_LLM=true node agents-slack/index.js discuss "테스트"

import config from './src/config.js';
import { runDiscussion } from './src/orchestrator.js';
import { loadSkills } from './src/skills.js';

const BANNER = `
======================================================
  TF팀 멀티에이전트 — Slack 논의 서비스
  9인 가상 전문가 · 스킬 주입 · 트렌드 그라운딩
======================================================
`;

const USAGE = `
사용법:
  node agents-slack/index.js discuss "<주제>"   로컬 논의(콘솔 출력)
  node agents-slack/index.js serve               Slack 봇 시작(Socket Mode)

환경:
  ANTHROPIC_API_KEY   에이전트 LLM 호출 (없으면 MOCK_LLM=true로 배선만 검증)
  SLACK_BOT_TOKEN     xoxb- (serve 시 필요)
  SLACK_APP_TOKEN     xapp- Socket Mode (serve 시 필요)
`;

async function main() {
  console.log(BANNER);
  const [, , command, ...rest] = process.argv;

  if (!command) {
    console.log(USAGE);
    process.exit(0);
  }

  switch (command) {
    case 'discuss': {
      const topic = rest.join(' ').trim();
      if (!topic) {
        console.error('주제를 입력하세요: node agents-slack/index.js discuss "우베 디저트 지금 밀어야 하나?"');
        process.exit(1);
      }
      loadSkills();
      if (config.mockLLM) {
        console.log('[mode] MOCK_LLM — 목업 응답으로 배선 검증\n');
      } else {
        const { activeProviderLabel } = await import('./src/llm.js');
        console.log(`[mode] 프로바이더: ${activeProviderLabel()}\n`);
      }

      const post = async ({ member, text, round }) => {
        const badge = round === 'final' ? '종합' : `R${round}`;
        console.log(`${member.emoji || ''} [${badge}] ${member.name}:`);
        console.log(`   ${text}\n`);
      };

      console.log(`■ 주제: ${topic}\n`);
      const { conclusion } = await runDiscussion(topic, post);
      console.log('======================================================');
      console.log('■ 최종 종합:');
      console.log(conclusion);
      break;
    }

    case 'serve': {
      const { startSlackApp } = await import('./src/slack.js');
      await startSlackApp();
      process.on('SIGINT', () => {
        console.log('\n[serve] 종료');
        process.exit(0);
      });
      break;
    }

    default:
      console.error(`알 수 없는 명령어: ${command}`);
      console.log(USAGE);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('치명적 오류:', err);
  process.exit(1);
});
