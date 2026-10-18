import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  isResumableActive, resumeModeLabel, resumeFillLabel, resumeDay, resumeMetaText,
} from '../js/resume-meta.js';

test('only active normal-mode / daily sessions are resumable', () => {
  assert.equal(isResumableActive(null), false);
  assert.equal(isResumableActive({ gameId: 'a', status: 'settled', gameKind: 'classic' }), false);
  assert.equal(isResumableActive({ gameId: 'a', status: 'abandoned' }), false);
  assert.equal(isResumableActive({ gameId: 'a', status: 'expired' }), false);
  assert.equal(isResumableActive({ status: 'active' }), false);
  for (const k of [undefined, 'classic', 'oneshot', 'survival', 'daily']) {
    assert.equal(isResumableActive({ gameId: 'a', status: 'active', gameKind: k }), true, String(k));
  }
  assert.equal(isResumableActive({ gameId: 'a', status: 'active', gameKind: 'puzzle' }), false);
  assert.equal(isResumableActive({ gameId: 'a', status: 'active', gameKind: 'ghost' }), false);
});

test('labels per mode and fill mode', () => {
  assert.equal(resumeModeLabel({ gameKind: 'oneshot' }), '一把梭');
  assert.equal(resumeModeLabel({ gameKind: 'survival' }), '生存模式');
  assert.equal(resumeModeLabel({ gameKind: 'daily' }), '今日挑战');
  assert.equal(resumeModeLabel({}), '经典练习');
  assert.equal(resumeFillLabel({ fillMode: 'same_close' }), '当日收盘');
  assert.equal(resumeFillLabel({ fillMode: 'next_open' }), '次日开盘');
  assert.equal(resumeFillLabel({ gameKind: 'daily', fillMode: 'next_open' }), '');
});

test('day = decided actions + 1, server state wins, unknown stays unknown', () => {
  assert.deepEqual(resumeDay({ state: { actions: ['hold', 'buy'], gameDays: 30 } }), { day: 3, total: 30, ready: false });
  assert.deepEqual(resumeDay({ state: { actions: new Array(29).fill('hold'), readyToSettle: true, gameDays: 30 } }), { day: 30, total: 30, ready: true });
  assert.deepEqual(resumeDay({ state: { actions: ['hold'], gameDays: 30 }, draftActions: ['a', 'b', 'c'] }), { day: 2, total: 30, ready: false });
  assert.deepEqual(resumeDay({ draftActions: ['hold', 'hold', 'buy'], total: 30 }), { day: 4, total: 30, ready: false });
  assert.equal(resumeDay({}), null);
  assert.equal(resumeDay({ draftActions: [] }), null);
});

test('banner text never leaks stock identity', () => {
  const active = { gameKind: 'classic', fillMode: 'next_open', stockName: '恒逸石化', stockCode: '000703' };
  const t = resumeMetaText(active, { day: 7, total: 30, ready: false });
  assert.equal(t, '经典练习 · 次日开盘 · 第 7/30 天');
  assert.ok(!t.includes('恒逸') && !t.includes('000703'));
  assert.equal(resumeMetaText({ gameKind: 'daily' }, null), '今日挑战');
});

test('banner wiring: markup ids, no browser dialogs, hidden on startGame', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const id of ['resumeGameBanner', 'resumeGameBannerMeta', 'resumeGameContinueBtn', 'resumeGameAbandonBtn']) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
  const js = readFileSync(new URL('../js/resume-banner.js', import.meta.url), 'utf8');
  assert.ok(!/\b(alert|confirm|prompt)\(/.test(js.replace(/ctlConfirm\(/g, '')));
  assert.ok(js.includes('/games/active') && js.includes('abandonCloudGame'));
  const game = readFileSync(new URL('../js/game.js', import.meta.url), 'utf8');
  assert.ok(/export async function startGame[\s\S]{0,80}hideResumeBanner\(\)/.test(game));
});
