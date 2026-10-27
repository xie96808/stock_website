/**
 * 韭币局 — the player stakes their own 韭币 on a classic 30-day game.
 *   create   stake is escrowed in the same TX as the game row (ledger `stake_escrow`, no create fee)
 *   settle   payout = stake + profit − fee (ledger `stake_payout`), fee = 10% of a positive profit
 *   abandon / expiry   the escrow is simply not returned (row marked forfeited)
 * Rules (limits, fee, maths) live in shared/stake.js so the client shows exactly what the server pays.
 * Every ledger movement is unique per game (partial unique indexes in migration 036): a retry can never pay twice.
 */
import { openDb } from "../db/connection.js";
import { config } from "./config.js";
import { getJiuCoinBalance, insertJiuCoinLedger } from "./jiuCoin.js";
import { isValidStake, stakeSettlement, STAKE_MIN, STAKE_MAX, STAKE_FEE_RATE } from "../../../shared/stake.js";
import { GAME_KIND_STAKE } from "../../../shared/protocol.js";

export function coinStakeEnabled() {
  return !!config.coinStakeEnabled;
}

export function stakeConfigPayload() {
  return { min: STAKE_MIN, max: STAKE_MAX, feeRate: STAKE_FEE_RATE };
}

/** Validates the create-time stake. @returns {{ok:true,stake:number}|{error}} */
export function checkStakeInput(raw) {
  if (!coinStakeEnabled()) {
    return { error: { status: 403, code: "FEATURE_DISABLED", message: "韭币局暂未开放" } };
  }
  const stake = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : raw;
  if (!isValidStake(stake)) {
    return {
      error: {
        status: 400,
        code: "INVALID_STAKE",
        message: `投入韭币需为 ${STAKE_MIN}–${STAKE_MAX} 的整数`,
        details: { min: STAKE_MIN, max: STAKE_MAX },
      },
    };
  }
  return { ok: true, stake };
}

/**
 * Escrow the stake inside the create transaction. Throws INSUFFICIENT_FUNDS (required = stake).
 */
export function escrowStake(userId, gameId, db, stake) {
  const cur = getJiuCoinBalance(userId, db);
  if (cur < stake) {
    const err = new Error("韭币不足，无法投入这么多");
    err.code = "INSUFFICIENT_FUNDS";
    err.balance = cur;
    err.required = stake;
    throw err;
  }
  const next = cur - stake;
  insertJiuCoinLedger(db, {
    userId,
    delta: -stake,
    balanceAfter: next,
    reason: "stake_escrow",
    refType: "game",
    refId: String(gameId),
  });
  db.prepare(`UPDATE users SET jiu_coin_balance = ?, updated_at = datetime('now') WHERE id = ?`).run(next, userId);
  db.prepare(`INSERT INTO coin_stakes (game_id, user_id, stake) VALUES (?, ?, ?)`).run(gameId, userId, stake);
  return { balance: next };
}

/**
 * Pay out a settled stake game (call inside the settle TX). No-op for other kinds / already-settled games.
 * @returns {{stake,profit,fee,payout,net}|null}
 */
export function settleStake(db, session, returnPpm) {
  if (!session || session.game_kind !== GAME_KIND_STAKE) return null;
  const row = db.prepare(`SELECT * FROM coin_stakes WHERE game_id = ?`).get(session.id);
  if (!row || row.status !== "open") return null;
  const s = stakeSettlement(row.stake, returnPpm);
  const info = db
    .prepare(
      `UPDATE coin_stakes
       SET status = 'settled', return_ppm = ?, profit = ?, fee = ?, payout = ?, settled_at = datetime('now')
       WHERE game_id = ? AND status = 'open'`
    )
    .run(returnPpm, s.profit, s.fee, s.payout, session.id);
  if (info.changes !== 1) return null;
  if (s.payout > 0) {
    const cur = getJiuCoinBalance(row.user_id, db);
    const next = cur + s.payout;
    insertJiuCoinLedger(db, {
      userId: row.user_id,
      delta: s.payout,
      balanceAfter: next,
      reason: "stake_payout",
      refType: "game",
      refId: String(session.id),
      meta: { stake: s.stake, profit: s.profit, fee: s.fee, returnPpm },
    });
    db.prepare(`UPDATE users SET jiu_coin_balance = ?, updated_at = datetime('now') WHERE id = ?`).run(next, row.user_id);
  }
  return s;
}

/** Abandoned / expired stake game: the escrow stays spent. Safe to call for any session row. */
export function forfeitStake(db, session) {
  if (!session || session.game_kind !== GAME_KIND_STAKE) return;
  db.prepare(
    `UPDATE coin_stakes
     SET status = 'forfeited', profit = -stake, fee = 0, payout = 0, settled_at = datetime('now')
     WHERE game_id = ? AND status = 'open'`
  ).run(session.id);
}

/**
 * Public shape of a game's stake record (null for non-stake games).
 * An open stake whose game ended without settling (abandoned / expired through any path) reads as forfeited,
 * so the many expiry code paths don't each need to touch coin_stakes.
 */
export function stakePublic(gameId, db = openDb()) {
  const r = db
    .prepare(
      `SELECT c.*, g.status AS game_status FROM coin_stakes c
       LEFT JOIN game_sessions g ON g.id = c.game_id WHERE c.game_id = ?`
    )
    .get(String(gameId));
  if (!r) return null;
  let status = r.status;
  if (status === "open" && (r.game_status === "abandoned" || r.game_status === "expired")) status = "forfeited";
  const out = { amount: r.stake, status };
  if (status === "settled") {
    out.returnPpm = r.return_ppm;
    out.profit = r.profit;
    out.fee = r.fee;
    out.payout = r.payout;
    out.net = r.payout - r.stake;
  } else if (status === "forfeited") {
    out.profit = -r.stake;
    out.fee = 0;
    out.payout = 0;
    out.net = -r.stake;
  }
  return out;
}

/** Spread `stake` into a game / result payload when it belongs to a staked game. */
export function attachStake(data) {
  if (!data || data.gameKind !== GAME_KIND_STAKE) return data;
  const id = data.gameId || data.id;
  if (!id) return data;
  const stake = stakePublic(id);
  return stake ? { ...data, stake } : data;
}
