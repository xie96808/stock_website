import { Router } from "express";
import { requireUser } from "../middleware/request.js";
import { ok, fail } from "../lib/http.js";
import { achievementsEnabled, claimAchievements, getAchievementState } from "../lib/achievements.js";

const router = Router();

/** 成就 state. enabled:false (not 404) when the flag is off, so the client just hides the entry. */
router.get("/me/achievements", requireUser, (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!achievementsEnabled()) return ok(res, { enabled: false });
  return ok(res, getAchievementState(req.user.id));
});

// Registered before the :key route so "claim-all" is never read as a key.
router.post("/me/achievements/claim-all", requireUser, (req, res) => {
  res.set("Cache-Control", "no-store");
  const r = claimAchievements(req.user.id, null);
  if (r.error) return fail(res, r.error.status, r.error.code, r.error.message, r.error.details);
  return ok(res, r.data, r.status);
});

router.post("/me/achievements/:key/claim", requireUser, (req, res) => {
  res.set("Cache-Control", "no-store");
  const r = claimAchievements(req.user.id, req.params.key);
  if (r.error) return fail(res, r.error.status, r.error.code, r.error.message, r.error.details);
  return ok(res, r.data, r.status);
});

export default router;
