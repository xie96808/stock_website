/**
 * Auth / session HTTP layer (Wave C · C1).
 *
 * Owns: fetch wrappers for /api/v1, request headers, response mapping,
 * and error normalization (status / code / message / payload).
 *
 * Does NOT own: auth state machine, DOM / chrome, SESSION_CLEARED side effects.
 * Those stay in js/auth.js (calls this module) + js/auth-state.js (transitions).
 */

export const API_PREFIX = "/api/v1";

/**
 * @param {{ csrf?: string|null, jsonBody?: boolean }} [opts]
 * @returns {Record<string, string>}
 */
export function buildApiHeaders({ csrf, jsonBody } = {}) {
  const headers = { Accept: "application/json" };
  if (jsonBody) headers["Content-Type"] = "application/json";
  if (csrf) headers["X-CSRF-Token"] = csrf;
  return headers;
}

/**
 * Normalize a non-OK API JSON body into an Error with code/status/payload.
 * @param {number} status
 * @param {object} [json]
 * @returns {Error & { code?: string, status: number, payload?: object }}
 */
export function mapApiError(status, json) {
  const err = new Error(json?.error?.message || `HTTP ${status}`);
  err.code = json?.error?.code;
  err.status = status;
  err.payload = json;
  return err;
}

/**
 * Map a fetch Response into the client `{ ok, status, data, requestId }` shape.
 * Throws mapApiError on non-OK (after JSON parse attempt).
 * @param {Response} res
 */
export async function parseApiResponse(res) {
  if (res.status === 204) {
    return { ok: true, status: 204, data: null, requestId: undefined };
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw mapApiError(res.status, json);
  }
  return {
    ok: true,
    status: res.status,
    data: json.data,
    requestId: json.requestId,
  };
}

/**
 * JSON (or empty-body) request to `/api/v1${path}`.
 * Inject `fetchImpl` in tests; defaults to global fetch.
 *
 * @param {string} path  e.g. "/me", "/auth/login"
 * @param {{ method?: string, body?: unknown, csrf?: string|null, fetchImpl?: typeof fetch }} [opts]
 */
export async function apiRequest(
  path,
  { method = "GET", body, csrf, fetchImpl = globalThis.fetch } = {}
) {
  const headers = buildApiHeaders({
    csrf: csrf || undefined,
    jsonBody: body !== undefined,
  });
  const res = await fetchImpl(`${API_PREFIX}${path}`, {
    method,
    credentials: "same-origin",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return parseApiResponse(res);
}

/**
 * Multipart request (avatar upload). Does not set Content-Type (boundary).
 * @param {string} path
 * @param {FormData} formData
 * @param {{ method?: string, csrf?: string|null, fetchImpl?: typeof fetch }} [opts]
 */
export async function apiMultipartRequest(
  path,
  formData,
  { method = "POST", csrf, fetchImpl = globalThis.fetch } = {}
) {
  const headers = buildApiHeaders({ csrf: csrf || undefined, jsonBody: false });
  const res = await fetchImpl(`${API_PREFIX}${path}`, {
    method,
    credentials: "same-origin",
    headers,
    body: formData,
  });
  // Match prior auth.js multipart: always attempt JSON (no 204 special-case).
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw mapApiError(res.status, json);
  }
  return { ok: true, status: res.status, data: json.data };
}

/** GET /me — bootstrap / coalesced refresh. */
export function fetchMe(opts = {}) {
  return apiRequest("/me", opts);
}

/** POST /auth/login */
export function postLogin({ username, password }, opts = {}) {
  return apiRequest("/auth/login", {
    ...opts,
    method: "POST",
    body: { username, password },
  });
}

/** POST /auth/register */
export function postRegister(body, opts = {}) {
  return apiRequest("/auth/register", {
    ...opts,
    method: "POST",
    body,
  });
}

/** POST /auth/logout */
export function postLogout(opts = {}) {
  return apiRequest("/auth/logout", { ...opts, method: "POST" });
}

/** PATCH /me — nickname / avatarId / leaderboardOptIn */
export function patchMe(body, opts = {}) {
  return apiRequest("/me", { ...opts, method: "PATCH", body });
}

/** POST /me/avatar (multipart) */
export function postAvatar(formData, opts = {}) {
  return apiMultipartRequest("/me/avatar", formData, opts);
}
