import { Router } from "express";
import { requireUser } from "../middleware/request.js";
import { ok, fail } from "../lib/http.js";
import { config } from "../lib/config.js";
import { checkIntradayCreateLimits, rateLimitFail } from "../lib/rateLimit.js";
import {
  getIntradayStatus,
  createIntradaySession,
  advanceIntradaySession,
  finishIntradaySession,
  abandonIntradaySession,
  getIntradayLeaderboard,
} from "../lib/intraday.js";

const router = Router();

function disabled(res) {
  return fail(res, 404, "INTRADAY_DISABLED", "分时操作暂未开放");
}

function send(req, res, result) {
  if (result?.error) {
    const log = result.error.log || {};
    console.log(JSON.stringify({
      requestId: res.locals.requestId || null,
      code: result.error.code,
      sessionId: log.sessionId ?? result.error.details?.sessionId ?? req.params?.id ?? null,
      cursor: log.cursor ?? result.error.details?.cursor ?? null,
      barIndex: log.barIndex ?? result.error.details?.barIndex ?? null,
    }));
    return fail(
      res,
      result.error.status || 500,
      result.error.code || "INTERNAL",
      result.error.message || "服务器错误",
      result.error.details
    );
  }
  return ok(res, result.data, result.status || 200);
}

router.get("/intraday", (req, res) => {
  if (!config.intradayModeEnabled) return disabled(res);
  try {
    return ok(res, getIntradayStatus(req.user?.id || null));
  } catch (e) {
    console.error(e);
    return fail(res, 500, "INTERNAL", "服务器错误");
  }
});

router.post("/intraday/sessions", requireUser, (req, res) => {
  if (!config.intradayModeEnabled) return disabled(res);
  const limited = checkIntradayCreateLimits(req.user.id);
  if (limited.limited) return rateLimitFail(res, limited.retryAfterSec, limited.message);
  const createKey = req.get("idempotency-key") || req.get("Idempotency-Key");
  try {
    return send(req, res, createIntradaySession(req.user.id, {
      mode: req.body?.mode,
      startMode: req.body?.startMode,
      createKey,
    }));
  } catch (e) {
    console.error(e);
    return fail(res, 500, "INTERNAL", "服务器错误");
  }
});

router.post("/intraday/sessions/:id/advance", requireUser, (req, res) => {
  const commandKey = req.get("idempotency-key") || req.get("Idempotency-Key");
  try {
    return send(req, res, advanceIntradaySession(req.user.id, req.params.id, req.body || {}, commandKey));
  } catch (e) {
    console.error(e);
    return fail(res, 500, "INTERNAL", "服务器错误");
  }
});

router.post("/intraday/sessions/:id/finish", requireUser, (req, res) => {
  const commandKey = req.get("idempotency-key") || req.get("Idempotency-Key");
  try {
    return send(req, res, finishIntradaySession(req.user.id, req.params.id, req.body || {}, commandKey));
  } catch (e) {
    console.error(e);
    return fail(res, 500, "INTERNAL", "服务器错误");
  }
});

router.post("/intraday/sessions/:id/abandon", requireUser, (req, res) => {
  if (!config.intradayModeEnabled) return disabled(res);
  try {
    return send(req, res, abandonIntradaySession(req.user.id, req.params.id));
  } catch (e) {
    console.error(e);
    return fail(res, 500, "INTERNAL", "服务器错误");
  }
});

router.get("/intraday/leaderboard", (req, res) => {
  if (!config.intradayModeEnabled) return disabled(res);
  try {
    const date = typeof req.query.date === "string" ? req.query.date : null;
    return send(req, res, getIntradayLeaderboard({
      startMode: req.query.startMode,
      date,
      limit: req.query.limit,
    }));
  } catch (e) {
    console.error(e);
    return fail(res, 500, "INTERNAL", "服务器错误");
  }
});

export default router;
