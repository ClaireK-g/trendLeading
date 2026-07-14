// 텔레그램 전송 유틸 — src/alerter.js와 완전 독립 구현 (buzz 모듈 격리 원칙).
// 4096자 메시지 길이 제한·분할 전송 규칙은 telegram-dev 스킬을 따른다.
import axios from 'axios';
import config from '../config.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 텔레그램 sendMessage 1건 최대 4096자. 여유를 두고 4000자 기준 줄 단위 분할
// (한 줄이 4000자를 넘는 예외적 경우만 강제 절단).
export function splitMessage(text, maxLen = 4000) {
  if (text.length <= maxLen) return [text];

  const lines = text.split('\n');
  const chunks = [];
  let current = '';

  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > maxLen) {
      if (current) chunks.push(current);
      if (line.length > maxLen) {
        for (let i = 0; i < line.length; i += maxLen) {
          chunks.push(line.slice(i, i + maxLen));
        }
        current = '';
      } else {
        current = line;
      }
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);

  return chunks;
}

export async function sendTelegram(message) {
  const { botToken, chatId } = config.telegram;
  if (!botToken || !chatId) {
    throw new Error('TELEGRAM_BOT_TOKEN 또는 챗 ID(BUZZ_TELEGRAM_CHAT_ID/TELEGRAM_CHAT_ID) 미설정');
  }

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const chunks = splitMessage(message);
  let lastRes;

  for (let i = 0; i < chunks.length; i++) {
    const text = chunks.length > 1 ? `(${i + 1}/${chunks.length})\n${chunks[i]}` : chunks[i];
    lastRes = await axios.post(url, {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
    });
    if (i < chunks.length - 1) await sleep(300);
  }

  return lastRes.data;
}
