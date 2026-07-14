// 타깃 목록 로더 — buzz/targets.json은 사용자가 직접 편집 (docs/buzz-analysis-design.md §4 STEP 1)
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TARGETS_PATH = path.join(__dirname, 'targets.json');

export function loadTargets() {
  const raw = readFileSync(TARGETS_PATH, 'utf-8');
  const parsed = JSON.parse(raw);
  return parsed.targets || [];
}
