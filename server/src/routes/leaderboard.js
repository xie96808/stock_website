import { Router } from "express";
import { ok, fail } from "../lib/http.js";
import { getLeaderboard } from "../lib/leaderboard.js";

const router = Router();

/** Public GET /leaderboard — guests OK; logged-in users get myRank / reason */
router.get("/leaderboard", (req, res) => {
  const result = getLeaderboard(
    {
      fillMode: req.query.fillMode,
      ruleVersion: req.query.ruleVersion,
      datasetVersion: req.query.datasetVersion,
    },
    req.user || null
  );
  if (result.error) {
    return fail(res, result.error.status, result.error.code, result.error.message, result.error.details);
  }
  return ok(res, result.data, result.status);
});

export default router;
