# C1 — Extract auth HTTP

Status: Wave C · item 1 (architecture restart handoff).

## Intent

Separate the HTTP/API layer for login, register, `/me`, logout, avatar upload, and
related `api()` session calls from the auth UI / state-machine ownership that already
lives in `js/auth.js` + `js/auth-state.js` (R3).

## Ownership

| Layer | Module | Owns |
|-------|--------|------|
| Pure transitions | `js/auth-state.js` | Status machine, selectors, `isUnauthorized` |
| HTTP | `js/auth-http.js` | Fetch wrappers, headers, response mapping, error normalization, named auth endpoints |
| Owner / side effects | `js/auth.js` | `applyAuth`, coalesced `refreshMe`, chrome, DOM; **calls** auth-http via session-aware `api` / `apiMultipart` (401 → `SESSION_CLEARED` + chrome) |

## Exports (`js/auth-http.js`)

- `API_PREFIX`, `buildApiHeaders`, `mapApiError`, `parseApiResponse`
- `apiRequest`, `apiMultipartRequest` (injectable `fetchImpl` for tests)
- Named helpers: `fetchMe`, `postLogin`, `postRegister`, `postLogout`, `patchMe`, `postAvatar`

No DOM, no chrome rendering, no auth state mutation.

## Behaviors preserved

1. Bootstrap `/me` via coalesced `refreshMe`
2. Login / register / logout / PATCH `/me` / avatar multipart
3. `401 UNAUTHORIZED` (not `INVALID_CREDENTIALS` / `BAD_PASSWORD`) → session clear + chrome
4. Other modules still import session-aware `api` from `js/auth.js`

## Out of scope

- game / game-sync / result use-case split
- theme de-smuggle
- hindsight / quiz purification
- R5 API deploy / R6 follow-ups
