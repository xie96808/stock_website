/**
 * Client auth status machine (pure transitions).
 *
 * States:
 *   unknown        — first paint / before any /me result
 *   refreshing     — /me (or coalesced refresh) in flight
 *   authenticated  — session cookie valid; user + csrf present
 *   anonymous      — no session (incl. clean 401 from /me)
 *   error          — refresh failed for a non-auth reason (network / 5xx)
 *
 * Ownership: only js/auth.js dispatches transitions. UI reads getAuthState()
 * (status / user / ready) and must not invent parallel logged-in flags.
 *
 * Diagram (prose):
 *   unknown → refreshing → authenticated
 *                        → anonymous          (401 UNAUTHORIZED / no user)
 *                        → error              (other /me failure)
 *   authenticated → refreshing → (same three outcomes; soft: keep user while refreshing)
 *   authenticated → anonymous  (logout, or 401 UNAUTHORIZED on any api())
 *   anonymous|error → authenticated  (login / register success)
 *   error → refreshing  (retry refreshMe)
 */

export const AUTH_STATUS = Object.freeze({
  UNKNOWN: "unknown",
  ANONYMOUS: "anonymous",
  AUTHENTICATED: "authenticated",
  REFRESHING: "refreshing",
  ERROR: "error",
});

/** @typedef {"unknown"|"anonymous"|"authenticated"|"refreshing"|"error"} AuthStatus */

/**
 * @typedef {object} AuthSnapshot
 * @property {AuthStatus} status
 * @property {object|null} user
 * @property {string|null} csrfToken
 * @property {boolean} ready  true once the first bootstrap refresh settled
 * @property {string|null} error
 */

/** @returns {AuthSnapshot} */
export function createInitialAuthState() {
  return {
    status: AUTH_STATUS.UNKNOWN,
    user: null,
    csrfToken: null,
    ready: false,
    error: null,
  };
}

/**
 * Pure reducer. Returns a new snapshot; does not mutate `state`.
 * @param {AuthSnapshot} state
 * @param {{ type: string, [k: string]: unknown }} event
 * @returns {AuthSnapshot}
 */
export function transitionAuth(state, event) {
  switch (event.type) {
    case "REFRESH_START": {
      return {
        ...state,
        status: AUTH_STATUS.REFRESHING,
        error: null,
        // Soft refresh: keep prior user/csrf so chrome does not flicker to guest.
      };
    }
    case "REFRESH_SUCCESS": {
      const user = event.user ?? null;
      const csrfToken = event.csrfToken ?? null;
      if (user) {
        return {
          ...state,
          status: AUTH_STATUS.AUTHENTICATED,
          user,
          csrfToken,
          ready: true,
          error: null,
        };
      }
      return {
        ...state,
        status: AUTH_STATUS.ANONYMOUS,
        user: null,
        csrfToken: null,
        ready: true,
        error: null,
      };
    }
    case "REFRESH_FAILURE": {
      // Session-expired style 401 → clean anonymous (not a sticky error).
      if (isUnauthorized(event)) {
        return {
          ...state,
          status: AUTH_STATUS.ANONYMOUS,
          user: null,
          csrfToken: null,
          ready: true,
          error: null,
        };
      }
      return {
        ...state,
        status: AUTH_STATUS.ERROR,
        // Drop optimistic user — we could not confirm the session.
        user: null,
        csrfToken: null,
        ready: true,
        error: String(event.message || event.code || "refresh_failed"),
      };
    }
    case "SESSION_ESTABLISHED": {
      return {
        ...state,
        status: AUTH_STATUS.AUTHENTICATED,
        user: event.user ?? null,
        csrfToken: event.csrfToken ?? null,
        ready: true,
        error: null,
      };
    }
    case "SESSION_CLEARED": {
      return {
        ...state,
        status: AUTH_STATUS.ANONYMOUS,
        user: null,
        csrfToken: null,
        ready: true,
        error: null,
      };
    }
    case "USER_UPDATED": {
      if (!event.user) return state;
      return {
        ...state,
        status: AUTH_STATUS.AUTHENTICATED,
        user: event.user,
        ready: true,
        error: null,
      };
    }
    default:
      return state;
  }
}

/** @param {{ status?: number, code?: string }} [err] */
export function isUnauthorized(err) {
  if (!err) return false;
  if (err.code === "UNAUTHORIZED") return true;
  // /me with no cookie is 401 UNAUTHORIZED; treat bare 401 on refresh as anon.
  if (err.status === 401 && (err.code == null || err.code === "UNAUTHORIZED")) {
    return true;
  }
  return false;
}

/** @param {AuthSnapshot} state */
export function selectIsAuthenticated(state) {
  return state?.status === AUTH_STATUS.AUTHENTICATED && !!state.user;
}

/** Bootstrap settled (not unknown / not mid-refresh). */
export function selectIsSettled(state) {
  return !!state?.ready && state.status !== AUTH_STATUS.REFRESHING && state.status !== AUTH_STATUS.UNKNOWN;
}

/**
 * Chrome mode for header auth controls.
 * @returns {"pending"|"guest"|"user"}
 */
export function selectAuthChromeMode(state) {
  if (!state) return "pending";
  if (state.status === AUTH_STATUS.AUTHENTICATED && state.user) return "user";
  if (state.status === AUTH_STATUS.REFRESHING && state.user) return "user"; // soft
  if (state.status === AUTH_STATUS.UNKNOWN || state.status === AUTH_STATUS.REFRESHING) {
    return "pending";
  }
  // anonymous | error
  return "guest";
}
