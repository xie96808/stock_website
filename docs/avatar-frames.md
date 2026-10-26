# 头像框商店

Flag: `avatarFramesEnabled` (env `AVATAR_FRAMES_ENABLED=1`, or admin 功能开关). Default **off**.
Off ⇒ `GET /me/frames` → `{enabled:false}`, buy/equip are `FEATURE_DISABLED`, the 资料设置 entry stays hidden,
and no `avatarFrame` property is emitted anywhere (see `frameProp`).

## Catalogue (`server/src/lib/frameDefs.js`)
| id | 名称 | 来源 |
| --- | --- | --- |
| `ink_ring` | 墨圈 | 300 韭币，或成就「七日成瘾」(连续登录 3 个 7 天周期) 免费解锁 |
| `bamboo` | 青竹 | 500 韭币 |
| `cinnabar` | 朱砂 | 800 韭币 |
| `gold` | 金边 | 1500 韭币 |
| `laurel` | 月桂 | 仅成就 (单局收益 ≥ 50%) |
| `crown` | 韭王冠 | 仅成就 (累计 200 局) |

Owned = shop purchases ∪ achievement unlocks (`getAchievementUnlocks`). Achievement-only frames are `NOT_FOR_SALE`.

## Data
- `users.avatar_frame` — equipped frame id (nullable). `user_frames` — purchases (`price` kept for audit).
- Coins go through `jiu_coin_ledger` (`frame_purchase`, ref_id `<uid>:<frameId>`, unique partial index),
  so a double tap or second tab gets `409 ALREADY_OWNED` and never double-charges.

## API
- `GET  /me/frames` — `{enabled, items[], equipped, balance}`
- `POST /me/frames/:id/buy` — 200 / 402 `INSUFFICIENT_FUNDS` / 404 `UNKNOWN_FRAME` / 409 `ALREADY_OWNED` | `NOT_FOR_SALE`
- `POST /me/frames/equip {frameId|null}` — 200 (returns the public user) / 403 `NOT_OWNED`; clears the leaderboard cache

## Where the frame shows
`avatarFrame` rides on every public player payload: `publicUser`, session user, leaderboards (incl. the viewer's own row),
daily challenge, weekly puzzle, PvP lobby / battle view. Ghost-duel identities intentionally have none.
Client wraps `<img>` avatars with `wrapAvatarHtml` / `applyFrameToImg` (`js/avatar-frame*.js`); the frame is pure inline SVG.

## Client
资料设置 → 头像框 (`#settingsFrameBtn`) opens a sheet reusing the announcements dialog shell.
Buying is two taps: the first arms a "确认 -N" button for 3.5s, the second pays.

## Adding one
Add an entry to `FRAMES` in `frameDefs.js` and an SVG in `js/avatar-frame-pure.js` (keep the ids in sync with the server catalogue).
