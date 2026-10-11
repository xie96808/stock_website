import { shanghaiYmd } from "../jiuCoin.js";
import { decideCompletedWinner } from "../../../../shared/pvpMetrics.js";
import { PVP_RATING_INITIAL, applyPair } from "../../../../shared/pvpRating.js";
import { PVP_RATING_VERSION } from "./config.js";
import { entryCharge, payPvp } from "./economy.js";
import { withImmediate } from "./tx.js";

function playersOf(db, matchId) {
  return db
    .prepare(`SELECT * FROM pvp_match_players WHERE match_id = ? ORDER BY seat ASC`)
    .all(matchId);
}

function existing(db, matchId) {
  return db.prepare(`SELECT * FROM pvp_settlements WHERE match_id = ?`).get(matchId);
}

function bumpReward(db, userId, ymd) {
  db.prepare(
    `INSERT INTO pvp_reward_days (user_id, ymd, win_reward_count)
     VALUES (?, ?, 1)
     ON CONFLICT(user_id, ymd) DO UPDATE SET win_reward_count = win_reward_count + 1`
  ).run(userId, ymd);
}

function recordRating(db, userId, { after, win, loss, draw, completed, returnPpm, now }) {
  const row = db.prepare(`SELECT user_id FROM pvp_ratings WHERE user_id = ?`).get(userId);
  if (!row) {
    db.prepare(
      `INSERT INTO pvp_ratings (
        user_id, rating, games, wins, losses, draws, completed_games, completed_return_sum_ppm, updated_at
      ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)`
    ).run(
      userId,
      after,
      win,
      loss,
      draw,
      completed ? 1 : 0,
      completed ? returnPpm : 0,
      now
    );
    return;
  }
  db.prepare(
    `UPDATE pvp_ratings SET
       rating = ?,
       games = games + 1,
       wins = wins + ?,
       losses = losses + ?,
       draws = draws + ?,
       completed_games = completed_games + ?,
       completed_return_sum_ppm = completed_return_sum_ppm + ?,
       updated_at = ?
     WHERE user_id = ?`
  ).run(
    after,
    win,
    loss,
    draw,
    completed ? 1 : 0,
    completed ? returnPpm : 0,
    now,
    userId
  );
}

/**
 * Finish a waiting_ready (no refund) or playing (refund charged entry) match.
 * Must run inside the caller's transaction. A second call returns the stored row.
 */
export function finishMatchInTx(db, { matchId, terminalType, reason, winnerUserId = null, metrics = null, now }) {
  const prior = existing(db, matchId);
  if (prior) return { ok: true, unchanged: true, settlement: prior };

  const match = db.prepare(`SELECT * FROM pvp_matches WHERE id = ?`).get(matchId);
  if (!match) {
    return { ok: false, code: "NOT_FOUND", message: "对局不存在", status: 404 };
  }
  if (match.status !== "waiting_ready" && match.status !== "playing") {
    const settled = existing(db, matchId);
    return settled
      ? { ok: true, unchanged: true, settlement: settled }
      : { ok: false, code: "MATCH_CLOSED", message: "对局已结束", status: 409 };
  }
  if (match.status === "waiting_ready" && terminalType !== "aborted") {
    return { ok: false, code: "MATCH_CLOSED", message: "对局还没开始", status: 409 };
  }

  const players = playersOf(db, matchId);
  if (players.length !== 2) {
    return { ok: false, code: "BAD_MATCH", message: "对局人数异常", status: 500 };
  }

  let winner = winnerUserId;
  let finalReason = reason;
  let scoredSeats = null;
  const scored = terminalType === "completed" || terminalType === "forfeited";
  if (terminalType === "forfeited" && !players.some((p) => p.user_id === winnerUserId)) {
    return { ok: false, code: "BAD_WINNER", message: "弃权胜者不是对局玩家", status: 500 };
  }
  if (terminalType === "completed") {
    const byId = new Map(players.map((p) => [p.user_id, p]));
    const seats = players.map((p) => {
      const metric = metrics?.[p.user_id];
      if (!metric || !Number.isInteger(metric.returnPpm) || !Number.isInteger(metric.mddPpm)) {
        return null;
      }
      return { userId: p.user_id, returnPpm: metric.returnPpm, mddPpm: metric.mddPpm, row: byId.get(p.user_id) };
    });
    if (seats.some((s) => s == null)) {
      return { ok: false, code: "BAD_METRICS", message: "缺少终局收益", status: 500 };
    }
    winner = decideCompletedWinner(seats[0], seats[1]);
    if (winner == null) finalReason = "completed_draw";
    else if (seats[0].returnPpm !== seats[1].returnPpm) finalReason = "completed_return";
    else finalReason = "completed_drawdown";
    scoredSeats = seats;
  }

  const economy = match.economy_json ? JSON.parse(match.economy_json) : null;
  if (match.status === "playing" && !economy) {
    return { ok: false, code: "BAD_ECONOMY", message: "缺少开局经济快照", status: 500 };
  }

  const nextStatus = terminalType === "aborted" ? "aborted" : "settled";
  const updated = db
    .prepare(
      `UPDATE pvp_matches
       SET status = ?, terminal_reason = ?, winner_user_id = ?, finished_at = ?, revision = revision + 1
       WHERE id = ? AND status = ?`
    )
    .run(nextStatus, finalReason, winner, now, matchId, match.status);
  if (updated.changes !== 1) {
    const raced = existing(db, matchId);
    return raced
      ? { ok: true, unchanged: true, settlement: raced }
      : { ok: false, code: "MATCH_CLOSED", message: "对局已结束", status: 409 };
  }

  const info = db
    .prepare(
      `INSERT INTO pvp_settlements (
        match_id, terminal_type, reason, winner_user_id, resolved_rounds, economy_version, rating_version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      matchId,
      terminalType,
      finalReason,
      winner,
      match.resolved_rounds,
      economy?.economyVersion || null,
      scored ? PVP_RATING_VERSION : null,
      now
    );

  if (scoredSeats) {
    const writeMetric = db.prepare(
      `UPDATE pvp_match_players SET return_ppm = ?, mdd_ppm = ? WHERE match_id = ? AND user_id = ?`
    );
    for (const seat of scoredSeats) writeMetric.run(seat.returnPpm, seat.mddPpm, matchId, seat.userId);
  }

  const money = [];
  for (const player of players) {
    let amount = 0;
    let reasonPaid = null;
    let outcome = "aborted";
    if (terminalType === "aborted") {
      amount = entryCharge(db, player.user_id, matchId);
      reasonPaid = amount > 0 ? "pvp_refund" : null;
      outcome = "aborted";
    } else if (winner == null) {
      amount = economy.entryCost;
      reasonPaid = "pvp_refund";
      outcome = "draw";
    } else if (player.user_id === winner) {
      amount = economy.winReward;
      reasonPaid = "pvp_reward";
      outcome = "win";
    } else {
      outcome = "loss";
    }
    if (reasonPaid) {
      payPvp(db, {
        userId: player.user_id,
        matchId,
        amount,
        reason: reasonPaid,
        economyVersion: economy?.economyVersion || null,
      });
    }
    const charged = entryCharge(db, player.user_id, matchId);
    const net = -charged + amount;
    db.prepare(
      `UPDATE pvp_match_players SET outcome = ?, coin_delta = ? WHERE match_id = ? AND user_id = ?`
    ).run(outcome, net, matchId, player.user_id);
    money.push({
      userId: player.user_id,
      outcome,
      entryCharged: charged,
      payout: amount,
      netDelta: net,
    });
  }

  if (winner != null && match.reward_ymd && terminalType !== "aborted") {
    bumpReward(db, winner, match.reward_ymd);
  }

  if (scored) {
    const scoreA = winner == null ? 0.5 : players[0].user_id === winner ? 1 : 0;
    const beforeA = players[0].rating_before ?? PVP_RATING_INITIAL;
    const beforeB = players[1].rating_before ?? PVP_RATING_INITIAL;
    const rated = applyPair({ ratingA: beforeA, ratingB: beforeB, scoreA });
    const applied = [rated.a, rated.b];
    players.forEach((player, index) => {
      const part = applied[index];
      const mine = money.find((m) => m.userId === player.user_id);
      const win = mine.outcome === "win" ? 1 : 0;
      const loss = mine.outcome === "loss" ? 1 : 0;
      const draw = mine.outcome === "draw" ? 1 : 0;
      const metric = metrics?.[player.user_id];
      db.prepare(
        `UPDATE pvp_match_players
         SET rating_after = ?, actual_rating_delta = ?
         WHERE match_id = ? AND user_id = ?`
      ).run(part.after, part.actualDelta, matchId, player.user_id);
      recordRating(db, player.user_id, {
        after: part.after,
        win,
        loss,
        draw,
        completed: terminalType === "completed",
        returnPpm: metric?.returnPpm || 0,
        now,
      });
      mine.ratingBefore = part.before;
      mine.ratingAfter = part.after;
      mine.actualDelta = part.actualDelta;
    });
  }

  db.prepare(`DELETE FROM pvp_active_members WHERE match_id = ?`).run(matchId);

  return {
    ok: true,
    unchanged: false,
    settlementId: Number(info.lastInsertRowid),
    terminalType,
    reason: finalReason,
    winnerUserId: winner,
    players: money,
    rewardYmd: match.reward_ymd,
  };
}

export function finishMatch(db, args) {
  return withImmediate(db, () => finishMatchInTx(db, args));
}

export function rewardYmdFor(now) {
  return shanghaiYmd(new Date(now));
}
