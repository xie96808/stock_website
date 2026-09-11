import { Router } from "express";
import { requireUser } from "../middleware/request.js";
import { ok, fail } from "../lib/http.js";
import { config } from "../lib/config.js";
import {
  getDailyChallengeStatus,
  startDailyChallenge,
  getDailyLeaderboard,
} from "../lib/dailyChallenge.js";
import { checkCreateGameLimits, rateLimitFail } from "../lib/rateLimit.js";

const router = Router();

function mapDailyError(res, e) {
  const status = e.status || (e.code === "DAILY_CHALLENGE_DISABLED" ? 404 : 500);
  return fail(res, status, e.code || "INTERNAL", e.message || "服务器错误");
}

function guardFlag(res) {
  if (!config.dailyChallengeEnabled) {
    fail(res, 404, "DAILY_CHALLENGE_DISABLED", "每日挑战暂未开放");
    return false;
  }
  return true;
}

/** GET /daily-challenge — today status (auth optional). */
router.get("/daily-challenge", (req, res) => {
  if (!guardFlag(res)) return;
  try {
    const date = typeof req.query.date === "string" ? req.query.date : null;
    const data = getDailyChallengeStatus(req.user?.id || null, { date });
    return ok(res, data);
  } catch (e) {
    return mapDailyError(res, e);
  }
});

/** POST /daily-challenge/games — start or resume official daily run. */
router.post("/daily-challenge/games", requireUser, (req, res) => {
  if (!guardFlag(res)) return;
  const gameLimit = checkCreateGameLimits(req.user.id);
  if (gameLimit.limited) {
    return rateLimitFail(res, gameLimit.retryAfterSec, gameLimit.message);
  }
  const createKey = req.get("idempotency-key") || req.get("Idempotency-Key");
  try {
    const result = startDailyChallenge(req.user.id, { createKey });
    if (result.error) {
      return fail(res, result.error.status, result.error.code, result.error.message, result.error.details);
    }
    return ok(res, result.data, result.status);
  } catch (e) {
    return mapDailyError(res, e);
  }
});

/** GET /daily-challenge/leaderboard?date=YYYY-MM-DD */
router.get("/daily-challenge/leaderboard", (req, res) => {
  if (!guardFlag(res)) return;
  try {
    const date = typeof req.query.date === "string" ? req.query.date : null;
    const limit = req.query.limit;
    const data = getDailyLeaderboard({ date, limit });
    return ok(res, data);
  } catch (e) {
    return mapDailyError(res, e);
  }
});

export default router;
