import { sha256Hex } from "../crypto.js";
import {
  PVP_ANALYSIS_VERSION,
  buildPvpAnalysis,
  projectReplay,
} from "../../../../shared/pvpAnalysis.js";

function parseActions(raw, count) {
  let parsed = [];
  try {
    const value = JSON.parse(raw || "[]");
    if (Array.isArray(value)) parsed = value;
  } catch {
    parsed = [];
  }
  return parsed.slice(0, count);
}

function documentFor(match, players, terminalType) {
  const snapshot = JSON.parse(match.snapshot_json || "null");
  const bars = snapshot?.bars;
  const completed = terminalType === "completed";
  const revealedBars = completed ? 30 : Math.min(30, Math.max(1, (match.resolved_rounds || 0) + 1));
  const seat1 = players.find((player) => player.seat === 1);
  const seat2 = players.find((player) => player.seat === 2);
  if (!seat1 || !seat2) throw new Error("replay seats are missing");
  const count = completed ? 29 : (match.resolved_rounds || 0);
  return buildPvpAnalysis({
    bars,
    seat1Actions: parseActions(seat1.actions_json, count),
    seat2Actions: parseActions(seat2.actions_json, count),
    revealedBars,
    completed,
  });
}

function remember(db, matchId, doc, hash) {
  const payload = JSON.stringify({ ...doc, hash });
  db.prepare(
    `UPDATE pvp_match_players
     SET analysis_version = ?, analysis_json = ?, analysis_status = 'ready'
     WHERE match_id = ?`
  ).run(PVP_ANALYSIS_VERSION, payload, matchId);
}

function markFailed(db, matchId) {
  db.prepare(
    `UPDATE pvp_match_players
     SET analysis_version = ?, analysis_json = NULL, analysis_status = 'failed'
     WHERE match_id = ?`
  ).run(PVP_ANALYSIS_VERSION, matchId);
}

/**
 * Cache a replay after the payout transaction has committed.
 * A build failure records analysis_status and leaves coins, ratings, and returns alone.
 */
export function loadReplay(db, match, players, viewerId, terminalType) {
  const viewer = players.find((player) => player.user_id === viewerId);
  let doc = null;
  try {
    doc = documentFor(match, players, terminalType);
  } catch {
    try { markFailed(db, match.id); } catch { /* the saved result still stands */ }
    return {
      status: "failed",
      version: PVP_ANALYSIS_VERSION,
      revealedDay: null,
      me: null,
      opponent: null,
      buyHoldPpm: null,
      divergences: [],
    };
  }
  const hash = sha256Hex(JSON.stringify(doc));
  const cached = players.every((player) => {
    if (player.analysis_status !== "ready" || !player.analysis_json) return false;
    try {
      return JSON.parse(player.analysis_json).hash === hash;
    } catch {
      return false;
    }
  });
  if (!cached) {
    try { remember(db, match.id, doc, hash); } catch { /* show the fresh replay anyway */ }
  }
  const projected = projectReplay(doc, viewer?.seat);
  return projected || {
    status: "failed",
    version: PVP_ANALYSIS_VERSION,
    revealedDay: null,
    divergences: [],
  };
}
