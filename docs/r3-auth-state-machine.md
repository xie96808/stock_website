# R3 — Client auth state machine

Status: Wave A · R3 (architecture restart handoff).

## Intent

Stop “looks logged in but isn’t” / racey session restores by making client auth an
explicit status machine. UI reads status from the single owner (`js/auth.js`); it
does not invent parallel logged-in flags.

## States

| Status | Meaning |
|--------|---------|
| `unknown` | First paint; no `/me` result yet |
| `refreshing` | `/me` in flight (bootstrap or later refresh) |
| `authenticated` | Cookie session valid; `user` + `csrfToken` set |
| `anonymous` | No session (including clean `401 UNAUTHORIZED` from `/me`) |
| `error` | `/me` failed for a non-auth reason (network / 5xx) |

Also kept for compatibility: `ready` (true after first bootstrap settles), `user`, `csrfToken`.

## Diagram (prose)

```
unknown → refreshing → authenticated
                     → anonymous     (401 UNAUTHORIZED / no user)
                     → error         (other /me failure)

authenticated → refreshing → (same three outcomes; soft: keep user while refreshing)
authenticated → anonymous    (logout, or 401 UNAUTHORIZED on any api())
anonymous|error → authenticated  (login / register)
error → refreshing           (retry refreshMe)
```

## Ownership

- **Pure transitions**: `js/auth-state.js` (`transitionAuth`, selectors).
- **Single owner / side effects**: `js/auth.js` (`applyAuth`, coalesced `refreshMe`,
  `api` 401 → `SESSION_CLEARED`, chrome render, login/register/logout).
- **UI**: reads `getAuthState()` / `selectIsAuthenticated` / `selectAuthChromeMode`.
  Header chrome modes: `pending` | `guest` | `user`.

## Behaviors covered

1. Bootstrap: first paint → pending chrome → `/me` → authenticated or anonymous.
2. `401 UNAUTHORIZED` clears session cleanly (not `INVALID_CREDENTIALS` / `BAD_PASSWORD`).
3. Concurrent `refreshMe()` calls share one in-flight promise.

## Out of scope

Wave C items after C1, React rewrite.
C1 (auth HTTP extract) shipped separately: see `docs/c1-auth-http.md`.
