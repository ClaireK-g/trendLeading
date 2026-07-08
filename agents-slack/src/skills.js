// 스킬 로더 — 레포의 .claude/skills/<name>/SKILL.md 를 서버에서 읽어
// 각 에이전트의 시스템 프롬프트에 주입한다.
//
// ★ 핵심: Slack은 .claude 폴더를 네이티브로 로드하지 않는다. 하지만 이렇게
//   서버(봇 백엔드)에서 SKILL.md를 직접 읽어 프롬프트에 넣으면, Slack 위의
//   에이전트도 Claude Code와 동일한 스킬 지식을 그대로 사용하게 된다.

import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// agents-slack/src → 레포 루트 → .claude/skills
const SKILLS_DIR = path.resolve(__dirname, '..', '..', '.claude', 'skills');

let _cache = null;

// SKILL.md 상단의 YAML frontmatter에서 name/description을 뽑고 본문을 분리한다.
function parseSkillFile(raw) {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) return { name: null, description: null, body: raw.trim() };

  const [, frontmatter, body] = fmMatch;
  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
  return {
    name: nameMatch ? nameMatch[1].trim() : null,
    description: descMatch ? descMatch[1].trim() : null,
    body: body.trim(),
  };
}

// 레포의 모든 스킬을 { name: {name, description, body} } 맵으로 로드.
export function loadSkills() {
  if (_cache) return _cache;
  _cache = {};

  if (!existsSync(SKILLS_DIR)) {
    console.warn(`[skills] 스킬 디렉토리 없음: ${SKILLS_DIR}`);
    return _cache;
  }

  for (const entry of readdirSync(SKILLS_DIR)) {
    const skillPath = path.join(SKILLS_DIR, entry, 'SKILL.md');
    if (!existsSync(skillPath) || !statSync(skillPath).isFile()) continue;
    try {
      const parsed = parseSkillFile(readFileSync(skillPath, 'utf-8'));
      const key = parsed.name || entry;
      _cache[key] = parsed;
    } catch (err) {
      console.warn(`[skills] ${entry} 로드 실패:`, err.message);
    }
  }

  const names = Object.keys(_cache);
  console.log(`[skills] ${names.length}개 스킬 로드: ${names.join(', ') || '(없음)'}`);
  return _cache;
}

// 특정 스킬 이름 목록을 프롬프트에 넣을 텍스트 블록으로 변환.
export function renderSkillsForPrompt(skillNames = []) {
  if (!skillNames.length) return '';
  const all = loadSkills();
  const blocks = [];

  for (const name of skillNames) {
    const skill = all[name];
    if (!skill) {
      console.warn(`[skills] 요청한 스킬 "${name}" 없음 — 스킵`);
      continue;
    }
    blocks.push(`## 참조 스킬: ${name}\n${skill.description || ''}\n\n${skill.body}`);
  }

  if (!blocks.length) return '';
  return (
    '\n\n# 너에게 주어진 프로젝트 스킬 (반드시 이 지식을 근거로 발언하라)\n\n' +
    blocks.join('\n\n---\n\n')
  );
}

export function resetSkillsCache() {
  _cache = null;
}
