import test from 'node:test';
import assert from 'node:assert/strict';
import { gameState } from '../js/state.js';
import { resetSession, patchSession, getSession } from '../js/game-session.js';
import { makeBars, holds } from '../shared/fixtures/golden.js';
import {
  sessionGameDays,
  isPuzzleSession,
  validatePlayAction,
  applyLocalDecision,
  settleLocalSession,
  resumeLocalActions,
  buildCloudFinishBody,
  sessionPatchFromCloudFinish,
  puzzlePositionFromState,
} from '../js/game-play-usecase.js';

function seedClassicWindow({ fillMode = 'next_open', actions = [] } = {}) {
  resetSession({ fillMode });
  const bars = makeBars({
    2: { open: 10, close: 10 },
    3: { open: 11, close: 11 },
  });
  patchSession({
    gameDays: 30,
    gameKind: null,
    currentDay: Math.min(actions.length + 1, 30),
    actions: actions.slice(),
    gameKline: bars,
    historyLength: 0,
    fillMode,
    position: 'empty',
    protocolVersion: null,
  });
  return bars;
}

test('sessionGameDays / isPuzzleSession defaults', () => {
  resetSession();
  assert.equal(sessionGameDays(), 30);
  assert.equal(isPuzzleSession(), false);
  patchSession({ gameKind: 'puzzle', gameDays: 8 });
  assert.equal(sessionGameDays(), 8);
  assert.equal(isPuzzleSession(), true);
});

test('validatePlayAction rejects illegal buy/sell and allows hold', () => {
  seedClassicWindow();
  assert.equal(validatePlayAction(getSession(), 'hold').ok, true);

  patchSession({ position: 'holding' });
  const buy = validatePlayAction(getSession(), 'buy');
  assert.equal(buy.ok, false);
  assert.match(buy.errorZh, /持仓/);

  patchSession({ position: 'empty' });
  const sell = validatePlayAction(getSession(), 'sell');
  assert.equal(sell.ok, false);
  assert.match(sell.errorZh, /空仓/);

  patchSession({ position: 'locked' });
  const locked = validatePlayAction(getSession(), 'sell');
  assert.equal(locked.ok, false);
  assert.match(locked.errorZh, /T\+1/);

  patchSession({ rewindBusy: true, position: 'empty' });
  assert.equal(validatePlayAction(getSession(), 'hold').ok, false);
});

test('puzzle T+1 sell guard before firstSellableDay', () => {
  resetSession();
  patchSession({
    gameKind: 'puzzle',
    gameDays: 8,
    currentDay: 1,
    position: 'holding',
    firstSellableDay: 2,
    actions: [],
  });
  const r = validatePlayAction(getSession(), 'sell');
  assert.equal(r.ok, false);
  assert.match(r.errorZh, /可卖日/);
});

test('applyLocalDecision buy→sell advances day and MTM fields', () => {
  const bars = seedClassicWindow();
  const r1 = applyLocalDecision('buy', { bars });
  assert.equal(r1.ok, true);
  assert.equal(gameState.actions.length, 1);
  assert.equal(gameState.actions[0], 'buy');
  assert.equal(gameState.currentDay, 2);
  assert.ok(gameState.position === 'holding' || gameState.position === 'locked');

  const r2 = applyLocalDecision('sell', { bars });
  assert.equal(r2.ok, true);
  assert.equal(gameState.actions.length, 2);
  assert.equal(gameState.currentDay, 3);
  assert.equal(gameState.position, 'empty');
  assert.ok(gameState.tradeHistory.some((t) => t.type === 'buy'));
  assert.ok(gameState.tradeHistory.some((t) => t.type === 'sell'));
});

test('applyLocalDecision rejects second buy while holding', () => {
  const bars = seedClassicWindow();
  assert.equal(applyLocalDecision('buy', { bars }).ok, true);
  const r = applyLocalDecision('buy', { bars });
  assert.equal(r.ok, false);
  assert.ok(r.errorZh);
  assert.equal(gameState.actions.length, 1);
});

test('resumeLocalActions replays draft; invalid draft fails closed', () => {
  const bars = seedClassicWindow();
  const ok = resumeLocalActions(['buy', 'sell', 'hold'], { bars });
  assert.equal(ok.ok, true);
  assert.deepEqual(gameState.actions, ['buy', 'sell', 'hold']);
  assert.equal(gameState.currentDay, 4);

  seedClassicWindow();
  const bad = resumeLocalActions(['sell'], { bars });
  assert.equal(bad.ok, false);
  assert.deepEqual(gameState.actions, []);
  assert.equal(gameState.currentDay, 1);
});

test('settleLocalSession requires day-30 with 29 actions then sets returnPct', () => {
  const bars = seedClassicWindow();
  const actions = ['buy', 'sell', ...holds(27)];
  patchSession({
    actions,
    currentDay: 30,
  });
  const r = settleLocalSession({ bars });
  assert.equal(r.ok, true, r.engine && r.engine.message);
  assert.equal(gameState.returnPct, '10.00');
  assert.equal(gameState.returnPpm, 100000);
  assert.equal(gameState.position, 'empty');
});

test('settleLocalSession silent when not ready', () => {
  const bars = seedClassicWindow({ actions: ['hold'] });
  const r = settleLocalSession({ bars });
  assert.equal(r.ok, false);
  assert.equal(r.silent, true);
});

test('buildCloudFinishBody shapes legacy / event-v1 / puzzle', () => {
  resetSession();
  patchSession({
    actions: ['buy', 'hold'],
    protocolVersion: null,
    gameKind: null,
    revision: 0,
  });
  const legacy = buildCloudFinishBody(getSession());
  assert.equal(legacy.isPuzzle, false);
  assert.equal(legacy.isEventV1, false);
  assert.equal(legacy.body.finish, true);
  assert.deepEqual(legacy.body.actions, [
    { day: 1, action: 'buy' },
    { day: 2, action: 'hold' },
  ]);

  patchSession({ protocolVersion: 'event-v1', revision: 7 });
  const ev = buildCloudFinishBody(getSession());
  assert.equal(ev.isEventV1, true);
  assert.deepEqual(ev.body, { finish: true, expectedRevision: 7 });

  patchSession({ gameKind: 'puzzle', protocolVersion: 'event-v1' });
  const pz = buildCloudFinishBody(getSession());
  assert.equal(pz.isPuzzle, true);
  assert.equal(pz.isEventV1, false);
  assert.equal(pz.body.finish, true);
  assert.ok(Array.isArray(pz.body.actions));
});

test('sessionPatchFromCloudFinish maps classic + puzzle fields', () => {
  const classic = sessionPatchFromCloudFinish(
    { returnPpm: 1000, returnPct: '0.10', assistClass: 'clean', undoCount: 0 },
    { isPuzzle: false }
  );
  assert.equal(classic.saveStatus, 'saved');
  assert.equal(classic.returnPpm, 1000);
  assert.equal(classic.returnPct, '0.10');
  assert.equal(classic.assistClass, 'clean');
  assert.equal(classic.puzzleResult, undefined);

  const puzzle = sessionPatchFromCloudFinish(
    { stars: 3, levelKey: 'ch1-01', reward: { grantedThisTime: true } },
    { isPuzzle: true }
  );
  assert.equal(puzzle.puzzleResult.stars, 3);
  assert.equal(puzzle.puzzleLevelKey, 'ch1-01');
});

test('puzzlePositionFromState encodes T+1 lock', () => {
  assert.equal(puzzlePositionFromState(0, 1, null, 1), 'empty');
  assert.equal(puzzlePositionFromState(100, 1, 1, 2), 'locked');
  assert.equal(puzzlePositionFromState(100, 2, 1, 2), 'holding');
});
