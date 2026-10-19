/** Track R3 — 后悔券 client helpers, rewind session patch, wheel substitute copy. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalizeItems,
  rewindButtonMode,
  defaultPayWith,
  ticketConfirmCopy,
  rewindToast,
  ticketChip,
  inventoryLine,
} from '../js/rewind-tickets-pure.js';
import { prizeCopy, substituteLine } from '../js/lucky-wheel-pure.js';
import { gameState } from '../js/state.js';
import { resetSession, patchSession, selectSettleView } from '../js/game-session.js';
import { makeBars } from '../shared/fixtures/golden.js';
import { applyLocalDecision, applyRewindServerResult } from '../js/game-play-usecase.js';

test('normalizeItems: old API / garbage ⇒ 0 tickets, clean board, unknown', () => {
  assert.deepEqual(normalizeItems(null), { tickets: 0, board: 'clean', known: false });
  assert.deepEqual(normalizeItems({}), { tickets: 0, board: 'clean', known: false });
  assert.deepEqual(normalizeItems({ rewindTickets: -3 }), { tickets: 0, board: 'clean', known: true });
  assert.deepEqual(normalizeItems({ rewindTickets: 2.5 }), { tickets: 0, board: 'clean', known: true });
  assert.deepEqual(normalizeItems({ rewindTickets: 3, rewindTicketBoard: 'undo' }), { tickets: 3, board: 'undo', known: true });
  assert.equal(normalizeItems({ rewindTickets: 1, rewindTicketBoard: 'weird' }).board, 'clean');
});

test('rewind button label: 券×N with tickets, legacy coin label otherwise', () => {
  assert.deepEqual(rewindButtonMode(2), { mode: 'ticket', text: '反悔 · 券×2', key: 't2' });
  assert.equal(rewindButtonMode(0).mode, 'coin');
  assert.equal(rewindButtonMode(undefined).mode, 'coin');
  assert.notEqual(rewindButtonMode(1).key, rewindButtonMode(2).key, 'count change re-hydrates');
  assert.equal(defaultPayWith(1), 'ticket');
  assert.equal(defaultPayWith(0), 'coin');
});

test('confirm copy: default board says 普通对局; undo board says 反悔局', () => {
  const c = ticketConfirmCopy({ tickets: 3, targetDay: 7 });
  assert.equal(c, '使用 1 张后悔券（剩 2 张），回到第 7 日。本局仍按普通对局计入排行榜，每局限一次。');
  assert.match(c, /本局仍按普通对局计入排行榜/);
  assert.match(ticketConfirmCopy({ tickets: 1, targetDay: 2, board: 'undo' }), /剩 0 张.*本局将记为反悔局/);
});

test('toast / chip / inventory copy', () => {
  assert.equal(rewindToast('coin'), '已回到上一决策日（本局记为反悔）');
  assert.equal(rewindToast(undefined), '已回到上一决策日（本局记为反悔）');
  assert.equal(rewindToast('ticket'), '已回到上一决策日（后悔券 −1）');
  assert.equal(ticketChip({ rewindVia: 'ticket' }), '用过后悔券');
  assert.equal(ticketChip({ rewindVia: null }), null);
  assert.equal(ticketChip(null), null);
  assert.equal(inventoryLine(4), '后悔券 ×4');
  assert.equal(inventoryLine(-1), '后悔券 ×0');
});

function seed() {
  resetSession({ fillMode: 'next_open' });
  const bars = makeBars({ 2: { open: 10, close: 10 }, 3: { open: 11, close: 11 } });
  patchSession({ gameKline: bars, historyLength: 1, gameDays: 5, currentDay: 1, cash: 100000, shares: 0 });
  return bars;
}

test('applyRewindServerResult: ticket rewind keeps clean board and records rewindVia', () => {
  const bars = seed();
  assert.equal(applyLocalDecision('buy', { bars }).ok, true);
  assert.equal(applyLocalDecision('hold', { bars }).ok, true);
  patchSession({ protocolVersion: 'event-v1', revision: 2, undoCount: 0, assistClass: 'clean' });
  const r = applyRewindServerResult(
    { actions: ['buy'], revision: 3, undoCount: 1, assistClass: 'clean', rewindVia: 'ticket', paidWith: 'ticket', ticketsLeft: 2, protocolVersion: 'event-v1' },
    { bars }
  );
  assert.equal(r.ok, true);
  assert.equal(r.paidWith, 'ticket');
  assert.equal(r.ticketsLeft, 2);
  assert.equal(r.balanceAfter, undefined);
  assert.equal(gameState.assistClass, 'clean');
  assert.equal(gameState.rewindVia, 'ticket');
  assert.equal(gameState.undoCount, 1);
  assert.equal(selectSettleView().rewindVia, 'ticket');
});

test('applyRewindServerResult: no assistClass in response keeps the session board (no invented undo)', () => {
  const bars = seed();
  applyLocalDecision('buy', { bars });
  applyLocalDecision('hold', { bars });
  patchSession({ protocolVersion: 'event-v1', revision: 2, undoCount: 0, assistClass: 'clean' });
  const r = applyRewindServerResult({ actions: ['buy'], revision: 3, undoCount: 1, paidWith: 'ticket', protocolVersion: 'event-v1' }, { bars });
  assert.equal(r.ok, true);
  assert.equal(gameState.assistClass, 'clean');
  assert.equal(gameState.rewindVia, 'ticket');
});

test('applyRewindServerResult: coin rewind unchanged (undo, no rewindVia)', () => {
  const bars = seed();
  applyLocalDecision('buy', { bars });
  applyLocalDecision('hold', { bars });
  patchSession({ protocolVersion: 'event-v1', revision: 2, undoCount: 0, assistClass: 'clean' });
  const r = applyRewindServerResult({ actions: ['buy'], revision: 3, undoCount: 1, assistClass: 'undo', balanceAfter: 450, protocolVersion: 'event-v1' }, { bars });
  assert.equal(r.paidWith, 'coin');
  assert.equal(r.balanceAfter, 450);
  assert.equal(gameState.assistClass, 'undo');
  assert.equal(gameState.rewindVia, null);
});

test('wheel substitute copy by server reason', () => {
  assert.equal(substituteLine('ticket_daily_cap'), '今日后悔券已达上限，已折算为韭币');
  assert.equal(substituteLine('ticket_hold_cap'), '后悔券持有已达上限，已折算为韭币');
  assert.equal(substituteLine('spin_cap'), '今日再转次数已达上限，已折算为韭币');
  assert.equal(substituteLine('items_unavailable'), '道具暂时无法发放，已折算为韭币');
  assert.equal(substituteLine(undefined, 'spin'), '今日再转次数已达上限，已折算为韭币');
  assert.equal(substituteLine(undefined), '奖品已折算为韭币');
  const c = prizeCopy({ kind: 'jiu_coin', amount: 58, substituted: true, substituteReason: 'ticket_daily_cap', drawnKind: 'item' });
  assert.equal(c.amount, 58);
  assert.deepEqual(c.lines, ['今日后悔券已达上限，已折算为韭币']);
  const t = prizeCopy({ kind: 'item', itemType: 'rewind_ticket', label: '后悔券', qty: 3 });
  assert.equal(t.kind, 'ticket');
  assert.equal(t.headline, '后悔券 ×3');
});

test('coin confirm copy in game.js is byte-identical to the pre-Track-R string', () => {
  const src = readFileSync(new URL('../js/game.js', import.meta.url), 'utf8');
  assert.ok(src.includes('`<p>消耗 ${amountWithCoinHtml(cost, { size: 14 })}，回到上一决策日。本局将记为反悔结果，每局限一次。</p>`'));
  assert.ok(src.includes('`反悔 ${amountWithCoinHtml(50, { size: 12 })}`'));
});

test('icon slot is untouched (icon-unification owns .rewind-btn-icon)', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /class="rewind-btn-icon"/);
  const game = readFileSync(new URL('../js/game.js', import.meta.url), 'utf8');
  assert.ok(!/querySelector\([^)]*rewind-btn-icon/.test(game), 'game.js must not write the icon slot');
});

test('rewindCloudGame: coin body unchanged, ticket adds payWith', () => {
  const src = readFileSync(new URL('../js/game-sync.js', import.meta.url), 'utf8');
  assert.ok(src.includes('payWith === "ticket" ? { expectedRevision, payWith: "ticket" } : { expectedRevision }'));
});
