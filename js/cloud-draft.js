/** Mid-game cloud draft — single writer for localStorage (actions stay on this device).
 *
 * Ownership (Wave A · R4): only this module may read/write/remove CLOUD_DRAFT_KEY.
 * Callers use save / load / clear; game-sync.persistCurrentCloudDraft is a thin adapter.
 */

export const CLOUD_DRAFT_KEY = "stockgame.cloudDraft.v1";

const ACTION_SET = new Set(["buy", "sell", "hold"]);

/** Bumps on clear (and aborted coalesce) so queued saves cannot resurrect a wiped draft. */
let writeEpoch = 0;
let coalesceQueued = false;
let coalesceOpts = null;

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

function readRaw() {
  try {
    const raw = localStorage.getItem(CLOUD_DRAFT_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.v !== 1 || !data.gameId) return null;
    return data;
  } catch {
    return null;
  }
}

function cancelCoalesce() {
  coalesceOpts = null;
  coalesceQueued = false;
}

/**
 * Persist draft. Sole writer of CLOUD_DRAFT_KEY.
 *
 * Guards:
 * - refuses to overwrite a draft for a *different* gameId (stale writer after switch)
 * - refuses to overwrite same gameId when stored revision is newer than the base we read
 * - optional coalesce: last payload in the microtask wins; aborted if clear bumps writeEpoch
 *
 * @returns {boolean} true if written or accepted into coalesce queue; false if rejected
 */
export function saveCloudGameDraft(opts) {
  if (!opts || !opts.gameId || opts.userId == null) return false;

  if (opts.coalesce) {
    coalesceOpts = {
      gameId: opts.gameId,
      userId: opts.userId,
      fillMode: opts.fillMode,
      actions: opts.actions,
      ruleVersion: opts.ruleVersion,
      datasetVersion: opts.datasetVersion,
      _epoch: writeEpoch,
    };
    if (!coalesceQueued) {
      coalesceQueued = true;
      queueMicrotask(() => {
        coalesceQueued = false;
        const pending = coalesceOpts;
        coalesceOpts = null;
        if (!pending) return;
        commitSave(pending);
      });
    }
    return true;
  }

  return commitSave({
    gameId: opts.gameId,
    userId: opts.userId,
    fillMode: opts.fillMode,
    actions: opts.actions,
    ruleVersion: opts.ruleVersion,
    datasetVersion: opts.datasetVersion,
    _epoch: opts._epoch,
  });
}

function commitSave({ gameId, userId, fillMode, actions, ruleVersion, datasetVersion, _epoch }) {
  if (_epoch != null && _epoch !== writeEpoch) return false;

  const existing = readRaw();
  if (existing) {
    if (String(existing.gameId) !== String(gameId)) {
      // Do not clobber another game's draft (resume/abandon race).
      return false;
    }
  }

  const prevRev = existing ? Number(existing.revision) || 0 : 0;
  const normalized = normalizeDraftActions(actions);
  const payload = {
    v: 1,
    gameId: String(gameId),
    userId: Number(userId),
    fillMode: fillMode === "same_close" ? "same_close" : "next_open",
    actions: normalized,
    ruleVersion: ruleVersion || null,
    datasetVersion: datasetVersion || null,
    revision: prevRev + 1,
    savedAt: new Date().toISOString(),
  };

  // Re-check immediately before write (same-turn clear / newer save).
  const latest = readRaw();
  if (latest) {
    if (String(latest.gameId) !== String(gameId)) return false;
    const latestRev = Number(latest.revision) || 0;
    if (latestRev > prevRev) return false;
  }
  if (_epoch != null && _epoch !== writeEpoch) return false;

  try {
    localStorage.setItem(CLOUD_DRAFT_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function loadCloudGameDraft({ gameId, userId } = {}) {
  try {
    const data = readRaw();
    if (!data) return null;
    if (gameId != null && String(data.gameId) !== String(gameId)) return null;
    if (userId != null && Number(data.userId) !== Number(userId)) return null;
    return {
      ...data,
      actions: normalizeDraftActions(data.actions),
      revision: Number(data.revision) || 0,
    };
  } catch {
    return null;
  }
}

/**
 * Clear draft slot.
 * - With gameId: remove only if stored draft matches (no cross-game wipe).
 * - Without gameId: intentional wipe (new cloud create).
 * Always bumps writeEpoch so coalesced saves cannot resurrect the draft.
 *
 * @returns {boolean} true if something was removed (or slot already empty on wipe-all)
 */
export function clearCloudGameDraft(gameId) {
  try {
    const cur = readRaw();
    if (gameId != null) {
      if (!cur || String(cur.gameId) !== String(gameId)) {
        // Drop coalesce for this id if it was pending (never flushed).
        if (
          coalesceOpts &&
          String(coalesceOpts.gameId) === String(gameId)
        ) {
          cancelCoalesce();
          writeEpoch += 1;
          return true;
        }
        return false;
      }
    }
    writeEpoch += 1;
    cancelCoalesce();
    localStorage.removeItem(CLOUD_DRAFT_KEY);
    return true;
  } catch {
    writeEpoch += 1;
    cancelCoalesce();
    return false;
  }
}

/** Test/helper: current write epoch (bumps on clear). */
export function getCloudDraftWriteEpoch() {
  return writeEpoch;
}

/** Test helper: flush pending coalesced save synchronously. */
export function flushCloudDraftCoalesce() {
  if (!coalesceOpts) {
    coalesceQueued = false;
    return false;
  }
  const pending = coalesceOpts;
  coalesceOpts = null;
  coalesceQueued = false;
  return commitSave(pending);
}
