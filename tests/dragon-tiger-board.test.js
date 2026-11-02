import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const html = read('index.html');
const result = read('js/result.js');
const share = read('js/result-share.js');
const lb = read('js/leaderboard.js');

test('home: the board entry in 玩法选择 is called 龙虎榜 and still opens the leaderboard', () => {
  const card = html.slice(html.indexOf('id="leaderboardModeCard"'), html.indexOf('id="leaderboardModeCard"') + 400);
  assert.match(card, /onclick="showLeaderboard\(\)"/);
  assert.match(card, /<strong>龙虎榜<\/strong>/);
  assert.doesNotMatch(card, /练习榜/);
});

test('the leaderboard page itself is titled 龙虎榜', () => {
  assert.match(lb, /<h2>龙虎榜<\/h2>/);
  assert.doesNotMatch(lb, /<h2>排行榜<\/h2>/);
});

test('result page: classic and 韭币局 both say 龙虎榜; the 韭币榜 label is gone from the result button', () => {
  assert.match(html.slice(html.indexOf('id="resultLeaderboardBtn"')), /<span class="ctl-label">龙虎榜<\/span>/);
  assert.match(result, /setBtnLabel\(lbBtn, '龙虎榜'\)/);
  assert.doesNotMatch(result, /setBtnLabel\(lbBtn, '韭币榜'\)/);
  // kind-specific boards keep their names
  assert.match(result, /'一把梭榜'/);
  assert.match(result, /'生存榜'/);
  assert.match(result, /'日榜'/);
});

test('result button: a finished 韭币局 opens the 龙虎榜, never the 韭币榜', () => {
  const fn = share.slice(share.indexOf('export function openResultLeaderboard'));
  assert.doesNotMatch(fn, /coin-board|showCoinBoard/);
  assert.doesNotMatch(fn, /'stake'/);
  assert.match(fn, /showLeaderboard\(mode\)/);
});

test('the 韭币榜 is still reachable from the balance chip', () => {
  assert.match(read('js/jiu-coin.js'), /coin-board\.js/);
});
