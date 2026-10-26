import { Router } from "express";
import { requireUser } from "../middleware/request.js";
import { ok, fail } from "../lib/http.js";
import { claimStreak, getStreakState, loginStreakEnabled } from "../lib/loginStreak.js";

const router = Router();

/** 连续登录奖励 state. enabled:false (not 404) when the flag is off, so the client just hides the card. */
router.get("/me/streak", requireUser, (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!loginStreakEnabled()) return ok(res, { enabled: false });
  return ok(res, getStreakState(req.user.id));
});

router.post("/me/streak/claim", requireUser, (req, res) => {
  res.set("Cache-Control", "no-store");
  const r = claimStreak(req.user.id);
  if (r.error) return fail(res, r.error.status, r.error.code, r.error.message, r.error.details);
  return ok(res, r.data, r.status);
});

export default router;
