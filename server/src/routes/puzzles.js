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
import { getPuzzleWeekly, getPuzzleWeeklyBoard } from "../lib/puzzleWeekly.js";
import { checkCreateGameLimits, rateLimitFail } from "../lib/rateLimit.js";

const router = Router();

function mapPuzzleError(res, e) {
  const status =
    e.status ||
    (e.code === "PUZZLE_CHAPTER_DISABLED" || e.code === "PUZZLE_WEEKLY_DISABLED"
      ? 404
      : 500);
  return fail(res, status, e.code || "INTERNAL", e.message || "服务器错误");
}

function guardFlag(res) {
  if (!config.puzzleChapterEnabled) {
    fail(res, 404, "PUZZLE_CHAPTER_DISABLED", "残局挑战暂未开放");
    return false;
  }
  return true;
}

function guardWeekly(res) {
  if (!config.puzzleWeeklyEnabled) {
    fail(res, 404, "PUZZLE_WEEKLY_DISABLED", "残局同题周榜暂未开放");
    return false;
  }
  return true;
}

/** GET /puzzles/weekly — featured level + my best (+ board preview). */
router.get("/puzzles/weekly", (req, res) => {
  if (!guardWeekly(res)) return;
  try {
    const weekId =
      typeof req.query.week === "string" && req.query.week ? req.query.week : null;
    const data = getPuzzleWeekly({
      weekId,
      userId: req.user?.id || null,
      includeBoard: true,
      limit: 20,
    });
    return ok(res, data);
  } catch (e) {
    return mapPuzzleError(res, e);
  }
});

/** GET /puzzles/weekly/board — full same-level weekly board. */
router.get("/puzzles/weekly/board", (req, res) => {
  if (!guardWeekly(res)) return;
  try {
    const weekId =
      typeof req.query.week === "string" && req.query.week ? req.query.week : null;
    const limit = req.query.limit != null ? Number(req.query.limit) : 50;
    const data = getPuzzleWeeklyBoard({
      weekId,
      userId: req.user?.id || null,
      limit,
    });
    return ok(res, data);
  } catch (e) {
    return mapPuzzleError(res, e);
  }
});

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

/** POST /puzzles/:levelKey/entries — start or resume (first free; retry after settle costs). */
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

/** POST /puzzles/games/:gameId/finish — settle short window + stars / first-clear / 3★. */
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
