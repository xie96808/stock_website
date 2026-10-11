import crypto from "node:crypto";
import { finishMatchInTx } from "./settlement.js";
import { withImmediate } from "./tx.js";

let recoveryError = null;
let recoveryGuard = null;

export function pvpRecoveryError() {
  return recoveryError;
}

/** Test seam. The next recoverOnBoot call throws before it writes. */
export function setRecoveryGuard(fn) {
  recoveryGuard = fn;
}

/**
 * Boot cleanup. Runs even when PVP_BATTLE_ENABLED is off:
 * due pending challenges expire, waiting_ready aborts with no charge,
 * playing matches abort and refund the entry that was actually charged.
 */
export function recoverOnBoot(db, { now = Date.now(), bootId = crypto.randomUUID() } = {}) {
  if (recoveryGuard) recoveryGuard();
  const expired = db.prepare(
    `UPDATE pvp_challenges
     SET status = 'expired', responded_at = ?, cancel_reason = 'boot_recovery'
     WHERE status = 'pending' AND expires_at <= ?`
  ).run(now, now);

  const waiting = db.prepare(`SELECT id FROM pvp_matches WHERE status = 'waiting_ready'`).all();
  for (const row of waiting) {
    withImmediate(db, () => {
      db.prepare(`UPDATE pvp_matches SET boot_id = ? WHERE id = ? AND status = 'waiting_ready'`).run(bootId, row.id);
      return finishMatchInTx(db, {
        matchId: row.id,
        terminalType: "aborted",
        reason: "boot_recovery",
        now,
      });
    });
  }

  const playing = db.prepare(`SELECT id FROM pvp_matches WHERE status = 'playing'`).all();
  for (const row of playing) {
    withImmediate(db, () => {
      db.prepare(`UPDATE pvp_matches SET boot_id = ? WHERE id = ? AND status = 'playing'`).run(bootId, row.id);
      return finishMatchInTx(db, {
        matchId: row.id,
        terminalType: "aborted",
        reason: "boot_recovery",
        now,
      });
    });
  }

  return {
    expiredChallenges: expired.changes,
    abortedWaiting: waiting.length,
    abortedPlaying: playing.length,
  };
}

export function runBootRecovery(db, now = Date.now()) {
  try {
    const result = recoverOnBoot(db, { now });
    recoveryError = null;
    return result;
  } catch (err) {
    recoveryError = err;
    throw err;
  }
}
