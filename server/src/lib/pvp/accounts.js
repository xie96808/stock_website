import { finishMatchInTx } from "./settlement.js";
import { setAvailable } from "./presence.js";
import { noteMatchChanged } from "./realtime.js";
import { setUserUnavailableHook } from "../tombstones.js";

/**
 * Tables a tombstone replay has to keep consistent. Replay closes live matches.
 * It does not delete ledger rows, ratings, or finished history.
 */
export const PVP_TOMBSTONE_TABLES = [
  "pvp_challenges",
  "pvp_matches",
  "pvp_match_players",
  "pvp_active_members",
  "pvp_actions",
  "pvp_rounds",
  "pvp_settlements",
  "pvp_commands",
  "pvp_ratings",
  "pvp_reward_days",
  "pvp_blocks",
  "pvp_reports",
  "pvp_runtime_control",
  "jiu_coin_ledger",
];

function statusOf(db, userId) {
  return db.prepare(`SELECT status FROM users WHERE id = ?`).get(userId)?.status || "";
}

/**
 * End this user's live matches inside the caller's transaction.
 * Waiting rooms are aborted with no fee. A charged room is a forfeit win
 * for the opponent who is still active. Both unavailable refunds the entry.
 */
export function closeMatchesForUnavailableUser(db, userId, now = Date.now()) {
  const matches = db.prepare(
    `SELECT m.id AS id, m.status AS status
     FROM pvp_matches m
     JOIN pvp_match_players p ON p.match_id = m.id
     WHERE p.user_id = ? AND m.status IN ('waiting_ready', 'playing')`
  ).all(userId);
  const finishedIds = [];
  for (const match of matches) {
    const players = db.prepare(
      `SELECT user_id FROM pvp_match_players WHERE match_id = ? ORDER BY seat ASC`
    ).all(match.id);
    const down = players.filter((player) => statusOf(db, player.user_id) !== "active");
    let closed;
    if (match.status === "waiting_ready" || down.length >= players.length) {
      const reason = down.length >= players.length ? "both_unavailable" : "account_unavailable";
      closed = finishMatchInTx(db, { matchId: match.id, terminalType: "aborted", reason, now });
    } else {
      const winner = players.find((player) => statusOf(db, player.user_id) === "active");
      closed = finishMatchInTx(db, {
        matchId: match.id,
        terminalType: "forfeited",
        reason: "account_unavailable",
        winnerUserId: winner.user_id,
        now,
      });
    }
    if (!closed.ok) throw new Error(closed.message || "pvp close failed");
    finishedIds.push(match.id);
  }
  db.prepare(
    `UPDATE pvp_challenges
     SET status = 'cancelled', responded_at = ?, cancel_reason = 'account_unavailable'
     WHERE status = 'pending' AND (from_user_id = ? OR to_user_id = ?)`
  ).run(now, userId, userId);
  setAvailable(userId, false, now);
  for (const matchId of finishedIds) noteMatchChanged(matchId);
  return finishedIds;
}

setUserUnavailableHook(closeMatchesForUnavailableUser);
