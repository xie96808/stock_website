import test from "node:test";
import assert from "node:assert/strict";
import { makeBars } from "../../../shared/fixtures/golden.js";
import { pvpMatchView } from "../../src/lib/pvp/view.js";

function history() {
  return makeBars();
}

function snapshot(gameBars) {
  return {
    stockCode: "600000",
    stockName: "浦发银行",
    stockIndex: 4,
    windowStartIndex: 80,
    history: history().map((bar, index) => ({ ...bar, date: `2019-03-${String(index + 1).padStart(2, "0")}`, volume: 10 })),
    bars: gameBars,
  };
}

function matchOf(snap, extra = {}) {
  return {
    id: "match-1",
    status: "playing",
    revision: 4,
    resolved_rounds: 0,
    round_opens_at: 1_000,
    round_deadline_at: 31_000,
    snapshot_json: JSON.stringify(snap),
    ...extra,
  };
}

const players = [
  { user_id: 1, actions_json: "[]" },
  { user_id: 2, actions_json: "[]" },
];

test("R06 a pending lock does not move NAV or reveal the opponent action", () => {
  const bars = makeBars({ 1: { open: 10, close: 10 }, 2: { open: 20, close: 22 } });
  const view = pvpMatchView({
    match: matchOf(snapshot(bars)),
    players,
    viewerId: 1,
    serverNow: 2_000,
    pendingLocks: { 1: "buy" },
    nicknames: { 2: "对手甲" },
  });
  assert.equal(view.me.lockedAction, "buy");
  assert.equal(view.me.mtmPpm, 0);
  assert.equal(view.opponent.lockedToday, false);
  assert.equal(view.opponent.lockedAction, undefined);
  assert.equal(view.opponent.mtmPpm, 0);
  assert.equal(view.market.bars.length, 1);
  assert.equal(view.market.bars[0].label, "d1");
  assert.equal(view.market.bars[0].close, 100);
  assert.equal(view.resolvedActions.length, 0);

  const other = pvpMatchView({
    match: matchOf(snapshot(bars)),
    players,
    viewerId: 2,
    serverNow: 2_000,
    pendingLocks: { 1: "buy" },
    nicknames: { 1: "对手乙" },
  });
  assert.equal(other.opponent.lockedToday, true);
  assert.equal(other.opponent.lockedAction, undefined);
  assert.equal(JSON.stringify(other.opponent).includes("buy"), false);
});

test("R07 future bars do not change the in-progress view", () => {
  const leftBars = makeBars({ 1: { open: 10, close: 10 }, 2: { open: 20, close: 12345.67 } });
  const rightBars = makeBars({ 1: { open: 10, close: 10 }, 2: { open: 7, close: 8 }, 30: { open: 3, close: 4 } });
  leftBars[0].volume = 10;
  rightBars[0].volume = 10;
  leftBars[1].volume = 99999;
  rightBars[1].volume = 1;
  const left = snapshot(leftBars);
  const right = snapshot(rightBars);
  left.stockCode = "600000";
  right.stockCode = "000001";
  right.stockName = "平安银行";
  const args = (snap) => ({
    match: matchOf(snap, { id: "same-match" }),
    players,
    viewerId: 1,
    serverNow: 2_000,
    pendingLocks: {},
    nicknames: { 2: "对手甲" },
  });
  const a = pvpMatchView(args(left));
  const b = pvpMatchView(args(right));
  assert.deepEqual(a, b);
  const text = JSON.stringify(a);
  assert.equal(text.includes("600000"), false);
  assert.equal(text.includes("12345"), false);
  assert.equal(text.includes("2019-03"), false);
  assert.equal(text.includes("stockIndex"), false);
  assert.equal(a.market.history.length, 30);
  assert.equal(a.market.bars[0].volume, 1);
});

test("a completed match reveals identity and all 30 bars; a forfeit does not", () => {
  const bars = makeBars({ 1: { open: 10, close: 10 }, 2: { open: 20, close: 22 } });
  const played = players.map((player) => ({ ...player, actions_json: JSON.stringify(Array.from({ length: 29 }, () => "hold")) }));
  const done = pvpMatchView({
    match: matchOf(snapshot(bars), { status: "settled", resolved_rounds: 29 }),
    players: played,
    viewerId: 1,
    serverNow: 90_000,
    terminalType: "completed",
    nicknames: { 2: "对手甲" },
  });
  assert.equal(done.identity.stockCode, "600000");
  assert.equal(done.market.bars.length, 30);
  assert.equal(done.round, null);

  const stopped = pvpMatchView({
    match: matchOf(snapshot(bars), { status: "settled", resolved_rounds: 1 }),
    players: [
      { user_id: 1, actions_json: '["buy"]' },
      { user_id: 2, actions_json: '["hold"]' },
    ],
    viewerId: 1,
    serverNow: 90_000,
    terminalType: "forfeited",
    nicknames: { 2: "对手甲" },
  });
  assert.equal(stopped.identity, undefined);
  assert.equal(stopped.market.bars.length, 2);
  assert.equal(stopped.me.mtmPpm, 100000);
  assert.equal(JSON.stringify(stopped).includes("600000"), false);
});
