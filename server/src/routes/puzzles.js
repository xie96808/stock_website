import { Router } from "express";
import { requireUser } from "../middleware/request.js";
import { ok, fail } from "../lib/http.js";
import { config } from "../lib/config.js";
import {
  listPuzzleChapter,
  startPuzzleEntry,
  finishPuzzleGame,
  PUZZLE_CHAPTER_ID,
} from "../lib/puzzleChapter.js";
import { checkCreateGameLimits, rateLimitFail } from "../lib/rateLimit.js";

const router = Router();

function mapPuzzleError(res, e) {
  const status = e.status || (e.code === "PUZZLE_CHAPTER_DISABLED" ? 404 : 500);
  return fail(res, status, e.code || "INTERNAL", e.message || "服务器错误");
}

function guardFlag(res) {
  if (!config.puzzleChapterEnabled) {
    fail(res, 404, "PUZZLE_CHAPTER_DISABLED", "残局挑战暂未开放");
    return false;
  }
  return true;
}

/** GET /puzzles — chapter level list (+ progress when authed). */
router.get("/puzzles", (req, res) => {
  if (!guardFlag(res)) return;
  try {
    const chapterId =
      typeof req.query.chapter === "string" && req.query.chapter
        ? req.query.chapter
        : PUZZLE_CHAPTER_ID;
    const data = listPuzzleChapter(req.user?.id || null, { chapterId });
    return ok(res, data);
  } catch (e) {
    return mapPuzzleError(res, e);
  }
});

/** POST /puzzles/:levelKey/entries — start or resume (free). */
router.post("/puzzles/:levelKey/entries", requireUser, (req, res) => {
  if (!guardFlag(res)) return;
  const gameLimit = checkCreateGameLimits(req.user.id);
  if (gameLimit.limited) {
    return rateLimitFail(res, gameLimit.retryAfterSec, gameLimit.message);
  }
  const createKey = req.get("idempotency-key") || req.get("Idempotency-Key");
  try {
    const result = startPuzzleEntry(req.user.id, req.params.levelKey, { createKey });
    if (result.error) {
      return fail(
        res,
        result.error.status,
        result.error.code,
        result.error.message,
        result.error.details
      );
    }
    return ok(res, result.data, result.status);
  } catch (e) {
    return mapPuzzleError(res, e);
  }
});

/** POST /puzzles/games/:gameId/finish — settle short window + stars / first-clear. */
router.post("/puzzles/games/:gameId/finish", requireUser, (req, res) => {
  if (!guardFlag(res)) return;
  try {
    const result = finishPuzzleGame(req.user.id, req.params.gameId, req.body || {});
    if (result.error) {
      return fail(
        res,
        result.error.status,
        result.error.code,
        result.error.message,
        result.error.details
      );
    }
    return ok(res, result.data, result.status);
  } catch (e) {
    return mapPuzzleError(res, e);
  }
});

export default router;
