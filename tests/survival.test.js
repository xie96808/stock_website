import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkSurvivalBust,
  survivalFloatHud,
  survivalLimits,
} from '../shared/survival.js';
import { SURVIVAL_MODIFIERS } from '../shared/protocol.js';
import { formatPlayHudChrome } from '../js/puzzle-goals-copy.js';
import { evaluateRewindEligibility } from '../js/game-play-usecase.js';
import { resetSession, patchSession, getSession } from '../js/game-session.js';
import { replayGame } from '../shared/engine.js';

const html = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.html'),
  'utf8'
);

test('bust is vs start NAV −20% (ppm), not peak MDD', () => {
  assert.deepEqual(survivalLimits(null), SURVIVAL_MODIFIERS);
  // Exactly −20% → bust
  const atLine = checkSurvivalBust(-200000, null);
  assert.equal(atLine.busted, true);
  assert.equal(atLine.bustBasis, 'start_nav');
  // Just above line → alive
  assert.equal(checkSurvivalBust(-199999, null).busted, false);
  // Flat after a big peak drawdown from peak is still OK vs start
  assert.equal(checkSurvivalBust(0, null).busted, false);
  // −15% vs start OK even if peak MDD would look worse in isolation
  assert.equal(checkSurvivalBust(-150000, null).busted, false);
  // Deep loss vs start → bust
  assert.equal(checkSurvivalBust(-250000, null).busted, true);
});

test('engine returnPpm is start-NAV relative (rise then give-back ≠ bust)', () => {
  // Construct bars: buy day1 same_close @100, rally to 150, give back to 100.
  const bars = [];
  for (let i = 0; i < 30; i++) {
    let c = 100;
    if (i >= 1 && i < 5) c = 100 + i * 10; // peak 140
    else if (i >= 5) c = 100;
    bars.push({ open: c, high: c, low: c, close: c });
  }
  const actions = ['buy', ...Array(10).fill('hold')];
  const r = replayGame({ fillMode: 'same_close', bars, actions, finish: false });
  assert.equal(r.ok, true);
  // Back to entry → ~0 vs start, despite peak MDD from 140→100
  assert.ok(Math.abs(r.returnPpm) < 1000, `returnPpm=${r.returnPpm}`);
  assert.equal(checkSurvivalBust(r.returnPpm, null).busted, false);
});

test('engine returnPpm busts when mark is ≤ −20% vs start', () => {
  const bars = [];
  for (let i = 0; i < 30; i++) {
    const c = i === 0 ? 100 : 79; // −21% from entry
    bars.push({ open: c, high: c, low: c, close: c });
  }
  const r = replayGame({
    fillMode: 'same_close',
    bars,
    actions: ['buy', 'hold'],
    finish: false,
  });
  assert.equal(r.ok, true);
  assert.ok(r.returnPpm <= -200000, `returnPpm=${r.returnPpm}`);
  assert.equal(checkSurvivalBust(r.returnPpm, null).busted, true);
});

test('survivalFloatHud warns near −20% line', () => {
  const ok = survivalFloatHud(0, null);
  assert.equal(ok.warn, false);
  assert.match(ok.label, /相对开局/);
  const near = survivalFloatHud(-160000, null);
  assert.equal(near.warn, true);
  const bust = survivalFloatHud(-210000, null);
  assert.equal(bust.warn, true);
  assert.equal(bust.progress01, 0);
});

test('formatPlayHudChrome survival badge', () => {
  const hud = formatPlayHudChrome({
    gameKind: 'survival',
    survivalFloat: { label: '相对开局 -5.00% · 爆仓线 -20%' },
  });
  assert.equal(hud.isSurvival, true);
  assert.equal(hud.badge, '活过三十日');
  assert.match(hud.subtitle, /相对开局/);
});

test('rewind ineligible for survival', () => {
  resetSession();
  patchSession({
    gameKind: 'survival',
    modifiers: { bustNavPpm: -200000, bustBasis: 'start_nav' },
    actions: ['hold'],
    position: 'empty',
    currentDay: 2,
    gameDays: 30,
    cloudMode: true,
    protocolVersion: 'event-v1',
    undoCount: 0,
  });
  const elig = evaluateRewindEligibility(getSession(), { gameRewind: true });
  assert.equal(elig.eligible, false);
  assert.equal(elig.reason, 'survival');
});

test('L3 survival card CTA and cost 20; hidden by default id', () => {
  const play = html.split('id="playModes"')[1].split('id="puzzleChapters"')[0];
  assert.match(play, /id="survivalModeCard"/);
  assert.match(play, /开始生存模式/);
  assert.match(play, /活过三十日/);
  assert.match(play, /data-jiu-price="20"/);
  assert.match(play, /hidden onclick="startSurvivalGame\(\)"/);
  assert.match(html, /id="survivalNavMeter"/);
});
