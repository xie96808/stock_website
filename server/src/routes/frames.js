import { Router } from "express";
import { requireUser } from "../middleware/request.js";
import { ok, fail } from "../lib/http.js";
import { avatarFramesEnabled, buyFrame, equipFrame, getFrameState } from "../lib/avatarFrames.js";
import { findUserById, publicUser } from "../lib/users.js";

const router = Router();

/** 头像框 state. enabled:false (not 404) when the flag is off, so the client just hides the entry. */
router.get("/me/frames", requireUser, (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!avatarFramesEnabled()) return ok(res, { enabled: false });
  return ok(res, getFrameState(req.user.id));
});

router.post("/me/frames/equip", requireUser, (req, res) => {
  res.set("Cache-Control", "no-store");
  const r = equipFrame(req.user.id, req.body?.frameId);
  if (r.error) return fail(res, r.error.status, r.error.code, r.error.message, r.error.details);
  return ok(res, { ...r.data, user: publicUser(findUserById(req.user.id)) }, r.status);
});

router.post("/me/frames/:id/buy", requireUser, (req, res) => {
  res.set("Cache-Control", "no-store");
  const r = buyFrame(req.user.id, req.params.id);
  if (r.error) return fail(res, r.error.status, r.error.code, r.error.message, r.error.details);
  return ok(res, r.data, r.status);
});

export default router;
