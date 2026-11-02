/**
 * 游客先玩 client glue: the /config feature flag (cached) — same shape as the 韭币局 flag in coin-stake.js.
 * An old server has no `features.guestPlay`, which reads as OFF, so the page keeps today's login-first behaviour.
 */
let flag = null; // null = unknown
let flagPromise = null;

/** Seed the flag from an already-fetched /config `features` object (no extra request). */
export function primeGuestPlayFlag(features) {
  if (features && typeof features === 'object') flag = !!features.guestPlay;
}

/** Resolves to whether guest play is live. Cached; a failed read counts as off. */
export function guestPlayEnabled() {
  if (flag != null) return Promise.resolve(flag);
  if (!flagPromise) {
    flagPromise = fetch('/api/v1/config', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then((r) => r.json().catch(() => ({})))
      .then((j) => {
        flag = !!j?.data?.features?.guestPlay;
        return flag;
      })
      .catch(() => {
        flagPromise = null;
        return false;
      });
  }
  return flagPromise;
}

/** Sync read for places that cannot await (null until known). */
export function guestPlayEnabledSync() {
  return flag;
}
