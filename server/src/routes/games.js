import { Router } from "express";
import { requireUser } from "../middleware/request.js";
import { ok, fail } from "../lib/http.js";
import {
  createGame,
  getActiveGame,
  abandonGame,
  finishGame,
  getGameForOwner,
  listMyGames,
  myStats,
} from "../lib/games.js";
import { getDatasetMeta, ensureDatasetLoaded } from "../lib/dataset.js";
import { RULE_VERSION, FILL_MODES } from "../../../shared/rules.js";

const router = Router();

router.post("/games", requireUser, (req, res) => {
  const createKey = req.get("idempotency-key") || req.get("Idempotency-Key");
  const fillMode = req.body?.fillMode;
  let pickOpts = {};
  if (process.env.STOCKGAME_ALLOW_PICK_OVERRIDE === "1" && req.body?.pick) {
    pickOpts = {
      stockIndex: req.body.pick.stockIndex,
      windowStartIndex: req.body.pick.windowStartIndex,
      historyLength: req.body.pick.historyLength,
    };
  }
  const result = createGame(req.user.id, { fillMode, createKey, pickOpts });
  if (result.error) {
    return fail(res, result.error.status, result.error.code, result.error.message, result.error.details);
  }
  return ok(res, result.data, result.status);
});

router.get("/games/active", requireUser, (req, res) => {
  return ok(res, getActiveGame(req.user.id));
});

router.post("/games/:id/abandon", requireUser, (req, res) => {
  const result = abandonGame(req.user.id, req.params.id);
  if (result.error) {
    return fail(res, result.error.status, result.error.code, result.error.message, result.error.details);
  }
  return ok(res, null, 204);
});

router.post("/games/:id/finish", requireUser, (req, res) => {
  const body = {
    actions: req.body?.actions,
    finish: req.body?.finish,
  };
  const result = finishGame(req.user.id, req.params.id, body);
  if (result.error) {
    return fail(res, result.error.status, result.error.code, result.error.message, result.error.details);
  }
  return ok(res, result.data, result.status);
});

router.get("/games/:id", requireUser, (req, res) => {
  const result = getGameForOwner(req.user.id, req.params.id);
  if (result.error) {
    return fail(res, result.error.status, result.error.code, result.error.message);
  }
  return ok(res, result.data, result.status);
});

router.get("/me/games", requireUser, (req, res) => {
  const result = listMyGames(req.user.id, {
    fillMode: req.query.fillMode,
    ruleVersion: req.query.ruleVersion,
    datasetVersion: req.query.datasetVersion,
    cursor: req.query.cursor,
    limit: req.query.limit,
  });
  if (result.error) {
    return fail(res, result.error.status, result.error.code, result.error.message);
  }
  return ok(res, result.data, result.status);
});

router.get("/me/stats", requireUser, (req, res) => {
  const result = myStats(req.user.id, {
    fillMode: req.query.fillMode,
    ruleVersion: req.query.ruleVersion,
    datasetVersion: req.query.datasetVersion,
  });
  if (result.error) {
    return fail(res, result.error.status, result.error.code, result.error.message);
  }
  return ok(res, result.data, result.status);
});

export function gamesConfigPayload() {
  let datasetVersion = null;
  try {
    datasetVersion = getDatasetMeta().datasetVersion;
  } catch {
    datasetVersion = null;
  }
  return {
    ruleVersion: RULE_VERSION,
    datasetVersion,
    fillModes: [...FILL_MODES],
    avatarCount: 12,
    passwordMinLength: 4,
    features: { cloudGames: true, leaderboard: false, adminPublic: false },
  };
}

export function warmDataset() {
  try {
    ensureDatasetLoaded();
  } catch (e) {
    console.warn("dataset warm failed:", e.message || e);
  }
}

export default router;
