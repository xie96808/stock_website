import crypto from "node:crypto";
import { RULE_VERSION } from "../../../../shared/rules.js";
import { config } from "../config.js";
import { PVP_RATING_INITIAL } from "../../../../shared/pvpRating.js";
import { ensureDatasetLoaded, pickRandomWindow } from "../dataset.js";
import {
  CHALLENGE_MS,
  PVP_RATING_VERSION,
  PVP_VERSION,
  READY_MS,
  REVEAL_GAP_MS,
  currentEconomy,
  maxActiveMatches,
} from "./config.js";
import { chargePvpEntry } from "./economy.js";
import { assessEntry, isBlocked, pairKey } from "./eligibility.js";
import { finishMatch, finishMatchInTx } from "./settlement.js";
import { withImmediate } from "./tx.js";

export { pairKey };

function deny(code, message, status) {
  return { ok: false, code, message, status };
}

function entryRejected(code, message, status) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.entryRejected = true;
  return err;
}

export function validCreateKey(key) {
  return typeof key === "string" && /^[\x21-\x7e]{16,128}$/.test(key);
}

function denyIfClosed() {
  if (!config.pvpBattleEnabled) return deny("FEATURE_DISABLED", "对战未开放", 403);
  return null;
}

function payloadHash(toUserId) {
  return crypto.createHash("sha256").update(JSON.stringify({ toUserId: Number(toUserId) })).digest("hex");
}

function activeCount(db) {
  return db
    .prepare(`SELECT COUNT(*) AS c FROM pvp_matches WHERE status IN ('waiting_ready', 'playing')`)
    .get().c;
}

function hasLock(db, userId) {
  return !!db.prepare(`SELECT 1 AS hit FROM pvp_active_members WHERE user_id = ?`).get(userId);
}

export function createChallenge(db, { fromUserId, toUserId, createKey, now }) {
  const closed = denyIfClosed();
  if (closed) return closed;
  if (!validCreateKey(createKey)) {
    return deny("INVALID_IDEMPOTENCY_KEY", "Idempotency-Key 须为 16-128 位可见 ASCII", 400);
  }
  if (Number(fromUserId) === Number(toUserId)) {
    return deny("SELF_CHALLENGE", "不能和自己约战", 422);
  }
  return withImmediate(db, () => {
    const hash = payloadHash(toUserId);
    const prior = db
      .prepare(`SELECT * FROM pvp_challenges WHERE from_user_id = ? AND create_key = ?`)
      .get(fromUserId, createKey);
    if (prior) {
      if (prior.payload_hash !== hash) {
        return deny("IDEMPOTENCY_CONFLICT", "这个幂等键已经用于另一条约战", 409);
      }
      return { ok: true, challenge: prior, replay: true };
    }

    const key = pairKey(fromUserId, toUserId);
    const pendingPair = db
      .prepare(`SELECT * FROM pvp_challenges WHERE pair_key = ? AND status = 'pending'`)
      .get(key);
    if (pendingPair) {
      return { ok: true, challenge: pendingPair, alreadyPending: true };
    }

    const target = db.prepare(`SELECT id, status FROM users WHERE id = ?`).get(toUserId);
    if (!target || target.status !== "active") return deny("NOT_FOUND", "找不到这位对手", 404);
    if (isBlocked(db, fromUserId, toUserId)) return deny("BLOCKED", "双方无法约战", 403);
    if (hasLock(db, fromUserId) || hasLock(db, toUserId)) {
      return deny("TARGET_BUSY", "有一方正在对战", 409);
    }
    const outbound = db
      .prepare(`SELECT id FROM pvp_challenges WHERE from_user_id = ? AND status = 'pending'`)
      .get(fromUserId);
    if (outbound) return deny("OUTBOUND_PENDING", "你还有一条未结束的约战", 409);
    const inbound = db
      .prepare(`SELECT COUNT(*) AS c FROM pvp_challenges WHERE to_user_id = ? AND status = 'pending'`)
      .get(toUserId).c;
    if (inbound >= 3) return deny("TOO_MANY_INBOUND", "对方的约战太多", 409);

    const gate = assessEntry(db, fromUserId, toUserId, now);
    if (!gate.ok) return gate;

    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO pvp_challenges (
        id, from_user_id, to_user_id, pair_key, status, create_key, payload_hash, created_at, expires_at
      ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
    ).run(id, fromUserId, toUserId, key, createKey, hash, now, now + CHALLENGE_MS);
    return { ok: true, challenge: db.prepare(`SELECT * FROM pvp_challenges WHERE id = ?`).get(id), created: true };
  });
}

export function acceptChallenge(db, { challengeId, userId, now }) {
  const closed = denyIfClosed();
  if (closed) return closed;
  try {
    return withImmediate(db, () => acceptInTx(db, { challengeId, userId, now }));
  } catch (err) {
    if (err.code === "TARGET_BUSY") return deny(err.code, err.message, err.status || 409);
    throw err;
  }
}

function acceptInTx(db, { challengeId, userId, now }) {
  const challenge = db.prepare(`SELECT * FROM pvp_challenges WHERE id = ?`).get(challengeId);
  if (!challenge) return deny("NOT_FOUND", "约战不存在", 404);
  if (challenge.to_user_id !== userId) return deny("NOT_PARTICIPANT", "只有被邀请的人能接受", 403);
  if (challenge.status !== "pending") return deny("CHALLENGE_CLOSED", "约战已结束", 409);
  if (now >= challenge.expires_at) {
    db.prepare(
      `UPDATE pvp_challenges SET status = 'expired', responded_at = ?, cancel_reason = 'expired' WHERE id = ? AND status = 'pending'`
    ).run(now, challengeId);
    return deny("CHALLENGE_CLOSED", "约战已超时", 409);
  }
  if (hasLock(db, challenge.from_user_id) || hasLock(db, challenge.to_user_id)) {
    const err = new Error("有一方正在对战");
    err.code = "TARGET_BUSY";
    err.status = 409;
    throw err;
  }
  if (activeCount(db) >= maxActiveMatches()) {
    return deny("CAPACITY", "对战房间已满", 503);
  }
  const gate = assessEntry(db, challenge.from_user_id, challenge.to_user_id, now);
  if (!gate.ok) return gate;

  const matchId = crypto.randomUUID();
  const economy = currentEconomy(now);
  db.prepare(
    `INSERT INTO pvp_matches (
      id, challenge_id, status, rule_version, pvp_version, rating_version, fill_mode,
      ready_deadline_at, created_at, revision
    ) VALUES (?, ?, 'waiting_ready', ?, ?, ?, 'next_open', ?, ?, 0)`
  ).run(matchId, challenge.id, RULE_VERSION, PVP_VERSION, PVP_RATING_VERSION, now + READY_MS, now);

  const seats = [
    [challenge.from_user_id, 1],
    [challenge.to_user_id, 2],
  ];
  const insertPlayer = db.prepare(
    `INSERT INTO pvp_match_players (match_id, user_id, seat) VALUES (?, ?, ?)`
  );
  const insertLock = db.prepare(
    `INSERT INTO pvp_active_members (user_id, match_id, seat) VALUES (?, ?, ?)`
  );
  for (const [seatUser, seat] of seats) {
    insertPlayer.run(matchId, seatUser, seat);
    try {
      insertLock.run(seatUser, matchId, seat);
    } catch (err) {
      if (String(err.message || "").includes("UNIQUE")) {
        const busy = new Error("有一方正在对战");
        busy.code = "TARGET_BUSY";
        busy.status = 409;
        throw busy;
      }
      throw err;
    }
  }

  db.prepare(
    `UPDATE pvp_challenges SET status = 'accepted', responded_at = ? WHERE id = ? AND status = 'pending'`
  ).run(now, challenge.id);
  db.prepare(
    `UPDATE pvp_challenges
     SET status = 'cancelled', cancel_reason = 'superseded', responded_at = ?
     WHERE status = 'pending' AND id <> ?
       AND (from_user_id IN (?, ?) OR to_user_id IN (?, ?))`
  ).run(now, challenge.id, challenge.from_user_id, challenge.to_user_id, challenge.from_user_id, challenge.to_user_id);

  return {
    ok: true,
    matchId,
    readyDeadlineAt: now + READY_MS,
    economy,
  };
}

export function markReady(db, { matchId, userId, now }) {
  const closed = denyIfClosed();
  if (closed) return closed;
  // Commit the dataset row before the ready transaction. A rolled-back start
  // must not take the datasets insert with it while the process cache stays warm.
  ensureDatasetLoaded();
  try {
    return withImmediate(db, () => readyInTx(db, { matchId, userId, now }));
  } catch (err) {
    if (!err.entryRejected) throw err;
    finishMatch(db, {
      matchId,
      terminalType: "aborted",
      reason: "entry_rejected",
      now,
    });
    return deny(err.code, err.message, err.status || 409);
  }
}

function readyInTx(db, { matchId, userId, now }) {
  const match = db.prepare(`SELECT * FROM pvp_matches WHERE id = ?`).get(matchId);
  if (!match) return deny("NOT_FOUND", "对局不存在", 404);
  const player = db
    .prepare(`SELECT * FROM pvp_match_players WHERE match_id = ? AND user_id = ?`)
    .get(matchId, userId);
  if (!player) return deny("NOT_PARTICIPANT", "你不在这局对战里", 403);
  if (match.status === "playing" || match.status === "settled") {
    return { ok: true, matchId, status: match.status, unchanged: true };
  }
  if (match.status !== "waiting_ready") return deny("MATCH_CLOSED", "对局已结束", 409);
  if (now >= match.ready_deadline_at) {
    finishMatchInTx(db, { matchId, terminalType: "aborted", reason: "ready_timeout", now });
    return deny("READY_TIMEOUT", "准备已超时", 409);
  }
  if (player.ready_at == null) {
    db.prepare(`UPDATE pvp_match_players SET ready_at = ? WHERE match_id = ? AND user_id = ?`).run(
      now,
      matchId,
      userId
    );
  }
  const readyCount = db
    .prepare(`SELECT COUNT(*) AS c FROM pvp_match_players WHERE match_id = ? AND ready_at IS NOT NULL`)
    .get(matchId).c;
  if (readyCount < 2) return { ok: true, matchId, status: "waiting_ready", waiting: true };
  startPlayingInTx(db, match, now);
  return { ok: true, matchId, status: "playing", started: true };
}

function startPlayingInTx(db, match, now) {
  const players = db
    .prepare(`SELECT * FROM pvp_match_players WHERE match_id = ? ORDER BY seat ASC`)
    .all(match.id);
  const economy = currentEconomy(now);
  const gate = assessEntry(db, players[0].user_id, players[1].user_id, now, economy);
  if (!gate.ok) throw entryRejected(gate.code, gate.message, gate.status);

  const picked = pickRandomWindow();
  if (!picked?.snapshotJson || picked.snapshot?.bars?.length !== 30) {
    throw entryRejected("BAD_MARKET", "没能选到有效行情", 503);
  }
  for (const player of players) {
    const rating = db.prepare(`SELECT rating FROM pvp_ratings WHERE user_id = ?`).get(player.user_id);
    db.prepare(
      `UPDATE pvp_match_players SET rating_before = ? WHERE match_id = ? AND user_id = ?`
    ).run(rating?.rating ?? PVP_RATING_INITIAL, match.id, player.user_id);
  }
  const opensAt = now + REVEAL_GAP_MS;
  const started = db.prepare(
    `UPDATE pvp_matches SET
       status = 'playing',
       dataset_version = ?,
       snapshot_json = ?,
       snapshot_sha256 = ?,
       history_length = ?,
       economy_json = ?,
       reward_ymd = ?,
       resolved_rounds = 0,
       revision = revision + 1,
       round_opens_at = ?,
       round_deadline_at = ?,
       started_at = ?
     WHERE id = ? AND status = 'waiting_ready'`
  ).run(
    picked.datasetVersion,
    picked.snapshotJson,
    picked.snapshotSha256,
    picked.historyLength,
    JSON.stringify(economy),
    gate.rewardYmd,
    opensAt,
    opensAt + economy.dayMs,
    now,
    match.id
  );
  if (started.changes !== 1) {
    throw new Error("pvp start lost the ready row");
  }
  for (const player of players) {
    try {
      chargePvpEntry(db, {
        userId: player.user_id,
        matchId: match.id,
        cost: economy.entryCost,
        economyVersion: economy.economyVersion,
      });
    } catch (err) {
      if (err.code === "INSUFFICIENT_FUNDS") {
        throw entryRejected(err.code, err.message, err.status);
      }
      throw err;
    }
  }
}

export function cancelReady(db, { matchId, userId, now }) {
  return withImmediate(db, () => {
    const match = db.prepare(`SELECT * FROM pvp_matches WHERE id = ?`).get(matchId);
    if (!match) return deny("NOT_FOUND", "对局不存在", 404);
    const player = db
      .prepare(`SELECT 1 AS hit FROM pvp_match_players WHERE match_id = ? AND user_id = ?`)
      .get(matchId, userId);
    if (!player) return deny("NOT_PARTICIPANT", "你不在这局对战里", 403);
    if (match.status !== "waiting_ready") return deny("MATCH_CLOSED", "对局已结束", 409);
    return finishMatchInTx(db, { matchId, terminalType: "aborted", reason: "ready_cancelled", now });
  });
}

export function expireDueReady(db, now) {
  const due = db
    .prepare(
      `SELECT id FROM pvp_matches WHERE status = 'waiting_ready' AND ready_deadline_at IS NOT NULL AND ready_deadline_at <= ?`
    )
    .all(now);
  const done = [];
  for (const row of due) {
    done.push(
      withImmediate(db, () =>
        finishMatchInTx(db, { matchId: row.id, terminalType: "aborted", reason: "ready_timeout", now })
      )
    );
  }
  return done;
}
