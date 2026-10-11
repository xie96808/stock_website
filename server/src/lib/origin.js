/**
 * Origin checks shared by HTTP writes and the PvP WebSocket upgrade.
 * The upgrade path always requires an allowlisted Origin. A missing Origin is
 * never treated as authenticated, including when a bearer token is present.
 */

export function httpOriginAllowed({ origin, host, method, allowlist, isProd }) {
  if (!origin) {
    const hostname = String(host || "").split(":")[0];
    if (!isProd && (hostname === "127.0.0.1" || hostname === "localhost")) return true;
    return method === "GET" || method === "HEAD" || method === "OPTIONS";
  }
  return Array.isArray(allowlist) && allowlist.includes(origin);
}

export function upgradeOriginAllowed({ origin, allowlist }) {
  return typeof origin === "string" && origin.length > 0 && Array.isArray(allowlist) && allowlist.includes(origin);
}
