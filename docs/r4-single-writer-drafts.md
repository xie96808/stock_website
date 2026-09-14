# R4 — Single-writer cloud drafts

Status: Wave A · R4 (architecture restart handoff).

## Intent

Cloud mid-game drafts live in one `localStorage` slot (`stockgame.cloudDraft.v1`).
Multiple call sites used to save/clear independently, so resume / abandon / finish
could clobber each other (second-review **draft overwrite**). Make **one module**
own persistence.

## Ownership

| Role | Module |
|------|--------|
| **Sole localStorage writer/reader** | `js/cloud-draft.js` |
| Session → draft adapter (no direct key I/O) | `js/game-sync.js` → `persistCurrentCloudDraft()` |
| Readers (load / clear via API only) | `start-flow`, `daily-challenge`, `puzzle-chapter`, finish/abandon in `game-sync` |

Do **not** call `localStorage` with `CLOUD_DRAFT_KEY` outside `cloud-draft.js`.

## Guards

1. **Different gameId**: `saveCloudGameDraft` refuses to overwrite another game’s draft (stale writer after switch). New create must `clearCloudGameDraft()` (or matching id) first — existing start-flow / puzzle paths already do.
2. **Newer revision**: each successful save bumps `revision`; a write aborts if the slot’s revision advanced since the save’s base read.
3. **Clear match**: `clearCloudGameDraft(gameId)` removes only when stored `gameId` matches; bare `clearCloudGameDraft()` is the intentional wipe on new cloud create.
4. **Coalesce**: `persistCurrentCloudDraft` passes `coalesce: true` (last payload in a microtask). Clear bumps `writeEpoch` so a queued save cannot resurrect a wiped draft.

## Out of scope

Wave B/C, cross-device resume, multi-slot drafts, React rewrite.
