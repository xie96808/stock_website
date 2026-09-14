# R5 — SettlementSnapshot vs GameWindowDTO

Status: Wave B · R5 (architecture restart handoff).

## Intent

Cloud classic play used to require the full `stocks_data` pack so the client could
rebuild a board from `stockIndex` + `windowStartIndex`. The server already froze an
OHLC window into `game_sessions.snapshot_json` for settlement, but create/active
responses returned **metadata only**.

Split the concepts:

| Concept | Owner | Purpose |
| --- | --- | --- |
| **SettlementSnapshot** | Server (`snapshot_json` / `snapshot_sha256`) | Immutable bars used to **verify finish** / store settlement. Engine replay must match this blob. |
| **GameWindowDTO** | API play payload (`window`) | Playable **OHLCV** history + game days for HUD / chart / client engine. Delivered on create / active / state so classic cloud play need not wait on the full pack. |

They may share the same bar arrays under the hood today, but names and docs stay
separate so they can diverge later (e.g. progressive reveal, privacy, or pack-free
chart aesthetics).

## GameWindowDTO shape (`window`)

```json
{
  "v": 1,
  "historyLength": 30,
  "gameDays": 30,
  "history": [ { "date", "open", "high", "low", "close", "volume" } ],
  "bars":    [ { "date", "open", "high", "low", "close", "volume" } ]
}
```

- `v`: DTO version (bump when shape breaks).
- `history` + `bars`: lengths must match `historyLength` / `gameDays`.
- Volume is part of the play DTO (chart + 波段分析). Older stored snapshots that
  stripped volume from `bars` are **enriched** when building the DTO (re-slice from
  the active dataset when indices are available); SettlementSnapshot bytes on disk
  are not rewritten.

## SettlementSnapshot (stored)

Still the JSON in `snapshot_json` (hash in `snapshot_sha256`). Classic / daily picks
now keep **volume on game bars** for new sessions (`history` already had volume via
`normalizeBar`). Engine settlement continues to use OHLC only — volume is ignored
by `settleGame` / `replayGame`.

Do **not** mutate `snapshot_json` for existing rows; integrity of finish replay
depends on the frozen hash.

## API ownership

| Endpoint | `window` |
| --- | --- |
| `POST /api/v1/games` (create) | Full GameWindowDTO |
| `GET /api/v1/games/active` | Full GameWindowDTO |
| `GET /api/v1/games/:id` (owner) | Full GameWindowDTO when session public |
| `GET /api/v1/games/:id/state` | Full GameWindowDTO (legacy-batch and event-v1 owners) |
| Daily challenge create / active game DTO | Same `window` field |
| Puzzle create / session public | Also sets `window` (puzzle already exposed flat `bars`/`history`; keep both) |

Backward compatible: clients that ignore `window` keep the pack-slice path.

## Client

- Classic cloud `startGame` / resume: if `cloud.window` (or top-level
  `history`+`bars` with lengths) is present, seed the board from the DTO — **no
  catalog entry required**.
- Pack `ensureStocksLoaded` may still run in parallel for local/offline,
  leaderboard aesthetics, academy, etc., but must **not block** entering the board
  when a window DTO is available.
- Detection is the feature gate (no required env flag): old servers without
  `window` keep the pack path.

## Out of scope

- R6 non-blocking ECharts
- Cross-device resume
- React rewrite
- Auto-deploy API to server 29
