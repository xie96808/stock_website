/** Phase 1: unified top-level screen hide/show + single hashchange owner.
 * Behavior-preserving shell decoupling — no gameplay/API changes.
 */

export const Route = {
  HOME: "home",
  SIM: "sim",
  ACADEMY: "academy",
  HINDSIGHT: "hindsight",
  LEADERBOARD: "leaderboard",
  MY_GAMES: "my-games",
  PUZZLE: "puzzle",
  GAME: "game",
  RESULT: "result",
};

/** Hash fragment (no #/) → route. Unknown hashes are ignored. */
const HASH_TO_ROUTE = {
  "": Route.HOME,
  home: Route.HOME,
  sim: Route.SIM,
  knowledge: Route.ACADEMY,
  academy: Route.ACADEMY,
  harmony: Route.HINDSIGHT,
  hindsight: Route.HINDSIGHT,
  leaderboard: Route.LEADERBOARD,
  // my-games / game / result intentionally unhashed
};

/** Canonical hash written for a route (empty string clears hash). */
const ROUTE_TO_HASH = {
  [Route.HOME]: "",
  [Route.SIM]: "sim",
  [Route.ACADEMY]: "academy",
  [Route.HINDSIGHT]: "hindsight",
  [Route.LEADERBOARD]: "leaderboard",
};

/** Screens that use the `.active` CSS protocol (display toggled via class). */
const ACTIVE_SCREEN_IDS = {
  [Route.GAME]: "gameScreen",
  [Route.RESULT]: "resultScreen",
  [Route.ACADEMY]: "academyScreen",
  [Route.HINDSIGHT]: "hindsightScreen",
  [Route.LEADERBOARD]: "leaderboardScreen",
  [Route.MY_GAMES]: "myGamesScreen",
  [Route.PUZZLE]: "puzzleScreen",
};

/** LB / my-games historically also set inline display (keep for safety). */
const INLINE_DISPLAY_ROUTES = new Set([Route.LEADERBOARD, Route.MY_GAMES]);

function startEl() {
  return document.getElementById("startScreen");
}

function headerEl() {
  return document.querySelector(".header");
}

export function parseRouteHash() {
  return (location.hash || "").replace(/^#\/?/, "");
}

export function resolveHashRoute(hash = parseRouteHash()) {
  if (Object.prototype.hasOwnProperty.call(HASH_TO_ROUTE, hash)) {
    return HASH_TO_ROUTE[hash];
  }
  return null;
}

/**
 * Update location hash for routes that own one.
 * Uses replaceState (no hashchange) to match prior home-ia / leaderboard behavior.
 */
export function setRouteHash(route) {
  if (!Object.prototype.hasOwnProperty.call(ROUTE_TO_HASH, route)) return;
  const want = ROUTE_TO_HASH[route];
  const now = parseRouteHash();
  if ((want || "") === now) return;
  try {
    if (want) history.replaceState(null, "", `#/${want}`);
    else history.replaceState(null, "", location.pathname + location.search);
  } catch {
    location.hash = want ? `#/${want}` : "";
  }
}

export function setHeaderChrome(mode) {
  const hdr = headerEl();
  if (!hdr) return;
  if (mode === "compact") {
    hdr.style.display = "block";
    hdr.classList.add("compact");
  } else {
    hdr.style.display = "none";
    hdr.classList.remove("compact");
  }
}

/**
 * Hide every top-level screen except `except` (Route value or array).
 * Collapses duplicated hideOtherScreens / hidePeerScreens copy-paste.
 */
export function hideTopLevelScreens(except = []) {
  const keep = new Set(Array.isArray(except) ? except : [except]);

  if (!keep.has(Route.HOME) && !keep.has(Route.SIM)) {
    const start = startEl();
    if (start) start.style.display = "none";
  }

  for (const [route, id] of Object.entries(ACTIVE_SCREEN_IDS)) {
    if (keep.has(route)) continue;
    const el = document.getElementById(id);
    if (!el) continue;
    el.classList.remove("active");
    if (INLINE_DISPLAY_ROUTES.has(route)) {
      el.style.display = "none";
    }
  }
}

/**
 * Prepare shell chrome for a top-level route: hide peers + header + start visibility.
 * Does not set hash and does not run feature-specific mount logic.
 */
export function prepareScreen(route) {
  switch (route) {
    case Route.HOME:
    case Route.SIM:
      hideTopLevelScreens(route);
      setHeaderChrome("hidden");
      {
        const start = startEl();
        if (start) start.style.display = "flex";
      }
      break;
    case Route.ACADEMY:
    case Route.HINDSIGHT:
      hideTopLevelScreens(route);
      setHeaderChrome("hidden");
      {
        const start = startEl();
        if (start) start.style.display = "none";
      }
      break;
    case Route.LEADERBOARD:
    case Route.MY_GAMES:
    case Route.PUZZLE:
    case Route.GAME:
    case Route.RESULT:
      hideTopLevelScreens(route);
      setHeaderChrome("compact");
      {
        const start = startEl();
        if (start) start.style.display = "none";
      }
      break;
    default:
      break;
  }
}

/** Activate an `.active`-protocol screen element; returns the element or null. */
export function activateScreen(route) {
  const id = ACTIVE_SCREEN_IDS[route];
  if (!id) return null;
  const el = document.getElementById(id);
  if (!el) return null;
  el.classList.add("active");
  if (INLINE_DISPLAY_ROUTES.has(route)) {
    el.style.display = "block";
  }
  return el;
}

/** Deactivate one active-protocol screen without touching others. */
export function deactivateScreen(route) {
  const id = ACTIVE_SCREEN_IDS[route];
  if (!id) return;
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("active");
  if (INLINE_DISPLAY_ROUTES.has(route)) {
    el.style.display = "none";
  }
}

/** Hash → show handlers registered by the composition root. */
const hashHandlers = new Map();

export function registerHashRoute(route, handler) {
  hashHandlers.set(route, handler);
}

let routingReady = false;

/**
 * Single hashchange owner for home/sim/academy/hindsight/leaderboard.
 * Replaces dual listeners in home-ia.js + leaderboard.js that ignored each other.
 */
export function initAppHashRouting(opts = {}) {
  if (routingReady) return;
  routingReady = true;
  const { applyInitial = true } = opts;

  const apply = () => {
    const route = resolveHashRoute(parseRouteHash());
    if (!route) return;
    const handler = hashHandlers.get(route);
    if (typeof handler === "function") handler({ fromHash: true });
  };

  window.addEventListener("hashchange", apply);
  if (applyInitial) apply();
}
