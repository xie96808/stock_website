import test from 'node:test';
import assert from 'node:assert/strict';
import { resultVerdict, boardLabel, shareBoardQuery, planShareRank, bestGameText } from '../js/lb-verdict.js';

const board = { rank: 13, total: 15, fillMode: 'next_open', assistClass: 'clean', gameKind: 'classic' };

test('best game: keeps rank + beat copy', () => {
  const v = resultVerdict({ status: 'counted', isBest: true, assistClass: 'clean' }, board);
  assert.equal(v.kind, 'best');
  assert.equal(v.beat, 13);
  assert.match(v.text, /^本局已上次日开盘榜 · #13/);
  assert.match(v.text, /超越约 13%/);
});

test('wording: best game is always 「本局已上…榜」 and the beat tail is dropped at 0%', () => {
  assert.equal(bestGameText('次日开盘', 3, 87), '本局已上次日开盘榜 · #3 · 超越约 87% 玩家');
  assert.equal(bestGameText('次日开盘', 16, 0), '本局已上次日开盘榜 · #16');
  assert.equal(bestGameText('一把梭·次日开盘', 1, null), '本局已上一把梭·次日开盘榜 · #1');
  assert.equal(bestGameText('次日开盘', null, null), '本局已上次日开盘榜');
  const last = resultVerdict({ status: 'counted', isBest: true }, { rank: 15, total: 15, fillMode: 'next_open', assistClass: 'clean', gameKind: 'classic' });
  assert.equal(last.text, '本局已上次日开盘榜 · #15');
  assert.doesNotMatch(last.text, /超越/);
  assert.doesNotMatch(last.text, /已入/);
});

test('recorded but not personal best says so explicitly', () => {
  const v = resultVerdict({ status: 'counted', isBest: false, assistClass: 'clean' }, board);
  assert.equal(v.kind, 'recorded');
  assert.match(v.text, /本局已记录/);
});

test('zero-trade / undo / opted-out games get a reason, never silence', () => {
  assert.match(resultVerdict({ status: 'no_trade' }, board).text, /不计入排行榜/);
  assert.match(resultVerdict({ status: 'other_assist_board' }, board).text, /反悔/);
  assert.match(resultVerdict({ status: 'not_opted_in' }, board).text, /不参与排行榜/);
  assert.equal(resultVerdict(null, board), null);
});

test('boardLabel', () => {
  assert.equal(boardLabel('same_close', 'clean', 'classic'), '当日收盘');
  assert.equal(boardLabel('next_open', 'undo', 'classic'), '次日开盘·反悔');
  assert.equal(boardLabel('next_open', null, 'oneshot'), '一把梭·次日开盘');
});

const mineShare = { cloudGameId: 'g-now', gameKind: 'classic', assistClass: 'clean', fillMode: 'next_open' };
const payload = (recent, extra = {}) => ({ total: 15, myRank: 3, assistClass: 'clean', gameKind: 'classic', myRecent: recent, ...extra });

test('NEW-01: all-观望 game gets the not-on-board verdict and NO rank claim', () => {
  const plan = planShareRank(mineShare, payload([
    { gameId: 'g-now', status: 'no_trade', isBest: false },
    { gameId: 'g-old', status: 'counted', isBest: true },
  ]), 'next_open');
  assert.equal(plan.verdict.kind, 'no_trade');
  assert.match(plan.verdict.text, /全程观望（0 笔买入），不计入排行榜/);
  assert.equal(plan.meta, null, 'share caption must not claim a rank for a 0-trade game');
});

test('NEW-01: normal best game -> own rank + beat% (also beyond the Top 10)', () => {
  const plan = planShareRank(mineShare, payload([{ gameId: 'g-now', status: 'counted', isBest: true }], { total: 40, myRank: 16 }), 'next_open');
  assert.equal(plan.verdict.kind, 'best');
  assert.match(plan.verdict.text, /#16/);
  assert.deepEqual(plan.meta, { rank: 16, boardTotal: 40, beatPct: 60 });
  assert.equal(plan.label, '次日开盘');
});

test('NEW-01: counted but not the personal best -> "recorded", no rank claim for this game', () => {
  const plan = planShareRank(mineShare, payload([
    { gameId: 'g-now', status: 'counted', isBest: false },
    { gameId: 'g-old', status: 'counted', isBest: true },
  ]), 'next_open');
  assert.equal(plan.verdict.kind, 'recorded');
  assert.equal(plan.meta, null);
});

test('NEW-01: game not found in myRecent / no game id -> nothing claimed', () => {
  assert.equal(planShareRank(mineShare, payload([{ gameId: 'other', status: 'counted', isBest: true }]), 'next_open').meta, null);
  assert.equal(planShareRank({ ...mineShare, cloudGameId: null }, payload([{ gameId: 'g-now', status: 'counted', isBest: true }]), 'next_open').verdict, null);
  assert.deepEqual(planShareRank(mineShare, null, 'next_open'), { verdict: null, label: null, meta: null });
});

test('NEW-01: undo / oneshot / survival boards are named and queried', () => {
  assert.deepEqual(shareBoardQuery({ gameKind: 'classic', assistClass: 'undo', fillMode: 'same_close' }),
    { fillMode: 'same_close', params: { fillMode: 'same_close', assistClass: 'undo' } });
  assert.deepEqual(shareBoardQuery({ gameKind: 'oneshot', fillMode: 'next_open' }).params, { fillMode: 'next_open', gameKind: 'oneshot' });
  assert.deepEqual(shareBoardQuery({ gameKind: 'survival', assistClass: 'undo' }).params, { fillMode: 'next_open', gameKind: 'survival' });
  assert.deepEqual(shareBoardQuery({ gameKind: null }).params, { fillMode: 'next_open' });
  const undo = planShareRank({ ...mineShare, assistClass: 'undo' }, payload([{ gameId: 'g-now', status: 'counted', isBest: true }], { assistClass: 'undo' }), 'next_open');
  assert.equal(undo.label, '次日开盘·反悔');
  const oneshot = planShareRank({ ...mineShare, gameKind: 'oneshot' }, payload([{ gameId: 'g-now', status: 'counted', isBest: true }], { gameKind: 'oneshot' }), 'next_open');
  assert.equal(oneshot.label, '一把梭·次日开盘');
  const undoElsewhere = planShareRank(mineShare, payload([{ gameId: 'g-now', status: 'other_assist_board', isBest: false }]), 'next_open');
  assert.match(undoElsewhere.verdict.text, /反悔/);
  assert.equal(undoElsewhere.meta, null);
});

test('NEW-01: daily / ghost / puzzle games have no /leaderboard board (never borrow the classic rank)', () => {
  for (const kind of ['daily', 'ghost', 'puzzle']) assert.equal(shareBoardQuery({ gameKind: kind, fillMode: 'next_open' }), null);
});
