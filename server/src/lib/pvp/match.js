import crypto from "node:crypto";
import { replayGame, settleGame } from "../../../../shared/engine.js";
import { buildEquityCurveCash, mddPpmFromCurve } from "../../../../shared/equityCurve.js";
import { PVP_FILL_MODE, visibleMtmPpm } from "../../../../shared/pvpMetrics.js";
import { validCreateKey } from "./challenges.js";
import { REVEAL_GAP_MS } from "./config.js";
import { finishMatchInTx } from "./settlement.js";
import { withImmediate } from "./tx.js";
import { pvpMatchView } from "./view.js";

const STALL_MS = 5_000;
const AFK_LIMIT = 5;
const HEARTBEAT_FRESH_MS = 45_000;
const COMMAND_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ACTIONS = new Set(["buy", "sell", "hold"]);

const heartbeats = new Map();
let commitBarrier = null;

export function noteHeartbeat(userId, now) {
  if (!Number.isInteger(userId) || !Number.isInteger(now)) return;
  heartbeats.set(userId, now);
}

export function clearHeartbeats() {
  heartbeats.clear();
}

/** Test seam: throw from inside a mutating transaction to simulate a crash before commit. */
export function setCommitBarrier(fn) {
  commitBarrier = fn;
}

function touchCommit() {
  if (commitBarrier) commitBarrier();
}

function deny(code, message, status) {
  return { ok: false, code, message, status };
}

function rollbackDeny(code, message, status) {
  const err = new Error(message);
  err.pvpDeny = true;
  err.code = code;
  err.status = status;
  throw err;
}

function sha(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function actionHash(round, action) {
  return sha(JSON.stringify({ round: Number(round), action }));
}

function parseActions(raw, k) {
  let list = [];
  if (Array.isArray(raw)) list = raw;
  else {
    try {
      const parsed = JSON.parse(raw || "[]");
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      list = [];
    }
  }
  return list.slice(0, k);
}

function barsOf(match) {
  try {
    const snapshot = JSON.parse(match.snapshot_json || "null");
    return Array.isArray(snapshot?.bars) ? snapshot.bars : null;
  } catch {
    return null;
  }
}

function playersOf(db, matchId) {
  return db.prepare(`SELECT * FROM pvp_match_players WHERE match_id = ? ORDER BY seat ASC`).all(matchId);
}

function freshHeartbeat(userId, now) {
  const at = heartbeats.get(userId);
  return at != null && now >= at && now - at <= HEARTBEAT_FRESH_MS;
}

function catchDeny(err) {
  if (err?.pvpDeny) return deny(err.code, err.message, err.status);
  throw err;
}

function mustFinish(db, args) {
  const finished = finishMatchInTx(db, args);
  if (!finished.ok) {
    const err = new Error(finished.message || "pvp finish failed");
    err.code = finished.code || "BAD_MATCH";
    err.status = finished.status || 500;
    throw err;
  }
  return finished;
}

function storeCommand(db, { userId, scope, key, hash, resourceId, ack, now }) {
  db.prepare(
    `INSERT INTO pvp_commands (
      user_id, scope, key, payload_hash, resource_id, ack_json, created_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, scope, key, hash, resourceId, JSON.stringify(ack), now, now + COMMAND_TTL_MS);
}

function readCommand(db, userId, scope, key) {
  return db.prepare(`SELECT * FROM pvp_commands WHERE user_id = ? AND scope = ? AND key = ?`).get(userId, scope, key);
}

function rememberPartial(db, match, players) {
  const bars = barsOf(match);
  if (!bars) return;
  const write = db.prepare(
    `UPDATE pvp_match_players SET partial_return_ppm = ? WHERE match_id = ? AND user_id = ?`
  );
  for (const player of players) {
    const nav = visibleMtmPpm({ bars, actions: parseActions(player.actions_json, match.resolved_rounds) });
    if (!nav.ok) return;
    write.run(nav.visibleMtmPpm, match.id, player.user_id);
  }
}

function ensureTimeout(db, matchId, userId, round, now) {
  db.prepare(
    `INSERT INTO pvp_actions (match_id, user_id, round, action, source, locked_at)
     VALUES (?, ?, ?, 'hold', 'timeout', ?)`
  ).run(matchId, userId, round, now);
}

function saveStreak(db, matchId, userId, streak) {
  db.prepare(`UPDATE pvp_match_players SET afk_streak = ? WHERE match_id = ? AND user_id = ?`).run(streak, matchId, userId);
}

function metricsFor(bars, actions) {
  const nav = visibleMtmPpm({ bars, actions });
  if (!nav.ok || !Number.isInteger(nav.finalReturnPpm)) return null;
  let curve;
  try {
    curve = buildEquityCurveCash({ fillMode: PVP_FILL_MODE, bars, actions, finish: true });
  } catch {
    return null;
  }
  const settled = settleGame({ fillMode: PVP_FILL_MODE, bars, actions });
  if (settled.ok !== true || settled.returnPpm !== nav.finalReturnPpm) return null;
  const mddPpm = mddPpmFromCurve(curve);
  if (!Number.isInteger(mddPpm) || !Number.isInteger(settled.tradeCount)) return null;
  return { returnPpm: nav.finalReturnPpm, mddPpm, tradeCount: settled.tradeCount, visible: nav.visibleMtmPpm };
}

/**
 * Idempotent round resolver. Timer, the second lock, and REST sync all call this.
 * Priority: system stall, both unavailable / both AFK, one side, then advance or finish.
 */
export function resolveIfDue(db, { matchId, now }) {
  try {
    return withImmediate(db, () => resolveInTx(db, { matchId, now }));
  } catch (err) {
    return catchDeny(err);
  }
}

export function scanDueMatches(db, now) {
  const due = db
    .prepare(
      `SELECT id FROM pvp_matches
       WHERE status = 'playing' AND round_deadline_at IS NOT NULL AND round_deadline_at <= ?`
    )
    .all(now);
  return due.map((row) => {
    try {
      return { matchId: row.id, ...resolveIfDue(db, { matchId: row.id, now }) };
    } catch (err) {
      console.error("pvp resolve failed:", err && err.message ? err.message : err);
      return { ok: false, matchId: row.id, code: "RESOLVE_FAILED", message: "裁决失败", status: 500 };
    }
  });
}

function resolveInTx(db, { matchId, now }) {
  const match = db.prepare(`SELECT * FROM pvp_matches WHERE id = ?`).get(matchId);
  if (!match || match.status !== "playing") {
    return { ok: true, unchanged: true, status: match?.status || null };
  }
  const k = match.resolved_rounds;
  if (k >= 29) return { ok: true, unchanged: true };
  const round = k + 1;
  const players = playersOf(db, matchId);
  if (players.length !== 2) return deny("BAD_MATCH", "对局人数异常", 500);

  const existing = db.prepare(`SELECT * FROM pvp_actions WHERE match_id = ? AND round = ?`).all(matchId, round);
  const byUser = new Map(existing.map((row) => [row.user_id, row]));
  const bothLocked = players.every((player) => byUser.has(player.user_id));
  const deadline = match.round_deadline_at;
  if (!bothLocked && (deadline == null || now < deadline)) {
    return { ok: true, waiting: true };
  }
  if (deadline != null && now - deadline > STALL_MS) {
    const finished = mustFinish(db, { matchId, terminalType: "aborted", reason: "system_stall", now });
    touchCommit();
    return { ok: true, finished: true, reason: "system_stall", settlement: finished };
  }

  const statuses = new Map(
    db.prepare(`SELECT id, status FROM users WHERE id IN (?, ?)`).all(players[0].user_id, players[1].user_id)
      .map((row) => [row.id, row.status])
  );
  const seats = players.map((player) => {
    const row = byUser.get(player.user_id);
    const source = row ? row.source : "timeout";
    const action = row ? row.action : "hold";
    const streak = source === "player" || freshHeartbeat(player.user_id, now)
      ? (source === "player" ? 0 : player.afk_streak)
      : player.afk_streak + 1;
    return {
      player,
      action,
      source,
      existing: !!row,
      streak,
      unavailable: statuses.get(player.user_id) !== "active",
    };
  });

  const endOut = (terminalType, reason, winnerUserId = null) => {
    for (const seat of seats) {
      if (!seat.existing) ensureTimeout(db, matchId, seat.player.user_id, round, now);
      saveStreak(db, matchId, seat.player.user_id, seat.streak);
    }
    rememberPartial(db, match, players);
    const finished = mustFinish(db, { matchId, terminalType, reason, winnerUserId, now });
    touchCommit();
    return { ok: true, finished: true, reason, settlement: finished };
  };

  if (seats.every((seat) => seat.unavailable)) return endOut("aborted", "both_unavailable");
  if (seats.every((seat) => seat.streak >= AFK_LIMIT)) return endOut("aborted", "both_afk");
  const unavailable = seats.find((seat) => seat.unavailable);
  if (unavailable) {
    const winner = seats.find((seat) => seat !== unavailable);
    return endOut("forfeited", "account_unavailable", winner.player.user_id);
  }
  const afk = seats.find((seat) => seat.streak >= AFK_LIMIT);
  if (afk) {
    const winner = seats.find((seat) => seat !== afk);
    return endOut("forfeited", "afk", winner.player.user_id);
  }

  const bars = barsOf(match);
  const sequences = seats.map((seat) => ({
    ...seat,
    actions: [...parseActions(seat.player.actions_json, k), seat.action],
  }));
  const navs = bars ? sequences.map((seat) => visibleMtmPpm({ bars, actions: seat.actions })) : [];
  if (!bars || navs.some((nav) => !nav.ok)) {
    const finished = mustFinish(db, { matchId, terminalType: "aborted", reason: "mtm_mismatch", now });
    touchCommit();
    return { ok: true, finished: true, reason: "mtm_mismatch", settlement: finished };
  }

  for (const seat of seats) {
    if (!seat.existing) ensureTimeout(db, matchId, seat.player.user_id, round, now);
  }

  if (round === 29) {
    const metrics = {};
    for (const seat of sequences) {
      const metric = metricsFor(bars, seat.actions);
      if (!metric) {
        const finished = mustFinish(db, { matchId, terminalType: "aborted", reason: "mtm_mismatch", now });
        touchCommit();
        return { ok: true, finished: true, reason: "mtm_mismatch", settlement: finished };
      }
      metrics[seat.player.user_id] = metric;
    }
    const write = db.prepare(
      `UPDATE pvp_match_players
       SET actions_json = ?, afk_streak = ?, partial_return_ppm = ?, trade_count = ?
       WHERE match_id = ? AND user_id = ?`
    );
    for (const seat of sequences) {
      const metric = metrics[seat.player.user_id];
      write.run(
        JSON.stringify(seat.actions),
        seat.streak,
        metric.visible,
        metric.tradeCount,
        matchId,
        seat.player.user_id
      );
    }
    insertRound(db, matchId, round, now, sequences, metrics);
    const advanced = db.prepare(
      `UPDATE pvp_matches SET resolved_rounds = 29, revision = revision + 1
       WHERE id = ? AND status = 'playing' AND resolved_rounds = ?`
    ).run(matchId, k);
    if (advanced.changes !== 1) rollbackDeny("MATCH_CLOSED", "这一轮已经裁决", 409);
    const finished = mustFinish(db, { matchId, terminalType: "completed", reason: "completed", metrics, now });
    touchCommit();
    return { ok: true, finished: true, reason: finished.reason, settlement: finished };
  }

  const economy = JSON.parse(match.economy_json || "null");
  const dayMs = economy?.dayMs;
  if (!Number.isInteger(dayMs) || dayMs <= 0) {
    const finished = mustFinish(db, { matchId, terminalType: "aborted", reason: "mtm_mismatch", now });
    touchCommit();
    return { ok: true, finished: true, reason: "mtm_mismatch", settlement: finished };
  }
  const write = db.prepare(
    `UPDATE pvp_match_players SET actions_json = ?, afk_streak = ?, partial_return_ppm = ?
     WHERE match_id = ? AND user_id = ?`
  );
  for (let i = 0; i < sequences.length; i++) {
    const seat = sequences[i];
    write.run(JSON.stringify(seat.actions), seat.streak, navs[i].visibleMtmPpm, matchId, seat.player.user_id);
  }
  const shown = {};
  sequences.forEach((seat, index) => {
    shown[seat.player.user_id] = { visible: navs[index].visibleMtmPpm };
  });
  insertRound(db, matchId, round, now, sequences, shown);
  const opensAt = now + REVEAL_GAP_MS;
  const advanced = db.prepare(
    `UPDATE pvp_matches
     SET resolved_rounds = ?, revision = revision + 1, round_opens_at = ?, round_deadline_at = ?
     WHERE id = ? AND status = 'playing' AND resolved_rounds = ?`
  ).run(round, opensAt, opensAt + dayMs, matchId, k);
  if (advanced.changes !== 1) rollbackDeny("MATCH_CLOSED", "这一轮已经裁决", 409);
  touchCommit();
  return { ok: true, advanced: true, resolvedRounds: round };
}

function insertRound(db, matchId, round, now, sequences, metrics) {
  const state = sequences.map((seat) => ({
    userId: seat.player.user_id,
    action: seat.action,
    source: seat.source,
    afkStreak: seat.streak,
    mtmPpm: metrics ? metrics[seat.player.user_id].visible : null,
  }));
  db.prepare(
    `INSERT INTO pvp_rounds (match_id, round, resolved_at, revealed_day, both_players_state_json)
     VALUES (?, ?, ?, ?, ?)`
  ).run(matchId, round, now, round + 1, JSON.stringify({ seats: state }));
}

function participantMatch(db, matchId, userId) {
  const match = db.prepare(`SELECT * FROM pvp_matches WHERE id = ?`).get(matchId);
  if (!match) return null;
  const players = playersOf(db, matchId);
  const me = players.find((player) => player.user_id === userId);
  if (!me) return null;
  return { match, players, me };
}

function closeIfUnavailable(db, { match, players, now }) {
  const statuses = new Map(
    db.prepare(`SELECT id, status FROM users WHERE id IN (?, ?)`).all(players[0].user_id, players[1].user_id)
      .map((row) => [row.id, row.status])
  );
  const down = players.filter((player) => statuses.get(player.user_id) !== "active");
  if (!down.length || match.status !== "playing") return null;
  rememberPartial(db, match, players);
  if (down.length === 2) {
    mustFinish(db, { matchId: match.id, terminalType: "aborted", reason: "both_unavailable", now });
  } else {
    const winner = players.find((player) => player.user_id !== down[0].user_id);
    mustFinish(db, {
      matchId: match.id,
      terminalType: "forfeited",
      reason: "account_unavailable",
      winnerUserId: winner.user_id,
      now,
    });
  }
  touchCommit();
  return deny("ACCOUNT_UNAVAILABLE", "有账号不能继续对战", 403);
}

export function lockAction(db, { matchId, userId, round, action, commandKey, now }) {
  try {
    return withImmediate(db, () => lockInTx(db, { matchId, userId, round, action, commandKey, now }));
  } catch (err) {
    return catchDeny(err);
  }
}

function lockInTx(db, { matchId, userId, round, action, commandKey, now }) {
  if (!validCreateKey(commandKey)) return deny("INVALID_IDEMPOTENCY_KEY", "Idempotency-Key 须为 16-128 位可见 ASCII", 400);
  if (!Number.isInteger(round) || round < 1 || round > 29) return deny("BAD_PAYLOAD", "回合无效", 400);
  if (!ACTIONS.has(action)) return deny("ILLEGAL_ACTION", "这步不能这样操作", 422);

  const found = participantMatch(db, matchId, userId);
  if (!found) return deny("NOT_FOUND", "对局不存在", 404);
  const { match, players } = found;
  const scope = `match-action:${matchId}`;
  const hash = actionHash(round, action);
  const prior = readCommand(db, userId, scope, commandKey);
  if (prior) {
    if (prior.payload_hash !== hash) return deny("IDEMPOTENCY_CONFLICT", "这个幂等键已经用于另一个动作", 409);
    const ack = JSON.parse(prior.ack_json);
    return ack;
  }
  if (match.status !== "playing") return deny("MATCH_CLOSED", "对局已结束", 409);
  const closed = closeIfUnavailable(db, { match, players, now });
  if (closed) return closed;
  if (round !== match.resolved_rounds + 1) return deny("ROUND_CLOSED", "这一轮已经结束", 409);
  if (now < match.round_opens_at) return deny("ROUND_CLOSED", "回合还没开始", 409);
  if (now >= match.round_deadline_at) return deny("ROUND_CLOSED", "回合已截止", 409);

  const mine = players.find((player) => player.user_id === userId);
  const bars = barsOf(match);
  const priorActions = parseActions(mine.actions_json, match.resolved_rounds);
  let legal = false;
  if (bars) {
    try {
      // Unfinished replayGame.returnPpm is not the room NAV. Read only ok.
      legal = replayGame({
        fillMode: PVP_FILL_MODE,
        bars,
        actions: [...priorActions, action],
        finish: false,
      }).ok === true;
    } catch {
      legal = false;
    }
  }
  if (!legal) return deny("ILLEGAL_ACTION", "这步不能这样操作", 422);

  const bumped = db.prepare(
    `UPDATE pvp_matches SET revision = revision + 1
     WHERE id = ? AND status = 'playing' AND resolved_rounds = ?`
  ).run(matchId, match.resolved_rounds);
  if (bumped.changes !== 1) rollbackDeny("MATCH_CLOSED", "对局已结束", 409);
  const revision = db.prepare(`SELECT revision FROM pvp_matches WHERE id = ?`).get(matchId).revision;
  try {
    db.prepare(
      `INSERT INTO pvp_actions (
        match_id, user_id, round, action, source, command_key, payload_hash, locked_at
      ) VALUES (?, ?, ?, ?, 'player', ?, ?, ?)`
    ).run(matchId, userId, round, action, commandKey, hash, now);
  } catch (err) {
    if (String(err.message || "").includes("UNIQUE")) rollbackDeny("ALREADY_LOCKED", "这一轮已经锁定", 409);
    throw err;
  }
  const ack = { ok: true, accepted: true, round, lockedAction: action, revision };
  storeCommand(db, { userId, scope, key: commandKey, hash, resourceId: matchId, ack, now });
  const locked = db.prepare(`SELECT COUNT(*) AS c FROM pvp_actions WHERE match_id = ? AND round = ?`).get(matchId, round).c;
  if (locked >= 2) resolveInTx(db, { matchId, now });
  else touchCommit();
  return ack;
}

export function forfeitMatch(db, { matchId, userId, commandKey, now }) {
  try {
    return withImmediate(db, () => forfeitInTx(db, { matchId, userId, commandKey, now }));
  } catch (err) {
    return catchDeny(err);
  }
}

function forfeitInTx(db, { matchId, userId, commandKey, now }) {
  if (!validCreateKey(commandKey)) return deny("INVALID_IDEMPOTENCY_KEY", "Idempotency-Key 须为 16-128 位可见 ASCII", 400);
  const found = participantMatch(db, matchId, userId);
  if (!found) return deny("NOT_FOUND", "对局不存在", 404);
  const scope = `match-forfeit:${matchId}`;
  const hash = sha(JSON.stringify({ forfeit: true }));
  const prior = readCommand(db, userId, scope, commandKey);
  if (prior) {
    if (prior.payload_hash !== hash) return deny("IDEMPOTENCY_CONFLICT", "这个幂等键已经用于另一个请求", 409);
    return JSON.parse(prior.ack_json);
  }
  const { match, players, me } = found;
  if (match.status !== "playing") {
    return {
      ok: true,
      unchanged: true,
      accepted: true,
      forfeited: match.terminal_reason === "forfeit",
      revision: match.revision,
    };
  }
  const opponent = players.find((player) => player.user_id !== me.user_id);
  rememberPartial(db, match, players);
  const finished = mustFinish(db, {
    matchId,
    terminalType: "forfeited",
    reason: "forfeit",
    winnerUserId: opponent.user_id,
    now,
  });
  const revision = db.prepare(`SELECT revision FROM pvp_matches WHERE id = ?`).get(matchId).revision;
  const ack = { ok: true, accepted: true, forfeited: true, revision, unchanged: finished.unchanged === true };
  storeCommand(db, { userId, scope, key: commandKey, hash, resourceId: matchId, ack, now });
  touchCommit();
  return ack;
}

export function readMatchView(db, { matchId, viewerId, now }) {
  const found = participantMatch(db, matchId, viewerId);
  if (!found) return null;
  const { match, players } = found;
  const settlement = db.prepare(`SELECT terminal_type FROM pvp_settlements WHERE match_id = ?`).get(matchId);
  const pendingLocks = {};
  if (match.status === "playing") {
    const round = match.resolved_rounds + 1;
    const locks = db
      .prepare(`SELECT user_id, action FROM pvp_actions WHERE match_id = ? AND round = ? AND source = 'player'`)
      .all(matchId, round);
    for (const row of locks) pendingLocks[row.user_id] = row.action;
  }
  const nicknames = {};
  const names = db.prepare(`SELECT id, nickname FROM users WHERE id IN (?, ?)`).all(players[0].user_id, players[1].user_id);
  for (const row of names) nicknames[row.id] = row.nickname;
  return pvpMatchView({
    match,
    players,
    viewerId,
    serverNow: now,
    pendingLocks,
    terminalType: settlement?.terminal_type || null,
    nicknames,
  });
}
