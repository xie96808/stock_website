import { Router } from "express";
import { requireUser } from "../middleware/request.js";
import { ok } from "../lib/http.js";
import { getInviteState, inviteRewardsEnabled } from "../lib/invite.js";

const router = Router();

/** 邀请奖励 state. enabled:false (not 404) when the flag is off, so the client just hides the entry. */
router.get("/me/invite", requireUser, (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!inviteRewardsEnabled()) return ok(res, { enabled: false });
  return ok(res, getInviteState(req.user.id));
});

export default router;
