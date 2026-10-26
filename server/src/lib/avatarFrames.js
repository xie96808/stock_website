/**
 * 头像框 — buy with 韭币 (the sink) or earn through 成就; one frame equipped at a time.
 *
 * Ownership = rows in user_frames (bought) ∪ achievement unlocks (`frame:<id>` on user_achievements).
 * Equipping validates ownership at write time; every public DTO re-validates the stored id against the code-side
 * list (frameProp), so a retired frame id simply stops rendering.
 */
import { openDb } from "../db/connection.js";
import { config } from "./config.js";
import { FRAMES, frameDef } from "./frameDefs.js";
import { avatarFramesEnabled } from "./frameProp.js";
import { getJiuCoinBalance, insertJiuCoinLedger } from "./jiuCoin.js";
import { getAchievementUnlocks } from "./achievements.js";
import { invalidateLeaderboardCache } from "./leaderboard.js";

export { avatarFramesEnabled };

export function ownedFrameIds(userId, db = openDb()) {
  const owned = new Set(
    db.prepare(`SELECT frame_id FROM user_frames WHERE user_id = ?`).all(userId).map((r) => r.frame_id)
  );
  for (const u of getAchievementUnlocks(userId, db)) {
    if (u.startsWith("frame:")) owned.add(u.slice("frame:".length));
  }
  return owned;
}

function equippedOf(userId, db) {
  const raw = db.prepare(`SELECT avatar_frame AS f FROM users WHERE id = ?`).get(userId)?.f || null;
  return raw && frameDef(raw) ? raw : null;
}

/** Pure: shape one frame for the client. */
export function shapeFrame(def, { owned, equipped, balance }) {
  const buyable = def.kind === "shop" && !owned;
  return {
    id: def.id,
    name: def.name,
    desc: def.desc,
    kind: def.kind,
    price: def.kind === "shop" ? def.price : null,
    hint: def.hint || null,
    owned: !!owned,
    equipped: !!equipped,
    buyable,
    affordable: buyable ? balance >= def.price : false,
  };
}

export function getFrameState(userId, { db = openDb() } = {}) {
  const owned = ownedFrameIds(userId, db);
  const equipped = equippedOf(userId, db);
  const balance = getJiuCoinBalance(userId, db);
  return {
    enabled: avatarFramesEnabled(),
    equipped,
    balance,
    frames: FRAMES.map((f) => shapeFrame(f, { owned: owned.has(f.id), equipped: equipped === f.id, balance })),
  };
}

function guard(db, userId) {
  if (!avatarFramesEnabled()) {
    return { error: { status: 404, code: "FEATURE_DISABLED", message: "头像框暂未开放" } };
  }
  const u = db.prepare(`SELECT status, is_bot FROM users WHERE id = ?`).get(userId);
  if (!u || u.status !== "active" || Number(u.is_bot) === 1) {
    return { error: { status: 403, code: "NOT_ALLOWED", message: "当前账号不能操作" } };
  }
  return null;
}

export function buyFrame(userId, frameId) {
  const db = openDb();
  const g = guard(db, userId);
  if (g) return g;
  const def = frameDef(String(frameId));
  if (!def) return { error: { status: 404, code: "UNKNOWN_FRAME", message: "没有这个头像框" } };
  if (def.kind !== "shop") {
    return { error: { status: 409, code: "NOT_FOR_SALE", message: "这个头像框只能通过成就解锁" } };
  }
  const out = db.transaction(() => {
    if (ownedFrameIds(userId, db).has(def.id)) return { error: { status: 409, code: "ALREADY_OWNED", message: "你已经拥有这个头像框" } };
    const balance = getJiuCoinBalance(userId, db);
    if (balance < def.price) {
      return {
        error: { status: 402, code: "INSUFFICIENT_FUNDS", message: "韭币不足", details: { balance, required: def.price } },
      };
    }
    const after = balance - def.price;
    db.prepare(`INSERT INTO user_frames (user_id, frame_id, price) VALUES (?, ?, ?)`).run(userId, def.id, def.price);
    insertJiuCoinLedger(db, {
      userId,
      delta: -def.price,
      balanceAfter: after,
      reason: "frame_purchase",
      refType: "frame",
      refId: `${userId}:${def.id}`,
      meta: { frame: def.id },
    });
    db.prepare(`UPDATE users SET jiu_coin_balance = ?, updated_at = datetime('now') WHERE id = ?`).run(after, userId);
    return { ok: true };
  })();
  if (out.error) return { ...out, error: { ...out.error, details: out.error.details || getFrameState(userId, { db }) } };
  return { status: 200, data: { bought: def.id, state: getFrameState(userId, { db }) } };
}

/** frameId null/"" = take the frame off. */
export function equipFrame(userId, frameId) {
  const db = openDb();
  const g = guard(db, userId);
  if (g) return g;
  const want = frameId == null || frameId === "" ? null : String(frameId);
  if (want !== null) {
    if (!frameDef(want)) return { error: { status: 404, code: "UNKNOWN_FRAME", message: "没有这个头像框" } };
    if (!ownedFrameIds(userId, db).has(want)) {
      return { error: { status: 403, code: "NOT_OWNED", message: "你还没有这个头像框" } };
    }
  }
  db.prepare(`UPDATE users SET avatar_frame = ?, updated_at = datetime('now') WHERE id = ?`).run(want, userId);
  invalidateLeaderboardCache();
  return { status: 200, data: { equipped: want, state: getFrameState(userId, { db }) } };
}
