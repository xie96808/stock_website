import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { prepareTestEnv } from "../helpers.js";
import { NOW, balanceOf, pvpLedger, seedUser } from "./fixture.js";

prepareTestEnv();

const { openDb, closeDb } = await import("../../src/db/connection.js");
const { migrate } = await import("../../src/db/migrate.js");
const { config } = await import("../../src/lib/config.js");
const { decideAction, pickBotDelayMs, smaNullPad } = await import("../../../shared/pvpBotPolicy.js");
const { createChallenge, markReady } = await import("../../src/lib/pvp/challenges.js");
const {
  botsFeatureOn,
  ensureBotsSeeded,
  botMatchAllowed,
  countActiveBotMatches,
  listIdleBotEntries,
  listBotUsers,
} = await import("../../src/lib/pvp/botUsers.js");
const { clearBotSchedules, tickBots } = await import("../../src/lib/pvp/bots.js");
const { forfeitMatch, lockAction } = await import("../../src/lib/pvp/match.js");
const { listLobby, lobbySummary } = await import("../../src/lib/pvp/lobby.js");

config.pvpBattleEnabled = true;
config.pvpBotsEnabled = true;
config.pvpMaxBotMatches = 3;
config.pvpHumanRoomReserve = 2;
config.pvpBotTier = "normal";

migrate();
const db = openDb();
ensureBotsSeeded(db);
let keyN = 0;

test.after(() => {
  clearBotSchedules();
  config.pvpBotsEnabled = false;
  closeDb();
});

function key(label) {
  keyN += 1;
  return `bot-${label}-${keyN}-0123456789abcdef`;
}

function user(label, extra = {}) {
  return seedUser(db, { name: `${label}-${crypto.randomUUID()}`, ...extra });
}

function firstBot() {
  const bots = listBotUsers(db);
  assert.ok(bots.length >= 3);
  return bots[0];
}

test("policy: MA helper and delays", () => {
  const ma = smaNullPad([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5);
  assert.equal(ma[3], null);
  assert.equal(ma[4], 3);
  const bars = Array.from({ length: 30 }, (_, i) => ({
    open: 100 + i,
    high: 101 + i,
    low: 99 + i,
    close: 100 + i,
    volume: 1000,
  }));
  const action = decideAction({
    bars,
    priorActions: [],
    revealedBars: 10,
    tier: "normal",
    rng: () => 0.9,
  });
  assert.ok(["buy", "sell", "hold"].includes(action));
  assert.equal(pickBotDelayMs({ dayMs: 30_000, humanLocked: false, rng: () => 0 }), 1500);
  assert.equal(pickBotDelayMs({ dayMs: 30_000, humanLocked: true, rng: () => 0 }), 500);
});

test("seeded bots appear after humans when flag on; flag off hides them", () => {
  config.pvpBotsEnabled = true;
  assert.equal(botsFeatureOn(), true);
  const human = user("lobby-h");
  const summary = lobbySummary(db, NOW, human);
  assert.ok(summary.availableCount >= 3);
  const lobby = listLobby(db, human, { now: NOW, limit: 50 });
  const bots = lobby.entries.filter((e) => e.isBot);
  assert.equal(bots.length, 3);
  assert.deepEqual(
    bots.map((b) => b.nickname).sort(),
    ["做T机器神", "波段菠菜机", "追涨小白条"].sort()
  );
  assert.ok(bots.every((b) => !String(b.title || "").includes("机器人")));
  assert.ok(!JSON.stringify(lobby.entries).includes("机器人"));

  config.pvpBotsEnabled = false;
  assert.equal(listIdleBotEntries(db, human).length, 0);
  assert.equal(lobbySummary(db, NOW, human).availableCount, 0);
  config.pvpBotsEnabled = true;
});

test("challenge bot auto-accepts → ready → charge both → bot lock source=bot → forfeit updates rating", () => {
  config.pvpBotsEnabled = true;
  clearBotSchedules();
  const human = user("eco-h", { balance: 500 });
  const bot = firstBot();
  const beforeBotBal = balanceOf(db, bot.id);
  const beforeHuman = balanceOf(db, human);
  const beforeBotGames = Number(db.prepare(`SELECT games FROM pvp_ratings WHERE user_id = ?`).get(bot.id)?.games) || 0;
  const beforeHumanGames = Number(db.prepare(`SELECT games FROM pvp_ratings WHERE user_id = ?`).get(human)?.games) || 0;

  const created = createChallenge(db, {
    fromUserId: human,
    toUserId: bot.id,
    createKey: key("eco"),
    now: NOW,
  });
  assert.equal(created.ok, true);
  assert.equal(created.autoAccepted, true);
  assert.ok(created.matchId);
  const matchId = created.matchId;
  assert.ok(
    db.prepare(`SELECT ready_at FROM pvp_match_players WHERE match_id = ? AND user_id = ?`).get(matchId, bot.id)
      .ready_at != null
  );

  const started = markReady(db, { matchId, userId: human, now: NOW + 1000 });
  assert.equal(started.ok, true);
  assert.equal(started.status, "playing");
  assert.equal(balanceOf(db, human), beforeHuman - 20);
  assert.equal(balanceOf(db, bot.id), beforeBotBal - 20);

  const match = db.prepare(`SELECT * FROM pvp_matches WHERE id = ?`).get(matchId);
  // First tick arms the human-like delay; second tick after the delay fires the lock.
  assert.equal(tickBots(db, match.round_opens_at + 100).length, 0);
  const tick = tickBots(db, match.round_deadline_at - 1);
  assert.ok(tick.some((row) => row.matchId === matchId && row.ok && row.accepted));
  const botAction = db
    .prepare(`SELECT action, source FROM pvp_actions WHERE match_id = ? AND user_id = ? AND round = 1`)
    .get(matchId, bot.id);
  assert.equal(botAction.source, "bot");
  assert.ok(["buy", "sell", "hold"].includes(botAction.action));

  const humanLock = lockAction(db, {
    matchId,
    userId: human,
    round: 1,
    action: "hold",
    commandKey: key("h1"),
    now: match.round_opens_at + 26_000,
  });
  assert.equal(humanLock.ok, true);

  const forfeited = forfeitMatch(db, {
    matchId,
    userId: human,
    commandKey: key("ff"),
    now: match.round_opens_at + 27_000,
  });
  assert.equal(forfeited.ok, true);

  const ledger = pvpLedger(db, matchId);
  assert.ok(ledger.some((row) => row.user_id === human && row.reason === "pvp_entry" && row.delta === -20));
  assert.ok(ledger.some((row) => row.user_id === bot.id && row.reason === "pvp_entry" && row.delta === -20));
  assert.ok(ledger.some((row) => row.user_id === bot.id && row.reason === "pvp_reward" && row.delta === 35));

  const afterBotGames = Number(db.prepare(`SELECT games FROM pvp_ratings WHERE user_id = ?`).get(bot.id)?.games) || 0;
  const afterHumanGames = Number(db.prepare(`SELECT games FROM pvp_ratings WHERE user_id = ?`).get(human)?.games) || 0;
  assert.equal(afterBotGames, beforeBotGames + 1);
  assert.equal(afterHumanGames, beforeHumanGames + 1);

  const settled = db.prepare(`SELECT status FROM pvp_matches WHERE id = ?`).get(matchId);
  assert.equal(settled.status, "settled");
});

test("bot capacity yields to humans near room cap", () => {
  config.pvpBotsEnabled = true;
  config.pvpMaxBotMatches = 1;
  config.pvpHumanRoomReserve = 2;
  // Drain leftover bot rooms from earlier cases.
  db.prepare(`DELETE FROM pvp_active_members`).run();
  db.prepare(`UPDATE pvp_matches SET status = 'aborted', finished_at = ? WHERE status IN ('waiting_ready','playing')`).run(NOW + 40_000);
  const humanA = user("cap-a");
  const humanB = user("cap-b");
  const bots = listBotUsers(db);
  assert.ok(botMatchAllowed(db));

  const first = createChallenge(db, {
    fromUserId: humanA,
    toUserId: bots[0].id,
    createKey: key("cap1"),
    now: NOW + 50_000,
  });
  assert.equal(first.ok, true);
  assert.ok(countActiveBotMatches(db) >= 1);

  const second = createChallenge(db, {
    fromUserId: humanB,
    toUserId: bots[1].id,
    createKey: key("cap2"),
    now: NOW + 51_000,
  });
  assert.equal(second.ok, false);
  assert.equal(second.code, "CAPACITY");

  config.pvpMaxBotMatches = 3;
});

test("flag off: challenge bot id returns NOT_FOUND", () => {
  config.pvpBotsEnabled = false;
  const human = user("flag-h");
  const bot = listBotUsers(db)[0];
  const denied = createChallenge(db, {
    fromUserId: human,
    toUserId: bot.id,
    createKey: key("flag"),
    now: NOW + 80_000,
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.code, "NOT_FOUND");
  config.pvpBotsEnabled = true;
});
