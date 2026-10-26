/**
 * 邀请奖励 — every user has a short invite code. A new account that registers with it is "pending"
 * until its first settled game; then the invitee gets INVITEE_COINS and the inviter INVITER_COINS.
 *
 * Why "first settled game" and not "registered": a code that pays on sign-up is a farm; one that pays on
 * real play is a funnel. Caps bound what a farm could still do (coins have no cash value either way):
 *   - inviter: at most INVITER_MAX_REWARDS paid invites in total and INVITER_DAILY_CAP per Shanghai day
 *     (past the cap the invitee is still paid, the inviter just isn't);
 *   - one IP: at most IP_REWARD_CAP_24H rewarded invitees per rolling 24h (past it → 'rejected', nobody paid).
 * Everything is idempotent: invite_redemptions.invitee_id is the primary key and both ledger rows carry a
 * unique partial index on ref_id.
 */
import crypto from "node:crypto";
import { openDb } from "../db/connection.js";
import { config } from "./config.js";
import { getJiuCoinBalance, insertJiuCoinLedger } from "./jiuCoin.js";

export const INVITER_COINS = 100;
export const INVITEE_COINS = 80;
export const INVITER_MAX_REWARDS = 20;
export const INVITER_DAILY_CAP = 5;
export const IP_REWARD_CAP_24H = 2;

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1
export const INVITE_CODE_LEN = 6;
const CODE_RE = new RegExp(`^[${ALPHABET}]{${INVITE_CODE_LEN}}$`);

export function inviteRewardsEnabled() {
  return !!config.inviteRewardsEnabled;
}

/** Upper-case / strip spaces; returns null when it cannot be a code. */
export function normalizeInviteCode(raw) {
  if (typeof raw !== "string") return null;
  const c = raw.trim().toUpperCase().replace(/[\s-]/g, "");
  return CODE_RE.test(c) ? c : null;
}

export function randomInviteCode(rand = crypto.randomInt) {
  let s = "";
  for (let i = 0; i < INVITE_CODE_LEN; i++) s += ALPHABET[rand(ALPHABET.length)];
  return s;
}

export function hashIp(ip) {
  if (!ip) return null;
  return crypto.createHash("sha256").update(`invite-ip:${config.csrfSecret || ""}:${ip}`).digest("hex").slice(0, 24);
}

/** The user's code, created on first use. */
export function ensureInviteCode(userId, db = openDb()) {
  const row = db.prepare(`SELECT code FROM invite_codes WHERE user_id = ?`).get(userId);
  if (row) return row.code;
  for (let i = 0; i < 12; i++) {
    const code = randomInviteCode();
    try {
      db.prepare(`INSERT INTO invite_codes (user_id, code) VALUES (?, ?)`).run(userId, code);
      return code;
    } catch (e) {
      if (!String(e.message || "").includes("UNIQUE")) throw e;
      const again = db.prepare(`SELECT code FROM invite_codes WHERE user_id = ?`).get(userId);
      if (again) return again.code; // lost a race with ourselves
    }
  }
  throw new Error("could not allocate an invite code");
}

/**
 * Called right after a successful registration. Never throws into the register route: a bad / unknown
 * code simply means no invite (the account is created either way).
 * @returns {{accepted:boolean, reason?:string, inviteeCoins?:number, inviterNickname?:string}}
 */
export function recordInviteRedemption(inviteeId, rawCode, ip, db = openDb()) {
  if (!inviteRewardsEnabled()) return { accepted: false, reason: "disabled" };
  const code = normalizeInviteCode(rawCode);
  if (!code) return { accepted: false, reason: "invalid" };
  const inv = db
    .prepare(
      `SELECT c.user_id AS inviter_id, u.status, u.is_bot, u.nickname
       FROM invite_codes c JOIN users u ON u.id = c.user_id WHERE c.code = ?`
    )
    .get(code);
  if (!inv || inv.status !== "active" || Number(inv.is_bot) === 1) return { accepted: false, reason: "unknown" };
  if (inv.inviter_id === inviteeId) return { accepted: false, reason: "self" };
  try {
    db.prepare(
      `INSERT INTO invite_redemptions (invitee_id, inviter_id, code, ip_hash) VALUES (?, ?, ?, ?)`
    ).run(inviteeId, inv.inviter_id, code, hashIp(ip));
  } catch (e) {
    if (String(e.message || "").includes("UNIQUE")) return { accepted: false, reason: "already" };
    throw e;
  }
  return { accepted: true, inviteeCoins: INVITEE_COINS, inviterNickname: inv.nickname };
}

function credit(db, userId, delta, reason, inviteeId, meta) {
  const balanceAfter = getJiuCoinBalance(userId, db) + delta;
  insertJiuCoinLedger(db, {
    userId,
    delta,
    balanceAfter,
    reason,
    refType: "invite",
    refId: String(inviteeId),
    meta,
  });
  db.prepare(`UPDATE users SET jiu_coin_balance = ?, updated_at = datetime('now') WHERE id = ?`).run(balanceAfter, userId);
  return balanceAfter;
}

/**
 * Called after a user's game settles. Pays out once, for a pending redemption of that user as invitee.
 * Never throws (settlement must not fail because of a bonus).
 * @returns {null | {inviteeCoins:number, inviterCoins:number}} what the *invitee* just received
 */
export function maybeRewardInvite(inviteeId, { db = openDb() } = {}) {
  try {
    if (!inviteRewardsEnabled()) return null;
    const pending = db
      .prepare(`SELECT * FROM invite_redemptions WHERE invitee_id = ? AND status = 'pending'`)
      .get(inviteeId);
    if (!pending) return null;
    return db.transaction(() => {
      // Claim the row first: a concurrent settle sees changes === 0 and pays nothing.
      const claimed = db
        .prepare(
          `UPDATE invite_redemptions SET status = 'rewarded', rewarded_at = datetime('now')
           WHERE invitee_id = ? AND status = 'pending'`
        )
        .run(inviteeId);
      if (claimed.changes !== 1) return null;

      const invitee = db.prepare(`SELECT status, is_bot FROM users WHERE id = ?`).get(inviteeId);
      const inviter = db.prepare(`SELECT status, is_bot FROM users WHERE id = ?`).get(pending.inviter_id);
      const reject = (reason) => {
        db.prepare(
          `UPDATE invite_redemptions SET status = 'rejected', reject_reason = ?, rewarded_at = NULL WHERE invitee_id = ?`
        ).run(reason, inviteeId);
        return null;
      };
      if (!invitee || invitee.status !== "active" || Number(invitee.is_bot) === 1) return reject("invitee_inactive");
      if (!inviter || inviter.status !== "active" || Number(inviter.is_bot) === 1) return reject("inviter_inactive");

      if (pending.ip_hash) {
        const sameIp = db
          .prepare(
            `SELECT COUNT(*) AS c FROM invite_redemptions
             WHERE ip_hash = ? AND status = 'rewarded' AND invitee_id <> ?
               AND rewarded_at >= datetime('now', '-1 day')`
          )
          .get(pending.ip_hash, inviteeId).c;
        if (sameIp >= IP_REWARD_CAP_24H) return reject("ip_cap");
      }

      const paidTotal = db
        .prepare(`SELECT COUNT(*) AS c FROM invite_redemptions WHERE inviter_id = ? AND status = 'rewarded' AND inviter_coins > 0`)
        .get(pending.inviter_id).c;
      const paidToday = db
        .prepare(
          `SELECT COUNT(*) AS c FROM invite_redemptions
           WHERE inviter_id = ? AND status = 'rewarded' AND inviter_coins > 0
             AND date(rewarded_at, '+8 hours') = date('now', '+8 hours')`
        )
        .get(pending.inviter_id).c;
      const inviterCoins = paidTotal < INVITER_MAX_REWARDS && paidToday < INVITER_DAILY_CAP ? INVITER_COINS : 0;

      credit(db, inviteeId, INVITEE_COINS, "invite_invitee", inviteeId, { inviter: pending.inviter_id });
      if (inviterCoins > 0) credit(db, pending.inviter_id, inviterCoins, "invite_inviter", inviteeId, { invitee: inviteeId });
      db.prepare(`UPDATE invite_redemptions SET inviter_coins = ?, invitee_coins = ? WHERE invitee_id = ?`).run(
        inviterCoins,
        INVITEE_COINS,
        inviteeId
      );
      return { inviteeCoins: INVITEE_COINS, inviterCoins };
    })();
  } catch (e) {
    console.error("[invite] reward failed", e);
    return null;
  }
}

export function getInviteState(userId, { db = openDb() } = {}) {
  const code = ensureInviteCode(userId, db);
  const row = db
    .prepare(
      `SELECT COUNT(*) AS invited,
              SUM(CASE WHEN status = 'rewarded' THEN 1 ELSE 0 END) AS rewarded,
              SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
              COALESCE(SUM(inviter_coins), 0) AS coins
       FROM invite_redemptions WHERE inviter_id = ?`
    )
    .get(userId);
  const paid = db
    .prepare(`SELECT COUNT(*) AS c FROM invite_redemptions WHERE inviter_id = ? AND status = 'rewarded' AND inviter_coins > 0`)
    .get(userId).c;
  const mine = db
    .prepare(`SELECT r.status, r.invitee_coins, u.nickname AS inviter_nickname
              FROM invite_redemptions r JOIN users u ON u.id = r.inviter_id WHERE r.invitee_id = ?`)
    .get(userId);
  return {
    enabled: inviteRewardsEnabled(),
    code,
    inviterCoins: INVITER_COINS,
    inviteeCoins: INVITEE_COINS,
    maxRewards: INVITER_MAX_REWARDS,
    dailyCap: INVITER_DAILY_CAP,
    remaining: Math.max(0, INVITER_MAX_REWARDS - paid),
    stats: {
      invited: Number(row.invited) || 0,
      rewarded: Number(row.rewarded) || 0,
      pending: Number(row.pending) || 0,
      coinsEarned: Number(row.coins) || 0,
    },
    invitedBy: mine ? { status: mine.status, nickname: mine.inviter_nickname, coins: Number(mine.invitee_coins) || 0 } : null,
  };
}
