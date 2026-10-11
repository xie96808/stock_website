import { Router } from "express";
import { ok, fail } from "../lib/http.js";
import { openDb } from "../db/connection.js";
import { config } from "../lib/config.js";
import { clientIp, consumeRateLimit, rateLimitFail } from "../lib/rateLimit.js";
import { acceptChallenge, cancelReady, createChallenge, markReady } from "../lib/pvp/challenges.js";
import { forfeitMatch, lockAction, noteHeartbeat, readMatchView } from "../lib/pvp/match.js";
import { issueWsTicket, noteChallengeChanged, noteMatchChanged } from "../lib/pvp/realtime.js";
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
  noteHeartbeat(req.user.id, Date.now());
  return ok(res, { ok: true });
});

router.post("/pvp/challenges", requireUser, (req, res) => {
  if (!config.pvpBattleEnabled) return fail(res, 403, "FEATURE_DISABLED", "对战未开放");
  const body = objectBody(req, res);
  if (!body) return;
  const extra = Object.keys(body).filter((key) => key !== "toUserId");
  if (extra.length) return fail(res, 400, "BAD_PAYLOAD", "包含无法识别的字段");
  const result = createChallenge(openDb(), {
    fromUserId: req.user.id,
    toUserId: body.toUserId,
    createKey: idempotencyKey(req),
    now: Date.now(),
  });
  if (!result?.ok) return sendDeny(res, result);
  noteChallengeChanged(result.challenge.id, [result.challenge.from_user_id, result.challenge.to_user_id]);
  const created = result.created === true;
  return ok(res, {
    challengeId: result.challenge.id,
    expiresAt: result.challenge.expires_at,
    replay: result.replay === true,
    alreadyPending: result.alreadyPending === true,
  }, created ? 201 : 200);
});

router.post("/pvp/challenges/:id/respond", requireUser, (req, res) => {
  const body = objectBody(req, res);
  if (!body) return;
  const extra = Object.keys(body).filter((key) => key !== "accept");
  if (extra.length) return fail(res, 400, "BAD_PAYLOAD", "包含无法识别的字段");
  if (body.accept !== true) return fail(res, 422, "BAD_PAYLOAD", "这版只接受约战");
  const result = acceptChallenge(openDb(), {
    challengeId: req.params.id,
    userId: req.user.id,
    now: Date.now(),
  });
  if (!result?.ok) return sendDeny(res, result);
  const challenge = openDb()
    .prepare(`SELECT from_user_id, to_user_id FROM pvp_challenges WHERE id = ?`)
    .get(req.params.id);
  if (challenge) noteChallengeChanged(req.params.id, [challenge.from_user_id, challenge.to_user_id]);
  noteMatchChanged(result.matchId);
  return ok(res, { matchId: result.matchId, readyDeadlineAt: result.readyDeadlineAt });
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
