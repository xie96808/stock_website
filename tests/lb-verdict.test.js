import test from 'node:test';
import assert from 'node:assert/strict';
import { resultVerdict, boardLabel } from '../js/lb-verdict.js';

const board = { rank: 13, total: 15, fillMode: 'next_open', assistClass: 'clean', gameKind: 'classic' };

test('best game: keeps rank + beat copy', () => {
  const v = resultVerdict({ status: 'counted', isBest: true, assistClass: 'clean' }, board);
  assert.equal(v.kind, 'best');
  assert.equal(v.beat, 13);
  assert.match(v.text, /#13/);
  assert.match(v.text, /超越约 13%/);
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
