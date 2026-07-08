// Slack 통합 — Bolt(Socket Mode) 앱. 트리거를 받으면 스레드에서 9인 논의를 진행하고
// 각 전문가 발언을 그 전문가의 이름·이모지로 포스트한다(chat:write.customize 필요).
//
// 트리거 2가지:
//   - 슬래시 커맨드  /trend-discuss <주제>
//   - 앱 멘션        @TF봇 <주제>

import config from './config.js';
import { runDiscussion } from './orchestrator.js';

// 발언을 해당 전문가의 이름/이모지로 스레드에 포스트.
function makePoster(client, channel, thread_ts) {
  return async ({ member, text, round }) => {
    const badge = round === 'final' ? ' · 종합' : '';
    await client.chat.postMessage({
      channel,
      thread_ts,
      text: `${member.emoji} *${member.name}*${badge}\n${text}`,
      username: `${member.name}`,
      icon_emoji: member.emoji,
    });
  };
}

async function handleDiscussion(client, { channel, thread_ts, topic, respond }) {
  const header = await client.chat.postMessage({
    channel,
    thread_ts,
    text: `:thread: *TF팀 논의 시작* — "${topic}"\n9인 전문가가 순서대로 발언한 뒤 퍼실리테이터가 종합합니다.`,
  });
  const rootTs = thread_ts || header.ts;

  try {
    const post = makePoster(client, channel, rootTs);
    const { trendAvailable } = await runDiscussion(topic, post);
    await client.chat.postMessage({
      channel,
      thread_ts: rootTs,
      text: `:white_check_mark: 논의 완료${trendAvailable ? ' (실제 트렌드 데이터 반영됨)' : ''}`,
    });
  } catch (err) {
    await client.chat.postMessage({
      channel,
      thread_ts: rootTs,
      text: `:x: 논의 중 오류: ${err.message}`,
    });
  }
}

export async function startSlackApp() {
  const { default: bolt } = await import('@slack/bolt');
  const { App } = bolt;

  if (!config.slack.botToken || !config.slack.appToken) {
    throw new Error('SLACK_BOT_TOKEN 과 SLACK_APP_TOKEN(xapp-, Socket Mode)이 필요합니다.');
  }

  const app = new App({
    token: config.slack.botToken,
    appToken: config.slack.appToken,
    socketMode: true,
  });

  // 슬래시 커맨드: /trend-discuss <주제>
  app.command('/trend-discuss', async ({ command, ack, client }) => {
    await ack();
    const topic = (command.text || '').trim();
    if (!topic) {
      await client.chat.postMessage({
        channel: command.channel_id,
        text: '주제를 입력하세요: `/trend-discuss 우베 디저트 지금 밀어야 하나?`',
      });
      return;
    }
    await handleDiscussion(client, { channel: command.channel_id, thread_ts: null, topic });
  });

  // 앱 멘션: @봇 <주제>
  app.event('app_mention', async ({ event, client }) => {
    const topic = (event.text || '').replace(/<@[^>]+>/g, '').trim();
    if (!topic) return;
    await handleDiscussion(client, {
      channel: event.channel,
      thread_ts: event.thread_ts || event.ts,
      topic,
    });
  });

  await app.start();
  console.log('[slack] ⚡ TF팀 멀티에이전트 봇 실행 중 (Socket Mode)');
  return app;
}
