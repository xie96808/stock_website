/**
 * Intraday sessions, public phases, and daily boards.
 * settleIntradaySession is the only writer of intraday_results.
 * It returns errors instead of throwing so an expired UPDATE in the same
 * transaction is not rolled back by better-sqlite3.
 */
import crypto from "node:crypto";
import { openDb } from "../db/connection.js";
import { sha256Text } from "./dataset.js";
import {
  challengeNow,
  shanghaiYmdAt,
  shanghaiDayOpensAt,
  shanghaiDayClosesAt,
} from "./dailyChallenge.js";
import { shanghaiYmd } from "./jiuCoin.js";
import {
  deductGameCreateCost,
  getJiuCoinBalance,
  JIU_COIN_INTRADAY_RANKED_COST,
  JIU_COIN_INTRADAY_PRACTICE_COST,
} from "./jiuCoin.js";
import { readTape, intradayLibraryStatus } from "./intradayPack.js";
import { limitBandFen } from "../../../shared/intradayTape.js";
import {
  replayIntraday,
  playbackClock,
  actDeadlineMs,
  INTRADAY_RANKED_BAR_MS,
  INTRADAY_BAR_COUNT,
  SCORE_VERSION_INTRADAY_V1,
} from "../../../shared/intradayEngine.js";

export const INTRADAY_JOIN_LEAD_MS = 60_000;
export const INTRADAY_EXPIRE_GRACE_MS = 90_000;
export const INTRADAY_PREFETCH_BARS = 20;
const PROTOCOL = "intraday-v1";

function fail(status, code, message, details, log) {
  return { error: { status, code, message, details, log } };
}

function requireKey(createKey) {
  if (!createKey || typeof createKey !== "string" || createKey.length < 8 || createKey.length > 128) {
    return fail(400, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key 必填（8-128）");
  }
  return null;
}

function cmpUtf8(a, b) {
  return Buffer.compare(Buffer.from(String(a), "utf8"), Buffer.from(String(b), "utf8"));
}

function ymdPlus(baseYmd, offsetDays) {
  const ms = Date.parse(`${baseYmd}T12:00:00+08:00`) + offsetDays * 24 * 60 * 60 * 1000;
  return shanghaiYmd(new Date(ms));
}

function phaseIso(ymd, hm) {
  return new Date(Date.parse(`${ymd}T${hm}:00+08:00`)).toISOString();
}

/**
 * Pure pick. `eligible` is sorted here by session_date, symbol, id (UTF-8 bytes).
 * A full lap of recent symbols returns null; the caller must not insert that day.
 */
export function pickChallengeTape(challengeDate, eligible, recentSymbols) {
  if (!Array.isArray(eligible) || eligible.length === 0) return null;
  const rows = eligible.map((row) => ({
    id: row.id,
    symbol: row.symbol,
    sessionDate: row.sessionDate || row.session_date,
  }));
  rows.sort(
    (a, b) =>
      cmpUtf8(a.sessionDate, b.sessionDate) ||
      cmpUtf8(a.symbol, b.symbol) ||
      cmpUtf8(a.id, b.id)
  );
  const digest = crypto
    .createHash("sha256")
    .update(`${challengeDate}\n${SCORE_VERSION_INTRADAY_V1}`, "utf8")
    .digest();
  const idx = digest.readUInt32BE(0) % rows.length;
  const recent = new Set(recentSymbols || []);
  for (let step = 0; step < rows.length; step += 1) {
    const row = rows[(idx + step) % rows.length];
    if (!recent.has(row.symbol)) return row;
  }
  return null;
}

/** Insert one day if absent. Returns false when the row exists or the ring is exhausted. */
export function ensureIntradayChallenge(db, ymd) {
  const existing = db
    .prepare(`SELECT id, tape_id FROM intraday_challenges WHERE challenge_date = ?`)
    .get(ymd);
  if (existing) return false;
  const eligible = db
    .prepare(`SELECT id, symbol, session_date FROM intraday_tapes WHERE eligible = 1`)
    .all();
  const recent = db
    .prepare(
      `SELECT t.symbol AS symbol
       FROM intraday_challenges c
       JOIN intraday_tapes t ON t.id = c.tape_id
       WHERE c.challenge_date < ?
       ORDER BY c.challenge_date DESC
       LIMIT 5`
    )
    .all(ymd)
    .map((row) => row.symbol);
  const picked = pickChallengeTape(ymd, eligible, recent);
  if (!picked) {
    console.warn(JSON.stringify({ code: "INTRADAY_NOT_READY", challengeDate: ymd }));
    return false;
  }
  const tape = db.prepare(`SELECT sha256 FROM intraday_tapes WHERE id = ?`).get(picked.id);
  if (!tape) return false;
  const info = db
    .prepare(
      `INSERT OR IGNORE INTO intraday_challenges (
        id, challenge_date, opens_at, closes_at, flat_phase_starts_at, long_phase_starts_at,
        tape_id, score_version, snapshot_sha256, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'published')`
    )
    .run(
      `intraday:${ymd}`,
      ymd,
      shanghaiDayOpensAt(ymd),
      shanghaiDayClosesAt(ymd),
      phaseIso(ymd, "21:00"),
      phaseIso(ymd, "21:05"),
      picked.id,
      SCORE_VERSION_INTRADAY_V1,
      tape.sha256
    );
  return info.changes === 1;
}

/** Today ± 7 Shanghai days, ascending, so a later day sees symbols already inserted. */
export function seedNearIntradayChallenges(now = challengeNow(), db = openDb()) {
  const today = shanghaiYmdAt(now);
  const dates = [];
  for (let offset = -7; offset <= 7; offset += 1) dates.push(ymdPlus(today, offset));
  const tx = db.transaction(() => {
    let created = 0;
    for (const ymd of dates) {
      if (ensureIntradayChallenge(db, ymd)) created += 1;
    }
    return created;
  });
  return tx.immediate();
}

function readActions(session) {
  try {
    const parsed = JSON.parse(session.canonical_actions_json || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadChallenge(db, session) {
  if (!session?.challenge_id) return null;
  return db.prepare(`SELECT * FROM intraday_challenges WHERE id = ?`).get(session.challenge_id) || null;
}

function originOf(session, challenge) {
  if (session.mode === "ranked") {
    const iso = session.start_mode === "long"
      ? challenge?.long_phase_starts_at
      : challenge?.flat_phase_starts_at;
    return Date.parse(iso);
  }
  return session.clock_origin_ms;
}

function phaseStartsAtOf(session, challenge) {
  if (session.mode !== "ranked" || !challenge) return null;
  return session.start_mode === "long"
    ? challenge.long_phase_starts_at
    : challenge.flat_phase_starts_at;
}

/** Ranked playback ignores clock_origin_ms and paused_at_ms. Practice may freeze `now`. */
function clockFor(session, challenge, nowMs) {
  const pausedAtMs = session.mode === "practice" ? session.paused_at_ms : null;
  return playbackClock({
    originMs: originOf(session, challenge),
    nowMs,
    intervalMs: INTRADAY_RANKED_BAR_MS,
    barCount: INTRADAY_BAR_COUNT,
    pausedAtMs,
  });
}

function sliceBars(decoded, fromExclusive, toInclusive) {
  const out = [];
  for (let i = fromExclusive + 1; i <= toInclusive && i < decoded.length; i += 1) {
    if (i < 0) continue;
    const bar = decoded[i];
    out.push({ i, closeFen: bar.closeFen, volumeLot: bar.volumeLot, avgFen: bar.avgFen });
  }
  return out;
}

function markState(startMode, closes, actions, cursor, prevCloseFen, limitPct) {
  if (cursor < 0) {
    return { position: startMode === "long" ? "long" : "empty", markReturnPpm: 0 };
  }
  const replay = replayIntraday({
    startMode,
    bars: closes,
    actions,
    revealThrough: cursor,
    prevCloseFen,
    limitPct,
    fees: true,
    finish: false,
  });
  if (!replay.ok) return { error: replay };
  return { position: replay.position, markReturnPpm: replay.markReturnPpm };
}

function progressDto(fields) {
  const dto = {
    sessionId: fields.sessionId,
    protocolVersion: PROTOCOL,
    scoreVersion: fields.scoreVersion,
    mode: fields.mode,
    startMode: fields.startMode,
    revision: fields.revision,
    cursor: fields.cursor,
    barCount: INTRADAY_BAR_COUNT,
    barIntervalMs: INTRADAY_RANKED_BAR_MS,
    prevCloseFen: fields.prevCloseFen,
    limitUpFen: fields.limitUpFen,
    limitDownFen: fields.limitDownFen,
    position: fields.position,
    markReturnPpm: fields.markReturnPpm,
    bars: fields.bars,
    serverNowMs: fields.serverNowMs,
    phaseStartsAt: fields.phaseStartsAt,
    tapeClosed: fields.tapeClosed,
    settleReady: fields.settleReady,
  };
  if (fields.fillBar) dto.fillBar = fields.fillBar;
  return dto;
}

function tapeView(loaded) {
  const prevCloseFen = loaded.validated.canonical.prevCloseFen;
  const limitPct = loaded.validated.canonical.limitPct;
  const band = limitBandFen(prevCloseFen, limitPct);
  return {
    prevCloseFen,
    limitPct,
    limitUpFen: band.limitUpFen,
    limitDownFen: band.limitDownFen,
    closes: loaded.validated.closes,
    decoded: loaded.validated.bars,
    canonical: loaded.validated.canonical,
  };
}

function dtoFromSession(db, session, nowMs, { bars, fillBar, cursor, revision, position, markReturnPpm } = {}) {
  const challenge = loadChallenge(db, session);
  const loaded = readTape(db, session.tape_id);
  if (!loaded.ok) return null;
  if (challenge && loaded.row.sha256 !== challenge.snapshot_sha256) return null;
  const view = tapeView(loaded);
  const clock = clockFor(session, challenge, nowMs);
  const actions = readActions(session);
  const cur = cursor != null ? cursor : session.cursor;
  const mark = position != null
    ? { position, markReturnPpm }
    : markState(session.start_mode, view.closes, actions, cur, view.prevCloseFen, view.limitPct);
  if (mark.error) return null;
  const shown = bars != null
    ? bars
    : sliceBars(view.decoded, -1, Math.min(cur, clock.released));
  return progressDto({
    sessionId: session.id,
    scoreVersion: session.score_version,
    mode: session.mode,
    startMode: session.start_mode,
    revision: revision != null ? revision : session.revision,
    cursor: cur,
    prevCloseFen: view.prevCloseFen,
    limitUpFen: view.limitUpFen,
    limitDownFen: view.limitDownFen,
    position: mark.position,
    markReturnPpm: mark.markReturnPpm,
    bars: shown,
    serverNowMs: nowMs,
    phaseStartsAt: phaseStartsAtOf(session, challenge),
    tapeClosed: clock.tapeClosed,
    settleReady: clock.settleReady,
    fillBar,
  });
}

function sameActions(client, server) {
  if (client.length !== server.length) return false;
  for (let i = 0; i < client.length; i += 1) {
    if (client[i].barIndex !== server[i].barIndex || client[i].side !== server[i].side) return false;
  }
  return true;
}

function insertCommand(db, fields) {
  db.prepare(
    `INSERT INTO intraday_commands (
      id, session_id, command_key, payload_hash, type,
      revision_before, revision_after, event_json, response_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    crypto.randomUUID(),
    fields.sessionId,
    fields.commandKey,
    fields.payloadHash,
    fields.type,
    fields.revisionBefore,
    fields.revisionAfter,
    fields.eventJson,
    JSON.stringify(fields.response)
  );
}

/**
 * Only insert path for intraday_results.
 * @returns {{ok:true, returnPpm:number, tradeCount:number, feeDragPpm:number, liquidation?:number, already?:boolean}
 *   | {ok:false, httpStatus:number, code:string, message:string}}
 */
export function settleIntradaySession(db, sessionId, nowMs) {
  const existing = db
    .prepare(
      `SELECT return_ppm, trade_count, fee_drag_ppm, liquidation
       FROM intraday_results WHERE session_id = ?`
    )
    .get(sessionId);
  if (existing) {
    return {
      ok: true,
      returnPpm: existing.return_ppm,
      tradeCount: existing.trade_count,
      feeDragPpm: existing.fee_drag_ppm,
      liquidation: existing.liquidation,
      already: true,
    };
  }
  const session = db.prepare(`SELECT * FROM intraday_sessions WHERE id = ?`).get(sessionId);
  if (!session || session.status !== "active") {
    return { ok: false, httpStatus: 409, code: "GAME_NOT_ACTIVE", message: "对局不在进行中" };
  }
  const challenge = loadChallenge(db, session);
  const clock = clockFor(session, challenge, nowMs);
  if (!clock.settleReady) {
    return { ok: false, httpStatus: 409, code: "TAPE_NOT_FINISHED", message: "分时尚未到结算时刻" };
  }
  const loaded = readTape(db, session.tape_id);
  if (!loaded.ok) {
    return { ok: false, httpStatus: 503, code: "INTRADAY_NOT_READY", message: "分时带子不可用" };
  }
  if (challenge && loaded.row.sha256 !== challenge.snapshot_sha256) {
    return { ok: false, httpStatus: 503, code: "INTRADAY_NOT_READY", message: "分时题目校验失败" };
  }
  const view = tapeView(loaded);
  const actions = readActions(session);
  const replay = replayIntraday({
    startMode: session.start_mode,
    bars: view.closes,
    actions,
    prevCloseFen: view.prevCloseFen,
    limitPct: view.limitPct,
    fees: true,
    finish: true,
  });
  if (!replay.ok) {
    return { ok: false, httpStatus: 422, code: replay.code, message: replay.message || "结算失败" };
  }
  const nowIso = new Date(nowMs).toISOString();
  const actionsJson = JSON.stringify(actions);
  db.prepare(
    `INSERT INTO intraday_results (
      session_id, submission_hash, actions_json, trades_json, return_ppm, fee_drag_ppm,
      trade_count, liquidation, end_position, score_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'empty', ?)`
  ).run(
    session.id,
    sha256Text(actionsJson),
    actionsJson,
    JSON.stringify(replay.trades),
    replay.returnPpm,
    replay.feeDragPpm,
    replay.tradeCount,
    replay.liquidation ? 1 : 0,
    replay.scoreVersion
  );
  db.prepare(
    `UPDATE intraday_sessions SET status = 'settled', finished_at = ? WHERE id = ? AND status = 'active'`
  ).run(nowIso, session.id);
  if (session.mode === "ranked" && challenge) {
    const onTime = nowMs < Date.parse(challenge.closes_at);
    db.prepare(
      `UPDATE intraday_attempts
       SET status = ?, board_eligible = ?, return_ppm = ?, trade_count = ?, fee_drag_ppm = ?, settled_at = ?
       WHERE session_id = ? AND status = 'active'`
    ).run(
      onTime ? "settled" : "settle_late",
      onTime ? 1 : 0,
      replay.returnPpm,
      replay.tradeCount,
      replay.feeDragPpm,
      nowIso,
      session.id
    );
  }
  return {
    ok: true,
    returnPpm: replay.returnPpm,
    tradeCount: replay.tradeCount,
    feeDragPpm: replay.feeDragPpm,
    liquidation: replay.liquidation ? 1 : 0,
    already: false,
  };
}

/** Settle a closed tape, or expire one that missed the window. Does not insert on its own. */
export function sweepIntradayForUser(db, userId, nowMs) {
  const rows = db
    .prepare(`SELECT * FROM intraday_sessions WHERE user_id = ? AND status = 'active'`)
    .all(userId);
  for (const row of rows) {
    const challenge = loadChallenge(db, row);
    const clock = clockFor(row, challenge, nowMs);
    if (clock.settleReady) {
      settleIntradaySession(db, row.id, nowMs);
      continue;
    }
    if (nowMs >= Date.parse(row.expires_at)) {
      db.prepare(
        `UPDATE intraday_sessions SET status = 'expired' WHERE id = ? AND status = 'active'`
      ).run(row.id);
      if (row.mode === "ranked") {
        db.prepare(
          `UPDATE intraday_attempts
           SET status = 'expired', board_eligible = 0
           WHERE session_id = ? AND status = 'active'`
        ).run(row.id);
      }
    }
  }
}

function blockedTapeIds(db, nowMs) {
  const need = INTRADAY_BAR_COUNT * INTRADAY_RANKED_BAR_MS;
  const rows = db
    .prepare(`SELECT tape_id, flat_phase_starts_at, long_phase_starts_at FROM intraday_challenges`)
    .all();
  const blocked = new Set();
  for (const row of rows) {
    const flatClosed = nowMs >= Date.parse(row.flat_phase_starts_at) + need;
    const longClosed = nowMs >= Date.parse(row.long_phase_starts_at) + need;
    if (!flatClosed || !longClosed) blocked.add(row.tape_id);
  }
  return blocked;
}

function chanceLeft(db, userId, challengeId, startMode) {
  if (!challengeId) return 0;
  const row = db
    .prepare(
      `SELECT 1 AS ok FROM intraday_attempts
       WHERE user_id = ? AND challenge_id = ? AND start_mode = ?`
    )
    .get(userId, challengeId, startMode);
  return row ? 0 : 1;
}

function costOf(mode) {
  return mode === "ranked" ? JIU_COIN_INTRADAY_RANKED_COST : JIU_COIN_INTRADAY_PRACTICE_COST;
}

export function getIntradayStatus(userId = null) {
  const db = openDb();
  const now = challengeNow();
  const nowMs = now.getTime();
  const ymd = shanghaiYmdAt(now);
  try {
    seedNearIntradayChallenges(now, db);
  } catch (e) {
    console.warn("intraday seed failed:", e.message || e);
  }
  const lib = intradayLibraryStatus(db);
  const cost = {
    ranked: JIU_COIN_INTRADAY_RANKED_COST,
    practice: JIU_COIN_INTRADAY_PRACTICE_COST,
  };
  if (!lib.ready) {
    return {
      ready: false,
      tapeCount: lib.tapeCount,
      message: "分时题库准备中",
      phaseStartsAt: null,
      serverNowMs: nowMs,
      cost,
    };
  }
  const challenge = db
    .prepare(`SELECT * FROM intraday_challenges WHERE challenge_date = ?`)
    .get(ymd);
  let phaseStartsAt = null;
  if (challenge) {
    const tape = db.prepare(`SELECT sha256 FROM intraday_tapes WHERE id = ?`).get(challenge.tape_id);
    if (tape && tape.sha256 === challenge.snapshot_sha256) {
      phaseStartsAt = {
        flat: challenge.flat_phase_starts_at,
        long: challenge.long_phase_starts_at,
      };
    }
  }
  const out = {
    ready: true,
    tapeCount: lib.tapeCount,
    date: ymd,
    phaseStartsAt,
    closesAt: challenge?.closes_at || null,
    cost,
    serverNowMs: nowMs,
    barIntervalMs: INTRADAY_RANKED_BAR_MS,
    barCount: INTRADAY_BAR_COUNT,
  };
  if (!userId) {
    out.remainingChance = null;
    out.activeSession = null;
    return out;
  }
  out.remainingChance = {
    flat: chanceLeft(db, userId, challenge?.id, "flat"),
    long: chanceLeft(db, userId, challenge?.id, "long"),
  };
  const active = db
    .prepare(`SELECT * FROM intraday_sessions WHERE user_id = ? AND status = 'active'`)
    .get(userId);
  out.activeSession = active ? dtoFromSession(db, active, nowMs) : null;
  out.balance = getJiuCoinBalance(userId, db);
  return out;
}

export function createIntradaySession(userId, { mode, startMode, createKey } = {}) {
  if (mode !== "ranked" && mode !== "practice") {
    return fail(400, "INVALID_MODE", "mode 必须是 ranked 或 practice");
  }
  if (startMode !== "flat" && startMode !== "long") {
    return fail(400, "INVALID_START_MODE", "startMode 必须是 flat 或 long");
  }
  const keyErr = requireKey(createKey);
  if (keyErr) return keyErr;
  const payloadHash = sha256Text(JSON.stringify({ mode, startMode }));
  const db = openDb();
  const now = challengeNow();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();

  const existing = db
    .prepare(`SELECT * FROM intraday_sessions WHERE user_id = ? AND create_key = ?`)
    .get(userId, createKey);
  if (existing) {
    if (existing.create_payload_hash !== payloadHash) {
      return fail(409, "IDEMPOTENCY_CONFLICT", "同一幂等键不能用于不同开局参数");
    }
    const data = dtoFromSession(db, existing, nowMs, { bars: [] });
    return { status: 200, data: data || { sessionId: existing.id, revision: existing.revision } };
  }

  try {
    seedNearIntradayChallenges(now, db);
  } catch (e) {
    console.warn("intraday seed failed:", e.message || e);
  }

  const lib = intradayLibraryStatus(db);
  if (!lib.ready) {
    return fail(503, "INTRADAY_NOT_READY", "分时题库准备中");
  }

  const ymd = shanghaiYmdAt(now);
  let challenge = null;
  let phaseStartsAtMs = null;
  if (mode === "ranked") {
    challenge = db.prepare(`SELECT * FROM intraday_challenges WHERE challenge_date = ?`).get(ymd);
    if (!challenge) return fail(503, "INTRADAY_NOT_READY", "分时题库准备中");
    const tape = db.prepare(`SELECT sha256 FROM intraday_tapes WHERE id = ?`).get(challenge.tape_id);
    if (!tape || tape.sha256 !== challenge.snapshot_sha256) {
      return fail(503, "INTRADAY_NOT_READY", "分时题目校验失败");
    }
    phaseStartsAtMs = Date.parse(
      startMode === "long" ? challenge.long_phase_starts_at : challenge.flat_phase_starts_at
    );
    const tapeClosedAt = phaseStartsAtMs + INTRADAY_BAR_COUNT * INTRADAY_RANKED_BAR_MS;
    if (nowMs < phaseStartsAtMs - INTRADAY_JOIN_LEAD_MS) {
      return fail(409, "PHASE_NOT_OPEN", "该档相位尚未开放", {
        phaseStartsAt: new Date(phaseStartsAtMs).toISOString(),
      });
    }
    if (nowMs >= tapeClosedAt) {
      return fail(409, "PHASE_CLOSED", "该档相位已结束");
    }
  }

  const id = crypto.randomUUID();
  const cost = costOf(mode);

  try {
    const tx = db.transaction(() => {
      sweepIntradayForUser(db, userId, nowMs);
      const againKey = db
        .prepare(`SELECT * FROM intraday_sessions WHERE user_id = ? AND create_key = ?`)
        .get(userId, createKey);
      if (againKey) {
        const err = new Error("IDEMPOTENCY_HIT");
        err.code = "IDEMPOTENCY_HIT";
        err.row = againKey;
        throw err;
      }
      const activeIntra = db
        .prepare(`SELECT id FROM intraday_sessions WHERE user_id = ? AND status = 'active'`)
        .get(userId);
      if (activeIntra) {
        const err = new Error("ACTIVE_INTRADAY");
        err.code = "ACTIVE_INTRADAY";
        err.sessionId = activeIntra.id;
        throw err;
      }
      const activeGame = db
        .prepare(`SELECT * FROM game_sessions WHERE user_id = ? AND status = 'active'`)
        .get(userId);
      if (activeGame) {
        const err = new Error("ACTIVE_GAME_EXISTS");
        err.code = "ACTIVE_GAME_EXISTS";
        err.details = {
          gameId: activeGame.id,
          game: {
            gameId: activeGame.id,
            gameKind: activeGame.game_kind || "classic",
            status: activeGame.status,
            fillMode: activeGame.fill_mode,
          },
          kind: activeGame.game_kind || "classic",
          sessionId: activeGame.id,
        };
        throw err;
      }

      let tapeId;
      let challengeRow = challenge;
      if (mode === "ranked") {
        challengeRow = db.prepare(`SELECT * FROM intraday_challenges WHERE id = ?`).get(challenge.id);
        const attempt = db
          .prepare(
            `SELECT id FROM intraday_attempts
             WHERE user_id = ? AND challenge_id = ? AND start_mode = ?`
          )
          .get(userId, challengeRow.id, startMode);
        if (attempt) {
          const err = new Error("INTRADAY_CHANCE_USED");
          err.code = "INTRADAY_CHANCE_USED";
          throw err;
        }
        const phaseMs = Date.parse(
          startMode === "long" ? challengeRow.long_phase_starts_at : challengeRow.flat_phase_starts_at
        );
        const closedAt = phaseMs + INTRADAY_BAR_COUNT * INTRADAY_RANKED_BAR_MS;
        if (nowMs < phaseMs - INTRADAY_JOIN_LEAD_MS) {
          const err = new Error("PHASE_NOT_OPEN");
          err.code = "PHASE_NOT_OPEN";
          err.phaseStartsAt = new Date(phaseMs).toISOString();
          throw err;
        }
        if (nowMs >= closedAt) {
          const err = new Error("PHASE_CLOSED");
          err.code = "PHASE_CLOSED";
          throw err;
        }
        tapeId = challengeRow.tape_id;
        phaseStartsAtMs = phaseMs;
      } else {
        const blocked = blockedTapeIds(db, nowMs);
        const pool = db
          .prepare(`SELECT id FROM intraday_tapes WHERE eligible = 1`)
          .all()
          .map((row) => row.id)
          .filter((tape) => !blocked.has(tape));
        if (!pool.length) {
          const err = new Error("INTRADAY_NOT_READY");
          err.code = "INTRADAY_NOT_READY";
          throw err;
        }
        tapeId = pool[crypto.randomInt(pool.length)];
      }

      const loaded = readTape(db, tapeId);
      if (!loaded.ok || (challengeRow && loaded.row.sha256 !== challengeRow.snapshot_sha256)) {
        const err = new Error("INTRADAY_NOT_READY");
        err.code = "INTRADAY_NOT_READY";
        throw err;
      }
      const view = tapeView(loaded);
      const originMs = mode === "ranked" ? phaseStartsAtMs : nowMs;
      const clock = playbackClock({
        originMs,
        nowMs,
        intervalMs: INTRADAY_RANKED_BAR_MS,
        barCount: INTRADAY_BAR_COUNT,
        pausedAtMs: null,
      });
      let cursor = -1;
      let bars = [];
      if (mode === "practice") {
        cursor = 0;
        bars = sliceBars(view.decoded, -1, 0);
      } else if (clock.released >= 0) {
        cursor = Math.min(clock.released, INTRADAY_PREFETCH_BARS - 1);
        bars = sliceBars(view.decoded, -1, cursor);
      }
      const mark = markState(startMode, view.closes, [], cursor, view.prevCloseFen, view.limitPct);
      if (mark.error) {
        const err = new Error(mark.error.code || "BAD_TAPE");
        err.code = mark.error.code || "BAD_TAPE";
        throw err;
      }
      const expiresAt = new Date(
        originMs + INTRADAY_BAR_COUNT * INTRADAY_RANKED_BAR_MS + INTRADAY_EXPIRE_GRACE_MS
      ).toISOString();
      db.prepare(
        `INSERT INTO intraday_sessions (
          id, user_id, create_key, create_payload_hash, game_kind, protocol_version, score_version,
          mode, start_mode, challenge_id, tape_id, cursor, revision, canonical_actions_json,
          clock_origin_ms, paused_at_ms, bar_interval_ms, status, started_at, expires_at
        ) VALUES (
          ?, ?, ?, ?, 'intraday', 'intraday-v1', ?,
          ?, ?, ?, ?, ?, 0, '[]',
          ?, NULL, ?, 'active', ?, ?
        )`
      ).run(
        id,
        userId,
        createKey,
        payloadHash,
        SCORE_VERSION_INTRADAY_V1,
        mode,
        startMode,
        mode === "ranked" ? challengeRow.id : null,
        tapeId,
        cursor,
        mode === "practice" ? originMs : null,
        INTRADAY_RANKED_BAR_MS,
        nowIso,
        expiresAt
      );
      if (mode === "ranked") {
        db.prepare(
          `INSERT INTO intraday_attempts (
            id, challenge_id, user_id, start_mode, session_id, status, board_eligible
          ) VALUES (?, ?, ?, ?, ?, 'active', 0)`
        ).run(crypto.randomUUID(), challengeRow.id, userId, startMode, id);
      }
      deductGameCreateCost(userId, id, db, cost, {
        gameKind: "intraday",
        mode,
        startMode,
      });
      const session = {
        id,
        score_version: SCORE_VERSION_INTRADAY_V1,
        mode,
        start_mode: startMode,
        revision: 0,
        cursor,
        challenge_id: mode === "ranked" ? challengeRow.id : null,
        tape_id: tapeId,
        clock_origin_ms: mode === "practice" ? originMs : null,
        paused_at_ms: null,
      };
      return {
        status: 201,
        data: progressDto({
          sessionId: id,
          scoreVersion: SCORE_VERSION_INTRADAY_V1,
          mode,
          startMode,
          revision: 0,
          cursor,
          prevCloseFen: view.prevCloseFen,
          limitUpFen: view.limitUpFen,
          limitDownFen: view.limitDownFen,
          position: mark.position,
          markReturnPpm: mark.markReturnPpm,
          bars,
          serverNowMs: nowMs,
          phaseStartsAt: phaseStartsAtOf(session, challengeRow),
          tapeClosed: clock.tapeClosed,
          settleReady: clock.settleReady,
        }),
      };
    });
    return tx.immediate();
  } catch (e) {
    if (e.code === "IDEMPOTENCY_HIT" && e.row) {
      if (e.row.create_payload_hash !== payloadHash) {
        return fail(409, "IDEMPOTENCY_CONFLICT", "同一幂等键不能用于不同开局参数");
      }
      const data = dtoFromSession(db, e.row, nowMs, { bars: [] });
      return { status: 200, data };
    }
    if (e.code === "INSUFFICIENT_FUNDS") {
      return fail(402, "INSUFFICIENT_FUNDS", e.message || "韭币不足，无法创建分时对局", {
        balance: e.balance ?? null,
        required: e.required ?? cost,
      });
    }
    if (e.code === "ACTIVE_INTRADAY") {
      return fail(409, "ACTIVE_GAME_EXISTS", "已有进行中的分时对局，请先完成或放弃", {
        kind: "intraday",
        sessionId: e.sessionId,
      });
    }
    if (e.code === "ACTIVE_GAME_EXISTS") {
      return fail(409, "ACTIVE_GAME_EXISTS", "已有进行中的云端对局，请先继续或放弃", e.details);
    }
    if (e.code === "INTRADAY_CHANCE_USED") {
      return fail(409, "INTRADAY_CHANCE_USED", "该开局今日机会已使用");
    }
    if (e.code === "PHASE_NOT_OPEN") {
      return fail(409, "PHASE_NOT_OPEN", "该档相位尚未开放", { phaseStartsAt: e.phaseStartsAt });
    }
    if (e.code === "PHASE_CLOSED") {
      return fail(409, "PHASE_CLOSED", "该档相位已结束");
    }
    if (e.code === "INTRADAY_NOT_READY") {
      return fail(503, "INTRADAY_NOT_READY", "分时题库准备中");
    }
    if (String(e.message || "").includes("UNIQUE") || e.code === "SQLITE_CONSTRAINT_UNIQUE") {
      const again = db
        .prepare(`SELECT * FROM intraday_sessions WHERE user_id = ? AND create_key = ?`)
        .get(userId, createKey);
      if (again && again.create_payload_hash === payloadHash) {
        return { status: 200, data: dtoFromSession(db, again, nowMs, { bars: [] }) };
      }
      const activeIntra = db
        .prepare(`SELECT id FROM intraday_sessions WHERE user_id = ? AND status = 'active'`)
        .get(userId);
      if (activeIntra) {
        return fail(409, "ACTIVE_GAME_EXISTS", "已有进行中的分时对局，请先完成或放弃", {
          kind: "intraday",
          sessionId: activeIntra.id,
        });
      }
      if (mode === "ranked" && challenge) {
        const attempt = db
          .prepare(
            `SELECT id FROM intraday_attempts
             WHERE user_id = ? AND challenge_id = ? AND start_mode = ?`
          )
          .get(userId, challenge.id, startMode);
        if (attempt) return fail(409, "INTRADAY_CHANCE_USED", "该开局今日机会已使用");
      }
      return fail(409, "IDEMPOTENCY_CONFLICT", "幂等冲突");
    }
    throw e;
  }
}

function replayCommand(db, sessionId, commandKey, payloadHash) {
  const prior = db
    .prepare(`SELECT * FROM intraday_commands WHERE session_id = ? AND command_key = ?`)
    .get(sessionId, commandKey);
  if (!prior) return null;
  if (prior.payload_hash !== payloadHash) {
    return fail(409, "IDEMPOTENCY_CONFLICT", "同一幂等键不能用于不同请求");
  }
  try {
    return { status: 200, data: JSON.parse(prior.response_json) };
  } catch {
    return fail(409, "IDEMPOTENCY_CONFLICT", "幂等记录损坏");
  }
}

export function advanceIntradaySession(userId, sessionId, body, commandKey) {
  const keyErr = requireKey(commandKey);
  if (keyErr) return keyErr;
  const expectedRevision = body?.expectedRevision;
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    return fail(400, "INVALID_REVISION", "需要 expectedRevision");
  }
  const op = body?.op;
  if (op !== "prefetch" && op !== "act") {
    return fail(400, "INVALID_OP", "op 必须是 prefetch 或 act");
  }
  if (body?.pause != null && typeof body.pause !== "boolean") {
    return fail(400, "INVALID_PAUSE", "pause 必须是布尔值");
  }
  if (op === "prefetch") {
    if (body?.actions != null && (!Array.isArray(body.actions) || body.actions.length !== 0)) {
      return fail(400, "INVALID_ACTIONS", "prefetch 不能携带动作");
    }
  } else if (!Array.isArray(body?.actions) || body.actions.length !== 1) {
    return fail(400, "INVALID_ACTIONS", "act 需要恰好一个动作");
  } else {
    const action = body.actions[0];
    if (!action || !Number.isInteger(action.barIndex) || (action.side !== "buy" && action.side !== "sell")) {
      return fail(400, "INVALID_ACTIONS", "动作需要 barIndex 与 side");
    }
  }
  const payloadHash = sha256Text(JSON.stringify({
    expectedRevision,
    op,
    actions: body?.actions ?? null,
    pause: body?.pause ?? null,
  }));
  const db = openDb();
  const nowMs = challengeNow().getTime();
  const owned = db.prepare(`SELECT user_id FROM intraday_sessions WHERE id = ?`).get(sessionId);
  if (!owned || owned.user_id !== userId) return fail(404, "NOT_FOUND", "对局不存在");

  try {
    const tx = db.transaction(() => {
      sweepIntradayForUser(db, userId, nowMs);
      const replayed = replayCommand(db, sessionId, commandKey, payloadHash);
      if (replayed) return replayed;
      const fresh = db.prepare(`SELECT * FROM intraday_sessions WHERE id = ?`).get(sessionId);
      if (!fresh || fresh.user_id !== userId) return fail(404, "NOT_FOUND", "对局不存在");
      const hasResult = db
        .prepare(`SELECT 1 AS ok FROM intraday_results WHERE session_id = ?`)
        .get(sessionId);
      if (fresh.status !== "active" || hasResult) {
        return fail(409, "GAME_NOT_ACTIVE", "对局不在进行中", { sessionId }, {
          sessionId,
          cursor: fresh.cursor,
        });
      }
      // Ranked pause is rejected without consulting the private clock column.
      if (fresh.mode === "ranked" && body?.pause != null) {
        return fail(409, "PAUSE_NOT_ALLOWED", "正式局不能暂停", { sessionId });
      }
      if (fresh.revision !== expectedRevision) {
        return fail(409, "REVISION_CONFLICT", "revision 不匹配", {
          expected: expectedRevision,
          actual: fresh.revision,
        });
      }
      if (fresh.mode === "practice" && body?.pause === true && fresh.paused_at_ms == null) {
        db.prepare(`UPDATE intraday_sessions SET paused_at_ms = ? WHERE id = ?`).run(nowMs, fresh.id);
        fresh.paused_at_ms = nowMs;
      } else if (fresh.mode === "practice" && body?.pause === false && fresh.paused_at_ms != null) {
        const shifted = fresh.clock_origin_ms + (nowMs - fresh.paused_at_ms);
        db.prepare(
          `UPDATE intraday_sessions SET clock_origin_ms = ?, paused_at_ms = NULL WHERE id = ?`
        ).run(shifted, fresh.id);
        fresh.clock_origin_ms = shifted;
        fresh.paused_at_ms = null;
      }

      const challenge = loadChallenge(db, fresh);
      const loaded = readTape(db, fresh.tape_id);
      if (!loaded.ok || (challenge && loaded.row.sha256 !== challenge.snapshot_sha256)) {
        return fail(503, "INTRADAY_NOT_READY", "分时带子不可用");
      }
      const view = tapeView(loaded);
      const clock = clockFor(fresh, challenge, nowMs);
      const actions = readActions(fresh);
      const phaseStartsAt = phaseStartsAtOf(fresh, challenge);

      if (op === "prefetch") {
        if (fresh.cursor >= clock.released) {
          const mark = markState(
            fresh.start_mode,
            view.closes,
            actions,
            fresh.cursor,
            view.prevCloseFen,
            view.limitPct
          );
          if (mark.error) return fail(422, mark.error.code, mark.error.message || "盯市失败");
          return {
            status: 200,
            data: progressDto({
              sessionId: fresh.id,
              scoreVersion: fresh.score_version,
              mode: fresh.mode,
              startMode: fresh.start_mode,
              revision: fresh.revision,
              cursor: fresh.cursor,
              prevCloseFen: view.prevCloseFen,
              limitUpFen: view.limitUpFen,
              limitDownFen: view.limitDownFen,
              position: mark.position,
              markReturnPpm: mark.markReturnPpm,
              bars: [],
              serverNowMs: nowMs,
              phaseStartsAt,
              tapeClosed: clock.tapeClosed,
              settleReady: clock.settleReady,
            }),
          };
        }
        const base = fresh.cursor < 0 ? -1 : fresh.cursor;
        const newCursor = Math.min(clock.released, base + INTRADAY_PREFETCH_BARS);
        const bars = sliceBars(view.decoded, fresh.cursor, newCursor);
        const mark = markState(
          fresh.start_mode,
          view.closes,
          actions,
          newCursor,
          view.prevCloseFen,
          view.limitPct
        );
        if (mark.error) return fail(422, mark.error.code, mark.error.message || "盯市失败");
        const revisionAfter = fresh.revision + 1;
        const data = progressDto({
          sessionId: fresh.id,
          scoreVersion: fresh.score_version,
          mode: fresh.mode,
          startMode: fresh.start_mode,
          revision: revisionAfter,
          cursor: newCursor,
          prevCloseFen: view.prevCloseFen,
          limitUpFen: view.limitUpFen,
          limitDownFen: view.limitDownFen,
          position: mark.position,
          markReturnPpm: mark.markReturnPpm,
          bars,
          serverNowMs: nowMs,
          phaseStartsAt,
          tapeClosed: clock.tapeClosed,
          settleReady: clock.settleReady,
        });
        const info = db
          .prepare(
            `UPDATE intraday_sessions SET cursor = ?, revision = ?
             WHERE id = ? AND status = 'active' AND revision = ?`
          )
          .run(newCursor, revisionAfter, fresh.id, fresh.revision);
        if (info.changes !== 1) return fail(409, "REVISION_CONFLICT", "revision 不匹配");
        insertCommand(db, {
          sessionId: fresh.id,
          commandKey,
          payloadHash,
          type: "prefetch",
          revisionBefore: fresh.revision,
          revisionAfter,
          eventJson: JSON.stringify({ type: "prefetch", cursor: newCursor }),
          response: data,
        });
        return { status: 200, data };
      }

      const action = { barIndex: body.actions[0].barIndex, side: body.actions[0].side };
      const actNow = fresh.mode === "practice" && fresh.paused_at_ms != null ? fresh.paused_at_ms : nowMs;
      const originMs = originOf(fresh, challenge);
      if (
        action.barIndex > clock.released
        || actNow < originMs + action.barIndex * INTRADAY_RANKED_BAR_MS
      ) {
        return fail(422, "FUTURE_BAR", "该分钟尚未揭示", { barIndex: action.barIndex }, {
          sessionId: fresh.id,
          cursor: fresh.cursor,
          barIndex: action.barIndex,
        });
      }
      if (actNow >= actDeadlineMs(originMs, action.barIndex)) {
        return fail(422, "BAR_CLOSED", "该分钟已关闭", { barIndex: action.barIndex }, {
          sessionId: fresh.id,
          cursor: fresh.cursor,
          barIndex: action.barIndex,
        });
      }
      if (action.barIndex > fresh.cursor) {
        return fail(409, "CURSOR_BEHIND", "该分钟尚未交付", {
          barIndex: action.barIndex,
          cursor: fresh.cursor,
          sessionId: fresh.id,
        }, {
          sessionId: fresh.id,
          cursor: fresh.cursor,
          barIndex: action.barIndex,
        });
      }
      const nextActions = actions.concat([action]);
      const base = fresh.cursor < 0 ? -1 : fresh.cursor;
      const newCursor = fresh.cursor >= clock.released
        ? fresh.cursor
        : Math.min(clock.released, base + INTRADAY_PREFETCH_BARS);
      const revealThrough = Math.max(newCursor, action.barIndex);
      const replay = replayIntraday({
        startMode: fresh.start_mode,
        bars: view.closes,
        actions: nextActions,
        revealThrough,
        prevCloseFen: view.prevCloseFen,
        limitPct: view.limitPct,
        fees: true,
      });
      if (!replay.ok) {
        return fail(422, replay.code, replay.message || "动作无效", { barIndex: action.barIndex }, {
          sessionId: fresh.id,
          cursor: fresh.cursor,
          barIndex: action.barIndex,
        });
      }
      const bars = sliceBars(view.decoded, fresh.cursor, newCursor);
      const fill = view.decoded[action.barIndex];
      const fillBar = {
        i: action.barIndex,
        closeFen: fill.closeFen,
        volumeLot: fill.volumeLot,
        avgFen: fill.avgFen,
      };
      const revisionAfter = fresh.revision + 1;
      const data = progressDto({
        sessionId: fresh.id,
        scoreVersion: fresh.score_version,
        mode: fresh.mode,
        startMode: fresh.start_mode,
        revision: revisionAfter,
        cursor: newCursor,
        prevCloseFen: view.prevCloseFen,
        limitUpFen: view.limitUpFen,
        limitDownFen: view.limitDownFen,
        position: replay.position,
        markReturnPpm: replay.markReturnPpm,
        bars,
        serverNowMs: nowMs,
        phaseStartsAt,
        tapeClosed: clock.tapeClosed,
        settleReady: clock.settleReady,
        fillBar,
      });
      const info = db
        .prepare(
          `UPDATE intraday_sessions
           SET cursor = ?, revision = ?, canonical_actions_json = ?
           WHERE id = ? AND status = 'active' AND revision = ?`
        )
        .run(newCursor, revisionAfter, JSON.stringify(nextActions), fresh.id, fresh.revision);
      if (info.changes !== 1) return fail(409, "REVISION_CONFLICT", "revision 不匹配");
      insertCommand(db, {
        sessionId: fresh.id,
        commandKey,
        payloadHash,
        type: "act",
        revisionBefore: fresh.revision,
        revisionAfter,
        eventJson: JSON.stringify({ type: "act", barIndex: action.barIndex, side: action.side }),
        response: data,
      });
      return { status: 200, data };
    });
    return tx.immediate();
  } catch (e) {
    if (String(e.message || "").includes("UNIQUE") || e.code === "SQLITE_CONSTRAINT_UNIQUE") {
      const again = replayCommand(db, sessionId, commandKey, payloadHash);
      if (again?.data) return again;
      return fail(409, "IDEMPOTENCY_CONFLICT", "幂等冲突");
    }
    throw e;
  }
}

export function finishIntradaySession(userId, sessionId, body, commandKey) {
  if (body?.finish !== true) return fail(400, "FINISH_REQUIRED", "finish 必须为 true");
  const expectedRevision = body?.expectedRevision;
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    return fail(400, "INVALID_REVISION", "需要 expectedRevision");
  }
  const keyErr = requireKey(commandKey);
  if (keyErr) return keyErr;
  let clientActions = null;
  if (body.actions != null) {
    if (!Array.isArray(body.actions)) return fail(400, "INVALID_ACTIONS", "actions 必须是数组");
    clientActions = [];
    for (const item of body.actions) {
      if (!item || !Number.isInteger(item.barIndex) || (item.side !== "buy" && item.side !== "sell")) {
        return fail(400, "INVALID_ACTIONS", "actions 格式错误");
      }
      clientActions.push({ barIndex: item.barIndex, side: item.side });
    }
  }
  const payloadHash = sha256Text(JSON.stringify({
    expectedRevision,
    finish: true,
    actions: clientActions,
  }));
  const db = openDb();
  const nowMs = challengeNow().getTime();
  const owned = db.prepare(`SELECT user_id FROM intraday_sessions WHERE id = ?`).get(sessionId);
  if (!owned || owned.user_id !== userId) return fail(404, "NOT_FOUND", "对局不存在");

  try {
    const tx = db.transaction(() => {
      sweepIntradayForUser(db, userId, nowMs);
      const replayed = replayCommand(db, sessionId, commandKey, payloadHash);
      if (replayed) return replayed;
      const fresh = db.prepare(`SELECT * FROM intraday_sessions WHERE id = ?`).get(sessionId);
      if (!fresh || fresh.user_id !== userId) return fail(404, "NOT_FOUND", "对局不存在");
      const serverActions = readActions(fresh);
      if (clientActions && !sameActions(clientActions, serverActions)) {
        return fail(409, "SUBMISSION_CONFLICT", "动作与服务端记录不一致");
      }
      const settled = settleIntradaySession(db, sessionId, nowMs);
      if (!settled.ok) {
        return fail(settled.httpStatus, settled.code, settled.message, { sessionId }, {
          sessionId,
          cursor: fresh.cursor,
        });
      }
      const after = db.prepare(`SELECT * FROM intraday_sessions WHERE id = ?`).get(sessionId);
      const base = dtoFromSession(db, after, nowMs, { bars: [] }) || {
        sessionId,
        protocolVersion: PROTOCOL,
        scoreVersion: after.score_version,
        mode: after.mode,
        startMode: after.start_mode,
        revision: after.revision,
        cursor: after.cursor,
      };
      const data = {
        ...base,
        bars: [],
        position: "empty",
        returnPpm: settled.returnPpm,
        tradeCount: settled.tradeCount,
        feeDragPpm: settled.feeDragPpm,
        liquidation: settled.liquidation ?? 0,
        endPosition: "empty",
      };
      if (after.mode === "practice") {
        const loaded = readTape(db, after.tape_id);
        if (loaded.ok) {
          data.symbol = loaded.validated.canonical.symbol;
          data.name = loaded.validated.canonical.name;
          data.sessionDate = loaded.validated.canonical.sessionDate;
        }
      }
      if (!settled.already) {
        const revisionAfter = fresh.revision + 1;
        const info = db
          .prepare(
            `UPDATE intraday_sessions SET revision = ? WHERE id = ? AND revision = ?`
          )
          .run(revisionAfter, sessionId, fresh.revision);
        if (info.changes === 1) {
          data.revision = revisionAfter;
          insertCommand(db, {
            sessionId,
            commandKey,
            payloadHash,
            type: "finish",
            revisionBefore: fresh.revision,
            revisionAfter,
            eventJson: JSON.stringify({ type: "finish" }),
            response: data,
          });
        }
      }
      return { status: 200, data };
    });
    return tx.immediate();
  } catch (e) {
    if (String(e.message || "").includes("UNIQUE") || e.code === "SQLITE_CONSTRAINT_UNIQUE") {
      const again = replayCommand(db, sessionId, commandKey, payloadHash);
      if (again?.data) return again;
      const settled = db
        .prepare(`SELECT return_ppm, trade_count, fee_drag_ppm FROM intraday_results WHERE session_id = ?`)
        .get(sessionId);
      if (settled) {
        return {
          status: 200,
          data: {
            sessionId,
            returnPpm: settled.return_ppm,
            tradeCount: settled.trade_count,
            feeDragPpm: settled.fee_drag_ppm,
          },
        };
      }
      return fail(409, "IDEMPOTENCY_CONFLICT", "幂等冲突");
    }
    throw e;
  }
}

export function abandonIntradaySession(userId, sessionId) {
  const db = openDb();
  const nowMs = challengeNow().getTime();
  const nowIso = new Date(nowMs).toISOString();
  const tx = db.transaction(() => {
    const row = db.prepare(`SELECT * FROM intraday_sessions WHERE id = ?`).get(sessionId);
    if (!row || row.user_id !== userId) return fail(404, "NOT_FOUND", "对局不存在");
    sweepIntradayForUser(db, userId, nowMs);
    const fresh = db.prepare(`SELECT * FROM intraday_sessions WHERE id = ?`).get(sessionId);
    if (fresh.status === "abandoned") {
      return { status: 200, data: { sessionId, status: "abandoned" } };
    }
    if (fresh.status !== "active") {
      return fail(409, "GAME_NOT_ACTIVE", "对局不在进行中", { sessionId });
    }
    db.prepare(
      `UPDATE intraday_sessions SET status = 'abandoned', finished_at = ? WHERE id = ? AND status = 'active'`
    ).run(nowIso, sessionId);
    if (fresh.mode === "ranked") {
      db.prepare(
        `UPDATE intraday_attempts SET status = 'abandoned', board_eligible = 0
         WHERE session_id = ? AND status = 'active'`
      ).run(sessionId);
    }
    return { status: 200, data: { sessionId, status: "abandoned" } };
  });
  return tx.immediate();
}

export function getIntradayLeaderboard({ startMode, date, limit = 50 } = {}) {
  if (startMode !== "flat" && startMode !== "long") {
    return fail(400, "INVALID_START_MODE", "startMode 必须是 flat 或 long");
  }
  if (date != null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return fail(400, "INVALID_DATE", "date 必须是 YYYY-MM-DD");
  }
  const db = openDb();
  const now = challengeNow();
  const ymd = date || shanghaiYmdAt(now);
  const challenge = db.prepare(`SELECT * FROM intraday_challenges WHERE challenge_date = ?`).get(ymd);
  if (!challenge) {
    return {
      status: 200,
      data: {
        ready: false,
        date: ymd,
        startMode,
        message: "分时题库准备中",
        entries: [],
        total: 0,
      },
    };
  }
  const pastCutoff = now.getTime() >= Date.parse(challenge.closes_at);
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const rows = db
    .prepare(
      `SELECT
         a.session_id AS session_id,
         a.return_ppm AS return_ppm,
         a.trade_count AS trade_count,
         a.settled_at AS settled_at,
         u.nickname AS nickname,
         u.avatar_id AS avatar_id,
         u.avatar_custom_path AS avatar_custom_path,
         DENSE_RANK() OVER (
           ORDER BY a.return_ppm DESC, a.trade_count ASC, a.settled_at ASC, a.session_id ASC
         ) AS rank
       FROM intraday_attempts a
       JOIN users u ON u.id = a.user_id
       WHERE a.challenge_id = ?
         AND a.start_mode = ?
         AND a.board_eligible = 1
         AND a.status = 'settled'
         AND u.status = 'active'
       ORDER BY a.return_ppm DESC, a.trade_count ASC, a.settled_at ASC, a.session_id ASC
       LIMIT ?`
    )
    .all(challenge.id, startMode, lim);
  const total = db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM intraday_attempts a
       JOIN users u ON u.id = a.user_id
       WHERE a.challenge_id = ?
         AND a.start_mode = ?
         AND a.board_eligible = 1
         AND a.status = 'settled'
         AND u.status = 'active'`
    )
    .get(challenge.id, startMode);
  let symbol = null;
  let sessionDate = null;
  if (pastCutoff) {
    const tape = db
      .prepare(`SELECT symbol, session_date FROM intraday_tapes WHERE id = ?`)
      .get(challenge.tape_id);
    symbol = tape?.symbol || null;
    sessionDate = tape?.session_date || null;
  }
  const entries = rows.map((row) => {
    const custom = row.avatar_custom_path || null;
    const entry = {
      rank: row.rank,
      nickname: row.nickname,
      avatarId: row.avatar_id,
      avatarUrl: custom ? `/api/v1/avatars/${encodeURIComponent(custom)}` : null,
      returnPct: (row.return_ppm / 10000).toFixed(2),
      tradeCount: row.trade_count,
    };
    if (pastCutoff) {
      entry.symbol = symbol;
      entry.sessionDate = sessionDate;
      entry.returnPpm = row.return_ppm;
    }
    return entry;
  });
  return {
    status: 200,
    data: {
      ready: true,
      date: ymd,
      startMode,
      pastCutoff,
      total: Number(total?.c) || 0,
      entries,
    },
  };
}
