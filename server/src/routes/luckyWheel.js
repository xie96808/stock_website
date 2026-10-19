import { Router } from "express";
import { requireUser } from "../middleware/request.js";
import { ok, fail } from "../lib/http.js";
import { clientIp, checkWheelSpinLimits, rateLimitFail } from "../lib/rateLimit.js";
import { getWheelState, spinWheel, wheelHistory } from "../lib/luckyWheel.js";

const router = Router();

router.get("/me/lucky-wheel", requireUser, (req, res) => {
  res.set("Cache-Control", "no-store");
  return ok(res, getWheelState(req.user.id));
});

router.get("/me/lucky-wheel/history", requireUser, (req, res) => {
  res.set("Cache-Control", "no-store");
  return ok(res, wheelHistory(req.user.id, req.query.limit));
});

router.post("/me/lucky-wheel/spin", requireUser, (req, res) => {
  const lim = checkWheelSpinLimits(req.user.id, clientIp(req));
  if (lim.limited) return rateLimitFail(res, lim.retryAfterSec, lim.message);
  const result = spinWheel(req.user.id, { idemKey: req.get("Idempotency-Key") });
  res.set("Cache-Control", "no-store");
  if (result.error) {
    return fail(res, result.error.status, result.error.code, result.error.message, result.error.details);
  }
  return ok(res, result.data, result.status);
});

export default router;
