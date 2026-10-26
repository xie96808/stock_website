import { Router } from "express";
import { requireUser } from "../middleware/request.js";
import { ok } from "../lib/http.js";
import { recordHeartbeat } from "../lib/activity.js";

const router = Router();

/**
 * Usage heartbeat (admin 「用户数据」 面板的数据来源). No body; the client calls it every ~30s while the
 * page is visible and in use. Over-frequent calls are ignored server-side, so it is safe to retry.
 */
router.post("/me/heartbeat", requireUser, (req, res) => {
  if (req.user.role === "admin") return ok(res, { accepted: false }); // admin accounts stay out of the stats
  const r = recordHeartbeat(req.user.id);
  return ok(res, { accepted: r.accepted });
});

export default router;
