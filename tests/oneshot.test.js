import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkOneshotNextAction,
  checkOneshotActionList,
  oneshotAmmoFromActions,
} from '../shared/oneshot.js';
import { formatPlayHudChrome } from '../js/puzzle-goals-copy.js';
import {
  validatePlayAction,
  evaluateRewindEligibility,
  detectSeedKind,
} from '../js/game-play-usecase.js';
import { resetSession, patchSession, getSession } from '../js/game-session.js';

const html = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.html'),
  'utf8'
);

test('oneshot ammo / ORDER_LIMIT helpers', () => {
  assert.deepEqual(oneshotAmmoFromActions([], null), {
    buysLeft: 1,
    sellsLeft: 1,
    maxBuys: 1,
    maxSells: 1,
    buys: 0,
    sells: 0,
  });
  const secondBuy = checkOneshotNextAction(['buy', 'sell'], 'buy', null);
  assert.equal(secondBuy.ok, false);
  assert.equal(secondBuy.code, 'ORDER_LIMIT');
  assert.equal(checkOneshotNextAction(['buy', 'sell'], 'hold', null).ok, true);
  const list = checkOneshotActionList(['buy', 'buy', ...Array(27).fill('hold')], null);
  assert.equal(list.ok, false);
  assert.equal(list.code, 'ORDER_LIMIT');
});

test('formatPlayHudChrome oneshot badge and ammo copy', () => {
  const hud = formatPlayHudChrome({
    gameKind: 'oneshot',
    ammo: { buysLeft: 1, sellsLeft: 0 },
  });
  assert.equal(hud.isOneshot, true);
  assert.equal(hud.badge, '一把梭');
  assert.match(hud.subtitle, /买入剩余 1/);
  assert.match(hud.subtitle, /卖出剩余 0/);
  assert.equal(formatPlayHudChrome({ gameKind: 'classic' }).badge, '模拟盘');
});

test('validatePlayAction blocks spent oneshot ammo; rewind ineligible', () => {
  resetSession();
  patchSession({
    gameKind: 'oneshot',
    modifiers: { maxBuys: 1, maxSells: 1 },
    actions: ['buy', 'sell'],
    position: 'empty',
    currentDay: 3,
    gameDays: 30,
    cloudMode: true,
    protocolVersion: 'event-v1',
    undoCount: 0,
  });
  const buy = validatePlayAction(getSession(), 'buy');
  assert.equal(buy.ok, false);
  assert.match(buy.errorZh, /买入次数已用完/);
  assert.equal(validatePlayAction(getSession(), 'hold').ok, true);
  assert.equal(
    evaluateRewindEligibility(getSession(), { gameRewind: true }).eligible,
    false
  );
  assert.equal(evaluateRewindEligibility(getSession(), { gameRewind: true }).reason, 'oneshot');
});

test('detectSeedKind treats oneshot window as window not puzzle', () => {
  assert.equal(
    detectSeedKind({
      gameKind: 'oneshot',
      window: { bars: [{ date: 'd' }], history: [] },
    }),
    'window'
  );
});

test('L2/L3 hub IA copy: 选择玩法, no L2 立即开始, no embedded daily table', () => {
  const sim = html.split('id="simHub"')[1].split('id="playModes"')[0];
  const play = html.split('id="playModes"')[1].split('id="puzzleChapters"')[0];
  assert.match(sim, /选择玩法/);
  assert.doesNotMatch(sim, /立即开始/);
  assert.doesNotMatch(sim, /id="dailyChallengeBoard"/);
  assert.doesNotMatch(sim, /id="dailyChallengeCard"/);
  assert.match(play, /返回模拟盘/);
  assert.match(play, /开始今日挑战/);
  assert.match(play, /开始经典练习/);
  assert.match(play, /开始一把梭/);
  assert.match(play, /data-jiu-price="30"/);
  assert.match(play, /查看日榜/);
  assert.match(html, /id="dailyChallengeBoardModal"/);
  assert.doesNotMatch(play, /立即开始/);
});

test('L3 puzzle chapters: chapter picker before level list; ch2/ch3 soon', () => {
  const sim = html.split('id="simHub"')[1].split('id="playModes"')[0];
  const chapters = html.split('id="puzzleChapters"')[1].split('</section>')[0];
  assert.match(sim, /选择章节/);
  assert.match(sim, /章节闯关/);
  assert.match(sim, /onPuzzleChapterCardClick/);
  assert.match(chapters, /返回模拟盘/);
  assert.match(chapters, /进入第一章/);
  assert.match(chapters, /onPuzzleChapterSelect\(1\)/);
  assert.match(chapters, /即将推出/);
  assert.match(chapters, /id="puzzleChapter2Card"/);
  assert.match(chapters, /disabled/);
  assert.match(html, /← 返回章节/);
  assert.match(html, /mascot-l1-day\.jpg/);
  assert.match(html, /mascot-l2-day\.jpg/);
  assert.match(html, /mascot-l3-day\.jpg/);
  assert.match(html, /data-hub-level="1"/);
});
