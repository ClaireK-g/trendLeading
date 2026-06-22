import fs from 'node:fs';

const BLACKLIST_PATH = '/Users/producer/dev/trendLeading/data/blacklist.json';

let blacklistSet = null;

function ensureLoaded() {
  if (!blacklistSet) {
    blacklistSet = loadBlacklist();
  }
}

export function loadBlacklist() {
  const data = fs.readFileSync(BLACKLIST_PATH, 'utf-8');
  const keywords = JSON.parse(data);
  blacklistSet = new Set(keywords.map((k) => k.toLowerCase().trim()));
  return blacklistSet;
}

export function isBlacklisted(keyword) {
  ensureLoaded();
  return blacklistSet.has(keyword.toLowerCase().trim());
}

export function addToBlacklist(keyword) {
  ensureLoaded();
  const normalized = keyword.toLowerCase().trim();
  blacklistSet.add(normalized);
  const arr = Array.from(blacklistSet);
  fs.writeFileSync(BLACKLIST_PATH, JSON.stringify(arr, null, 2) + '\n', 'utf-8');
}

export function removeFromBlacklist(keyword) {
  ensureLoaded();
  const normalized = keyword.toLowerCase().trim();
  blacklistSet.delete(normalized);
  const arr = Array.from(blacklistSet);
  fs.writeFileSync(BLACKLIST_PATH, JSON.stringify(arr, null, 2) + '\n', 'utf-8');
}

export function getBlacklist() {
  ensureLoaded();
  return Array.from(blacklistSet);
}
