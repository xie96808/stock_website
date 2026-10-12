import crypto from "node:crypto";
import { config } from "../config.js";
import { CHALLENGE_MS, SHARE_MS, maxActiveMatches } from "./config.js";
import { openReadyMatch } from "./challenges.js";
import { readDrain } from "./drain.js";
import { assessEntry, assessSelf, pairKey } from "./eligibility.js";
import { withImmediate } from "./tx.js";

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function deny(code, message, status) {
  return { ok: false, code, message, status };
}

function denyIfNotAccepting(db) {
  if (!config.pvpBattleEnabled) return deny("FEATURE_DISABLED", "对战未开放", 403);
  if (readDrain(db)) return deny("DRAINING", "对战已停止接受新局", 503);
  return null;
}

function makeCode() {
  const bytes = crypto.randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i += 1) code += ALPHABET[bytes[i] % ALPHABET.length];
  return code;
}

function activeCount(db) {
  return db
    .prepare(`SELECT COUNT(*) AS c FROM pvp_matches WHERE status IN ('waiting_ready', 'playing')`)
    .get().c;
}

function hasLock(db, userId) {
  return !!db.prepare(`SELECT 1 AS hit FROM pvp_active_members WHERE user_id = ?`).get(userId);
}

function shareCreateKey(code, joinerId) {
  return `sharelink${code}u${joinerId}`.slice(0, 128);
}

export function createShareLink(db, { userId, now }) {
  const closed = denyIfNotAccepting(db);
  if (closed) return closed;
  const self = assessSelf(db, userId, now);
  if (!self.ok) return self;
  return withImmediate(db, () => {
    const existing = db
      .prepare(`SELECT * FROM pvp_share_links WHERE from_user_id = ? AND status = 'open'`)
      .get(userId);
    if (existing && existing.expires_at > now) {
      return { ok: true, code: existing.code, expiresAt: existing.expires_at, replay: true };
    }
    if (existing) {
      db.prepare(`UPDATE pvp_share_links SET status = 'expired' WHERE code = ? AND status = 'open'`).run(existing.code);
    }
    let code = makeCode();
    for (let i = 0; i < 5; i += 1) {
      const hit = db.prepare(`SELECT 1 AS hit FROM pvp_share_links WHERE code = ?`).get(code);
      if (!hit) break;
      code = makeCode();
    }
    const expiresAt = now + SHARE_MS;
    db.prepare(
      `INSERT INTO pvp_share_links (code, from_user_id, status, created_at, expires_at)
       VALUES (?, ?, 'open', ?, ?)`
    ).run(code, userId, now, expiresAt);
    return { ok: true, code, expiresAt, created: true };
  });
}

function playerOf(db, matchId, userId) {
  return !!db
    .prepare(`SELECT 1 AS hit FROM pvp_match_players WHERE match_id = ? AND user_id = ?`)
    .get(matchId, userId);
}

function joinInTx(db, { code, userId, now }) {
  const link = db.prepare(`SELECT * FROM pvp_share_links WHERE code = ?`).get(code);
  if (!link) return deny("NOT_FOUND", "分享链接无效", 404);
  if (link.status === "joined" && link.match_id && playerOf(db, link.match_id, userId)) {
    return { ok: true, matchId: link.match_id, replay: true, userIds: [link.from_user_id, userId] };
  }
  if (link.status === "joined") return deny("SHARE_CLOSED", "这场分享已经有人加入", 409);
  if (link.status !== "open" || now >= link.expires_at) {
    if (link.status === "open") {
      db.prepare(`UPDATE pvp_share_links SET status = 'expired' WHERE code = ? AND status = 'open'`).run(code);
    }
    return deny("SHARE_CLOSED", "分享已失效", 409);
  }
  if (Number(link.from_user_id) === Number(userId)) {
    return deny("SELF_CHALLENGE", "这是你自己的分享", 422);
  }
  const gate = assessEntry(db, link.from_user_id, userId, now);
  if (!gate.ok) return gate;
  if (activeCount(db) >= maxActiveMatches()) return deny("CAPACITY", "对战房间已满", 503);
  if (hasLock(db, link.from_user_id) || hasLock(db, userId)) {
    return deny("TARGET_BUSY", "有一方正在对战", 409);
  }

  const hostId = link.from_user_id;
  db.prepare(
    `UPDATE pvp_challenges
     SET status = 'cancelled', cancel_reason = 'superseded', responded_at = ?
     WHERE status = 'pending' AND (from_user_id IN (?, ?) OR pair_key = ?)`
  ).run(now, hostId, userId, pairKey(hostId, userId));

  const challengeId = crypto.randomUUID();
  const hash = crypto.createHash("sha256").update(JSON.stringify({ toUserId: Number(userId), share: code })).digest("hex");
  db.prepare(
    `INSERT INTO pvp_challenges (
      id, from_user_id, to_user_id, pair_key, status, create_key, payload_hash, created_at, expires_at
    ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
  ).run(
    challengeId,
    hostId,
    userId,
    pairKey(hostId, userId),
    shareCreateKey(code, userId),
    hash,
    now,
    now + CHALLENGE_MS,
  );
  const challenge = db.prepare(`SELECT * FROM pvp_challenges WHERE id = ?`).get(challengeId);
  const opened = openReadyMatch(db, challenge, now);
  if (!opened?.ok) {
    const err = new Error(opened?.message || "对战房间已满");
    err.code = opened?.code || "CAPACITY";
    err.status = opened?.status || 503;
    throw err;
  }
  db.prepare(
    `UPDATE pvp_share_links SET status = 'joined', match_id = ? WHERE code = ? AND status = 'open'`
  ).run(opened.matchId, code);
  return {
    ok: true,
    matchId: opened.matchId,
    readyDeadlineAt: opened.readyDeadlineAt,
    challengeId,
    userIds: [hostId, userId],
  };
}

export function joinShareLink(db, { code, userId, now }) {
  const closed = denyIfNotAccepting(db);
  if (closed) return closed;
  const normalized = String(code || "").trim().toLowerCase();
  if (!/^[a-z2-9]{8}$/.test(normalized)) return deny("NOT_FOUND", "分享链接无效", 404);
  try {
    return withImmediate(db, () => joinInTx(db, { code: normalized, userId, now }));
  } catch (err) {
    if (err.code === "TARGET_BUSY" || err.code === "CAPACITY") {
      return deny(err.code, err.message, err.status || 409);
    }
    throw err;
  }
}
