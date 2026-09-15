import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

test('home-ia exports showPuzzleChapters + setHubMascotLevel', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/home-ia.js'), 'utf8');
  assert.match(src, /export function showPuzzleChapters/);
  assert.match(src, /export function setHubMascotLevel/);
  assert.match(src, /setHubMascotLevel\(3\)/);
  assert.match(src, /puzzleChapters/);
  assert.match(src, /hidePuzzleChaptersPanel/);
});

test('puzzle-chapter navigates hub→chapters→levels; hide returns chapters', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/puzzle-chapter.js'), 'utf8');
  assert.match(src, /export function onPuzzleChapterSelect/);
  assert.match(src, /showPuzzleChapters/);
  assert.match(src, /← 返回章节/);
  // hidePuzzleScreen prefers chapters L3 over sim hub
  const hideIdx = src.indexOf('export function hidePuzzleScreen');
  const hideSlice = src.slice(hideIdx, hideIdx + 500);
  assert.match(hideSlice, /showPuzzleChapters/);
  assert.ok(
    hideSlice.indexOf('showPuzzleChapters') < hideSlice.indexOf('restoreSimShell'),
    'chapters back target should come before sim hub fallback'
  );
});

test('mascot L1/L2/L3 day+night assets exist', () => {
  for (const name of [
    'mascot-l1-day.jpg',
    'mascot-l1-night.jpg',
    'mascot-l2-day.jpg',
    'mascot-l2-night.jpg',
    'mascot-l3-day.jpg',
    'mascot-l3-night.jpg',
  ]) {
    const p = path.join(ROOT, 'images', name);
    assert.ok(fs.existsSync(p), 'missing ' + name);
    assert.ok(fs.statSync(p).size > 1000, name + ' too small');
  }
});

test('index.html opens chapter 2/3/4 cards', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /id="puzzleChapter2Card"[^>]*onclick="onPuzzleChapterSelect\(2\)"/);
  assert.match(html, /id="puzzleChapter3Card"[^>]*onclick="onPuzzleChapterSelect\(3\)"/);
  assert.match(html, /id="puzzleChapter4Card"[^>]*onclick="onPuzzleChapterSelect\(4\)"/);
  assert.doesNotMatch(
    html.slice(html.indexOf('id="puzzleChapter2Card"'), html.indexOf('id="puzzleChapter4Card"') + 400),
    /即将推出/
  );
});

test('puzzle-chapter select wires ch1…ch4; fetches chapter query', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/puzzle-chapter.js'), 'utf8');
  assert.match(src, /chapterMap = \{ 1: 'ch1', 2: 'ch2', 3: 'ch3', 4: 'ch4' \}/);
  assert.match(src, /puzzles\?chapter=\$\{encodeURIComponent\(activeChapterId\)\}/);
  assert.match(src, /残局挑战 · 第三章/);
  assert.match(src, /残局挑战 · 第四章/);
});
