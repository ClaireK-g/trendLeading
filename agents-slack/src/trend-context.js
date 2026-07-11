// 트렌드 그라운딩 — 파이프라인이 쌓아둔 data/trend.db에서 최신 트렌드를 읽어
// 논의를 '실제 지금 뜨는 것' 위에서 진행하도록 컨텍스트를 만든다.
// DB가 없거나 읽기 실패해도 논의는 계속되어야 하므로 항상 안전하게 폴백한다.

import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.resolve(__dirname, '..', '..', 'data', 'trend.db');

export async function loadTrendContext(limit = 15) {
  if (!existsSync(DB_PATH)) {
    return { available: false, text: '(트렌드 DB 없음 — 일반 지식으로 논의)' };
  }

  let Database;
  try {
    ({ default: Database } = await import('better-sqlite3'));
  } catch {
    return { available: false, text: '(better-sqlite3 미설치 — 트렌드 그라운딩 생략)' };
  }

  try {
    const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const rows = db
      .prepare(
        `SELECT keyword,
                SUM(mention_count) AS mentions,
                SUM(unique_accounts) AS accounts,
                MAX(date) AS latest
         FROM keyword_daily_stats
         WHERE date >= ?
         GROUP BY keyword
         ORDER BY mentions DESC
         LIMIT ?`
      )
      .all(cutoffStr, limit);
    db.close();

    if (!rows.length) {
      return { available: false, text: '(최근 7일 트렌드 데이터 없음)' };
    }

    const lines = rows.map(
      (r) => `- ${r.keyword} (언급 ${r.mentions}, 계정 ${r.accounts}, 최근 ${r.latest})`
    );
    return {
      available: true,
      rows,
      text: `# 최근 7일 실제 트렌드 데이터 (data/trend.db)\n${lines.join('\n')}`,
    };
  } catch (err) {
    console.warn('[trend-context] DB 읽기 실패:', err.message);
    return { available: false, text: '(트렌드 DB 읽기 실패 — 일반 지식으로 논의)' };
  }
}
