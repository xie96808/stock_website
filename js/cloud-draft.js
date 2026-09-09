/** Mid-game cloud draft (actions stay on this device; server keeps chart seed only). */

export const CLOUD_DRAFT_KEY = "stockgame.cloudDraft.v1";

const ACTION_SET = new Set(["buy", "sell", "hold"]);

export function normalizeDraftActions(actions) {
  if (!Array.isArray(actions)) return [];
  const out = [];
  for (const a of actions) {
    if (out.length >= 29) break;
    const v = typeof a === "string" ? a : a && a.action;
    if (!ACTION_SET.has(v)) break;
    out.push(v);
  }
  return out;
}

export function saveCloudGameDraft({ gameId, userId, fillMode, actions, ruleVersion, datasetVersion }) {
  if (!gameId || userId == null) return false;
  const normalized = normalizeDraftActions(actions);
  const payload = {
    v: 1,
    gameId: String(gameId),
    userId: Number(userId),
    fillMode: fillMode === "same_close" ? "same_close" : "next_open",
    actions: normalized,
    ruleVersion: ruleVersion || null,
    datasetVersion: datasetVersion || null,
    savedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(CLOUD_DRAFT_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function loadCloudGameDraft({ gameId, userId } = {}) {
  try {
    const raw = localStorage.getItem(CLOUD_DRAFT_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.v !== 1 || !data.gameId) return null;
    if (gameId != null && String(data.gameId) !== String(gameId)) return null;
    if (userId != null && Number(data.userId) !== Number(userId)) return null;
    return {
      ...data,
      actions: normalizeDraftActions(data.actions),
    };
  } catch {
    return null;
  }
}

export function clearCloudGameDraft(gameId) {
  try {
    if (gameId != null) {
      const cur = loadCloudGameDraft();
      if (cur && String(cur.gameId) !== String(gameId)) return;
    }
    localStorage.removeItem(CLOUD_DRAFT_KEY);
  } catch {
    /* ignore */
  }
}
