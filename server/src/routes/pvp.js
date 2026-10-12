import { Router } from "express";
import { ok, fail } from "../lib/http.js";
import { openDb } from "../db/connection.js";
import { config } from "../lib/config.js";
import { clientIp, consumeRateLimit, rateLimitFail } from "../lib/rateLimit.js";
import { acceptChallenge, cancelChallenge, cancelReady, createChallenge, declineChallenge, markReady } from "../lib/pvp/challenges.js";
import { createShareLink, joinShareLink } from "../lib/pvp/shares.js";
import { listLobby, listMyMatches, lobbySummary, readMyStats, readPvpState } from "../lib/pvp/lobby.js";
import { blockPlayer, fileReport, listBlocks, unblockPlayer } from "../lib/pvp/reports.js";
import { forfeitMatch, lockAction, noteHeartbeat, readMatchView } from "../lib/pvp/match.js";
import { listIncoming, sendReaction } from "../lib/pvp/reactions.js";
import { sendTaunt } from "../lib/pvp/taunts.js";
import { isChallengeableTarget } from "../lib/pvp/botUsers.js";
import { isAvailable, setAvailable, touchPresence } from "../lib/pvp/presence.js";
import { issueWsTicket, noteChallengeChanged, noteLobbyChanged, noteMatchChanged, noteMatchTaunt } from "../lib/pvp/realtime.js";
import { requireUser } from "../middleware/request.js";

const router = Router();

function sendDeny(res, result) {
  if (result?.code === "NOT_PARTICIPANT") return fail(res, 404, "NOT_FOUND", "对局不存在");
  return fail(res, result?.status || 400, result?.code || "BAD_REQUEST", result?.message || "请求无效");
}

function idempotencyKey(req) {
  return req.get("idempotency-key") || "";
}

function objectBody(req, res) {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    fail(res, 400, "BAD_PAYLOAD", "请求格式无效");
    return null;
  }
  return req.body;
}

router.get("/pvp/lobby/summary", (req, res) => {
  return ok(res, lobbySummary(openDb(), Date.now(), req.user?.id ?? null));
});

router.get("/pvp/lobby", requireUser, (req, res) => {
  const limit = Number(req.query.limit || 20);
  if (!Number.isFinite(limit) || limit < 1 || limit > 50) {
    return fail(res, 400, "BAD_PAYLOAD", "列表长度无效");
  }
  return ok(res, listLobby(openDb(), req.user.id, {
    cursor: req.query.cursor || 0,
    limit,
    now: Date.now(),
  }));
});

router.post("/pvp/lobby/presence", requireUser, (req, res) => {
  if (!config.pvpBattleEnabled) return fail(res, 403, "FEATURE_DISABLED", "对战未开放");
  const body = objectBody(req, res);
  if (!body) return;
  const extra = Object.keys(body).filter((key) => key !== "available");
  if (extra.length || typeof body.available !== "boolean") {
    return fail(res, 400, "BAD_PAYLOAD", "包含无法识别的字段");
  }
  const perUser = consumeRateLimit(`pvp:presence:u:${req.user.id}`, 20, 60_000);
  if (!perUser.ok) return rateLimitFail(res, perUser.retryAfterSec, "在线状态切换过于频繁");
  setAvailable(req.user.id, body.available, Date.now());
  noteLobbyChanged();
  return ok(res, { available: body.available === true });
});

router.get("/me/pvp/state", requireUser, (req, res) => {
  return ok(res, readPvpState(openDb(), req.user.id, Date.now()));
});

router.get("/me/pvp/stats", requireUser, (req, res) => {
  return ok(res, readMyStats(openDb(), req.user.id));
});

router.get("/me/pvp/matches", requireUser, (req, res) => {
  const limit = Number(req.query.limit || 20);
  if (!Number.isFinite(limit) || limit < 1 || limit > 50) {
    return fail(res, 400, "BAD_PAYLOAD", "列表长度无效");
  }
  return ok(res, listMyMatches(openDb(), req.user.id, { cursor: req.query.cursor || "", limit }));
});

router.get("/pvp/matches/:id", requireUser, (req, res) => {
  const view = readMatchView(openDb(), {
    matchId: req.params.id,
    viewerId: req.user.id,
    now: Date.now(),
  });
  if (!view) return fail(res, 404, "NOT_FOUND", "对局不存在");
  return ok(res, view);
});

router.post("/pvp/matches/:id/actions", requireUser, (req, res) => {
  const body = objectBody(req, res);
  if (!body) return;
  const extra = Object.keys(body).filter((key) => key !== "round" && key !== "action");
  if (extra.length) return fail(res, 400, "BAD_PAYLOAD", "包含无法识别的字段");
  let result;
  try {
    result = lockAction(openDb(), {
      matchId: req.params.id,
      userId: req.user.id,
      round: body.round,
      action: body.action,
      commandKey: idempotencyKey(req),
      now: Date.now(),
    });
  } catch (err) {
    console.error("pvp action failed:", err && err.message ? err.message : err);
    return fail(res, 500, "RESOLVE_FAILED", "动作没能保存");
  }
  if (!result?.ok) return sendDeny(res, result);
  noteMatchChanged(req.params.id);
  return ok(res, {
    accepted: true,
    round: result.round,
    lockedAction: result.lockedAction,
    revision: result.revision,
  });
});

router.post("/pvp/matches/:id/forfeit", requireUser, (req, res) => {
  const body = objectBody(req, res);
  if (!body) return;
  if (Object.keys(body).length) return fail(res, 400, "BAD_PAYLOAD", "包含无法识别的字段");
  let result;
  try {
    result = forfeitMatch(openDb(), {
      matchId: req.params.id,
      userId: req.user.id,
      commandKey: idempotencyKey(req),
      now: Date.now(),
    });
  } catch (err) {
    console.error("pvp forfeit failed:", err && err.message ? err.message : err);
    return fail(res, 500, "RESOLVE_FAILED", "认输没能保存");
  }
  if (!result?.ok) return sendDeny(res, result);
  noteMatchChanged(req.params.id);
  return ok(res, {
    accepted: true,
    forfeited: result.forfeited === true,
    unchanged: result.unchanged === true,
    revision: result.revision,
  });
});

router.post("/pvp/matches/:id/ready", requireUser, (req, res) => {
  const result = markReady(openDb(), { matchId: req.params.id, userId: req.user.id, now: Date.now() });
  if (!result?.ok) return sendDeny(res, result);
  noteMatchChanged(req.params.id);
  return ok(res, {
    matchId: result.matchId,
    status: result.status,
    waiting: result.waiting === true,
    started: result.started === true,
    unchanged: result.unchanged === true,
  });
});

router.post("/pvp/matches/:id/cancel-ready", requireUser, (req, res) => {
  const result = cancelReady(openDb(), { matchId: req.params.id, userId: req.user.id, now: Date.now() });
  if (!result?.ok) return sendDeny(res, result);
  noteMatchChanged(req.params.id);
  return ok(res, { matchId: req.params.id, status: "aborted" });
});

router.post("/pvp/heartbeat", requireUser, (req, res) => {
  const now = Date.now();
  noteHeartbeat(req.user.id, now);
  touchPresence(req.user.id, now);
  return ok(res, { ok: true });
});

router.post("/pvp/shares", requireUser, (req, res) => {
  if (!config.pvpBattleEnabled) return fail(res, 403, "FEATURE_DISABLED", "对战未开放");
  const body = objectBody(req, res);
  if (!body) return;
  if (Object.keys(body).length) return fail(res, 400, "BAD_PAYLOAD", "包含无法识别的字段");
  const perUser = consumeRateLimit(`pvp:share:u:${req.user.id}`, 6, 60_000);
  if (!perUser.ok) return rateLimitFail(res, perUser.retryAfterSec, "分享过于频繁");
  const result = createShareLink(openDb(), { userId: req.user.id, now: Date.now() });
  if (!result?.ok) return sendDeny(res, result);
  return ok(res, {
    code: result.code,
    expiresAt: result.expiresAt,
    replay: result.replay === true,
  }, result.created ? 201 : 200);
});

router.post("/pvp/shares/:code/join", requireUser, (req, res) => {
  if (!config.pvpBattleEnabled) return fail(res, 403, "FEATURE_DISABLED", "对战未开放");
  const body = objectBody(req, res);
  if (!body) return;
  if (Object.keys(body).length) return fail(res, 400, "BAD_PAYLOAD", "包含无法识别的字段");
  const perUser = consumeRateLimit(`pvp:sharejoin:u:${req.user.id}`, 6, 60_000);
  if (!perUser.ok) return rateLimitFail(res, perUser.retryAfterSec, "进入房间过于频繁");
  const result = joinShareLink(openDb(), { code: req.params.code, userId: req.user.id, now: Date.now() });
  if (!result?.ok) return sendDeny(res, result);
  if (result.challengeId) noteChallengeChanged(result.challengeId, result.userIds || []);
  noteMatchChanged(result.matchId);
  noteLobbyChanged();
  return ok(res, {
    matchId: result.matchId,
    readyDeadlineAt: result.readyDeadlineAt || null,
    replay: result.replay === true,
  });
});

router.post("/pvp/challenges", requireUser, (req, res) => {
  if (!config.pvpBattleEnabled) return fail(res, 403, "FEATURE_DISABLED", "对战未开放");
  const body = objectBody(req, res);
  if (!body) return;
  const extra = Object.keys(body).filter((key) => key !== "toUserId");
  if (extra.length) return fail(res, 400, "BAD_PAYLOAD", "包含无法识别的字段");
  const perUser = consumeRateLimit(`pvp:challenge:u:${req.user.id}`, 6, 60_000);
  if (!perUser.ok) return rateLimitFail(res, perUser.retryAfterSec, "约战过于频繁");
  const db = openDb();
  if (!isChallengeableTarget(db, body.toUserId, Date.now())) {
    return fail(res, 409, "OFFLINE", "对方现在不可约战");
  }
  const result = createChallenge(db, {
    fromUserId: req.user.id,
    toUserId: body.toUserId,
    createKey: idempotencyKey(req),
    now: Date.now(),
  });
  if (!result?.ok) return sendDeny(res, result);
  noteChallengeChanged(result.challenge.id, [result.challenge.from_user_id, result.challenge.to_user_id]);
  if (result.matchId) {
    noteMatchChanged(result.matchId);
    noteLobbyChanged();
  }
  const created = result.created === true;
  return ok(res, {
    challengeId: result.challenge.id,
    expiresAt: result.challenge.expires_at,
    replay: result.replay === true,
    alreadyPending: result.alreadyPending === true,
    matchId: result.matchId || null,
    autoAccepted: result.autoAccepted === true,
  }, created ? 201 : 200);
});

router.post("/pvp/challenges/:id/respond", requireUser, (req, res) => {
  const body = objectBody(req, res);
  if (!body) return;
  const extra = Object.keys(body).filter((key) => key !== "accept");
  if (extra.length) return fail(res, 400, "BAD_PAYLOAD", "包含无法识别的字段");
  if (body.accept !== true && body.accept !== false) return fail(res, 422, "BAD_PAYLOAD", "需要明确接受或拒绝");
  const challengeRow = openDb()
    .prepare(`SELECT from_user_id, to_user_id FROM pvp_challenges WHERE id = ?`)
    .get(req.params.id);
  const result = body.accept
    ? acceptChallenge(openDb(), { challengeId: req.params.id, userId: req.user.id, now: Date.now() })
    : declineChallenge(openDb(), { challengeId: req.params.id, userId: req.user.id, now: Date.now() });
  if (!result?.ok) return sendDeny(res, result);
  if (challengeRow) noteChallengeChanged(req.params.id, [challengeRow.from_user_id, challengeRow.to_user_id]);
  noteLobbyChanged();
  if (body.accept) {
    noteMatchChanged(result.matchId);
    return ok(res, { matchId: result.matchId, readyDeadlineAt: result.readyDeadlineAt });
  }
  return ok(res, { challengeId: req.params.id, status: "declined", unchanged: result.unchanged === true });
});

router.post("/pvp/challenges/:id/cancel", requireUser, (req, res) => {
  const body = objectBody(req, res);
  if (!body) return;
  if (Object.keys(body).length) return fail(res, 400, "BAD_PAYLOAD", "包含无法识别的字段");
  const challengeRow = openDb()
    .prepare(`SELECT from_user_id, to_user_id FROM pvp_challenges WHERE id = ?`)
    .get(req.params.id);
  const result = cancelChallenge(openDb(), { challengeId: req.params.id, userId: req.user.id, now: Date.now() });
  if (!result?.ok) return sendDeny(res, result);
  if (challengeRow) noteChallengeChanged(req.params.id, [challengeRow.from_user_id, challengeRow.to_user_id]);
  noteLobbyChanged();
  return ok(res, { challengeId: req.params.id, status: "cancelled", unchanged: result.unchanged === true });
});

router.get("/pvp/blocks", requireUser, (req, res) => {
  const limit = Number(req.query.limit || 20);
  if (!Number.isFinite(limit) || limit < 1 || limit > 50) return fail(res, 400, "BAD_PAYLOAD", "列表长度无效");
  return ok(res, listBlocks(openDb(), req.user.id, { cursor: req.query.cursor || 0, limit }));
});

router.post("/pvp/blocks", requireUser, (req, res) => {
  const body = objectBody(req, res);
  if (!body) return;
  const extra = Object.keys(body).filter((key) => key !== "userId");
  if (extra.length || !Number.isInteger(body.userId)) return fail(res, 400, "BAD_PAYLOAD", "用户无效");
  const result = blockPlayer(openDb(), {
    blockerId: req.user.id,
    blockedId: body.userId,
    commandKey: idempotencyKey(req),
    now: Date.now(),
  });
  if (!result?.ok) return sendDeny(res, result);
  return ok(res, { userId: result.userId });
});

router.delete("/pvp/blocks/:userId", requireUser, (req, res) => {
  const blockedId = Number(req.params.userId);
  if (!Number.isInteger(blockedId)) return fail(res, 400, "BAD_PAYLOAD", "用户无效");
  unblockPlayer(openDb(), req.user.id, blockedId);
  return ok(res, null, 204);
});


router.post("/pvp/matches/:id/taunts", requireUser, (req, res) => {
  const body = objectBody(req, res);
  if (!body) return;
  const extra = Object.keys(body).filter((key) => key !== "text");
  if (extra.length || typeof body.text !== "string") return fail(res, 400, "BAD_PAYLOAD", "包含无法识别的字段");
  const perUser = consumeRateLimit(`pvp:taunt:u:${req.user.id}`, 12, 60_000);
  if (!perUser.ok) return rateLimitFail(res, perUser.retryAfterSec, "嘲讽太快了");
  const result = sendTaunt(openDb(), {
    matchId: req.params.id,
    fromUserId: req.user.id,
    text: body.text,
    now: Date.now(),
  });
  if (!result?.ok) return sendDeny(res, result);
  noteMatchTaunt(req.params.id, result.event);
  return ok(res, result.event, 201);
});

router.post("/pvp/matches/:id/reactions", requireUser, (req, res) => {
  const body = objectBody(req, res);
  if (!body) return;
  const extra = Object.keys(body).filter((key) => key !== "kind");
  if (extra.length || typeof body.kind !== "string") return fail(res, 400, "BAD_PAYLOAD", "包含无法识别的字段");
  const perUser = consumeRateLimit(`pvp:react:u:${req.user.id}`, 20, 60_000);
  if (!perUser.ok) return rateLimitFail(res, perUser.retryAfterSec, "送得太快了");
  const result = sendReaction(openDb(), {
    matchId: req.params.id,
    fromUserId: req.user.id,
    kind: body.kind,
    now: Date.now(),
  });
  if (!result?.ok) return sendDeny(res, result);
  return ok(res, result.event, 201);
});

router.get("/pvp/reactions", requireUser, (req, res) => {
  const after = Number(req.query.after || 0);
  if (!Number.isFinite(after) || after < 0) return fail(res, 400, "BAD_PAYLOAD", "游标无效");
  return ok(res, listIncoming(req.user.id, after, Date.now()));
});

router.post("/pvp/matches/:id/report", requireUser, (req, res) => {
  const body = objectBody(req, res);
  if (!body) return;
  const extra = Object.keys(body).filter((key) => key !== "reason" && key !== "detail");
  if (extra.length) return fail(res, 400, "BAD_PAYLOAD", "包含无法识别的字段");
  const result = fileReport(openDb(), {
    matchId: req.params.id,
    reporterId: req.user.id,
    reason: body.reason,
    detail: body.detail,
    commandKey: idempotencyKey(req),
    now: Date.now(),
  });
  if (!result?.ok) return sendDeny(res, result);
  return ok(res, result.report);
});

router.post("/pvp/ws-ticket", requireUser, (req, res) => {
  const perUser = consumeRateLimit(`pvp:ticket:u:${req.user.id}`, 10, 60_000);
  if (!perUser.ok) return rateLimitFail(res, perUser.retryAfterSec, "连接凭证申请过于频繁");
  const perIp = consumeRateLimit(`pvp:ticket:ip:${clientIp(req)}`, 60, 60_000);
  if (!perIp.ok) return rateLimitFail(res, perIp.retryAfterSec, "连接凭证申请过于频繁");
  if (req.body != null) {
    if (typeof req.body !== "object" || Array.isArray(req.body) || Object.keys(req.body).length) {
      return fail(res, 400, "BAD_PAYLOAD", "包含无法识别的字段");
    }
  }
  return ok(res, issueWsTicket({ userId: req.user.id, sessionToken: req.sessionToken }));
});

export default router;
