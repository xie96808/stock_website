import { Router } from "express";
import { listPublishedAnnouncements } from "../lib/announcements.js";
import { ok } from "../lib/http.js";

const router = Router();

/** Public: published notices only, newest first. */
router.get("/announcements", (req, res) => {
  return ok(res, listPublishedAnnouncements({ limit: req.query.limit }));
});

export default router;
