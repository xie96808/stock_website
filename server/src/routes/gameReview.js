import { Router } from "express";
import { requireUser } from "../middleware/request.js";
import { ok, fail } from "../lib/http.js";
import { getReviewState, buyReview } from "../lib/gameReview.js";

const router = Router();

/** 付费复盘 state for one of my settled games. enabled:false (not 404) when the flag is off. */
router.get("/games/:id/review", requireUser, (req, res) => {
  res.set("Cache-Control", "no-store");
  const r = getReviewState(req.user.id, req.params.id);
  if (r.error) return fail(res, r.error.status, r.error.code, r.error.message, r.error.details);
  return ok(res, r.data, r.status);
});

router.post("/games/:id/review/unlock", requireUser, (req, res) => {
  res.set("Cache-Control", "no-store");
  const r = buyReview(req.user.id, req.params.id, req.body?.product);
  if (r.error) return fail(res, r.error.status, r.error.code, r.error.message, r.error.details);
  return ok(res, r.data, r.status);
});

export default router;
