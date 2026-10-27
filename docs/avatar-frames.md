# 头像框商店

Flag: `avatarFramesEnabled` (env `AVATAR_FRAMES_ENABLED=1`, or admin 功能开关). Default **off**.
Off ⇒ `GET /me/frames` → `{enabled:false}`, buy/equip are `FEATURE_DISABLED`, the 资料设置 entry stays hidden,
and no `avatarFrame` property is emitted anywhere (see `frameProp`).

## Catalogue (`server/src/lib/frameDefs.js`)
| id | 名称 | 来源 |
| --- | --- | --- |
| `jiu_huang` | 韭皇 | 100 韭币（入门款，唯一把「韭」字写在框上的） |
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

## Art (v2)
Woodblock-print style, all code-drawn SVG in `js/avatar-frame-pure.js`: flat colour + thin ink outline + one highlight.
No gradients / filters / ids (nothing collides when a frame appears many times, a hidden copy cannot break a visible one).
- 韭皇 — starter frame: leek-green ring with a red plaque reading 韭皇 (the only art that contains the character 韭; a test enforces it)
- 墨圈 — one brush stroke (圆相) with dry-brush streaks, ink drops and a blank red chop; ink flips to light in the dark theme
- 青竹 — jointed bamboo stalk with two swaying sprigs
- 朱砂 — vermilion ring, 祥云 scrolls, glowing beads, blank chop
- 金边 — gilded band, beads, four crest diamonds, a highlight that travels round the ring
- 月桂 — two-branch wreath with berries and a red ribbon
- 韭王冠 — crown made of five leek blades on a gold band with a ruby
Motion is opt-in per `<g>` (`avf-sheen / avf-sway / avf-twinkle / avf-pulse`) and switched off by `prefers-reduced-motion`.

## PvP
Seats, ready panel, invite card, lobby list/dossier and the result screens all go through `setPvpAvatar` / `applyFrameToImg`.
The viewer's own seat is painted from `view.me` + the auth user, so those painters must forward `avatarFrame`
(`js/pvp/room.js`, `js/pvp/result.js`, `js/pvp/lobby.js`; a test guards it). Ghost-duel identities and bots have none.
Not yet drawn: the PvP "save share image" poster (html2canvas).

## Client
资料设置 → 头像框 (`#settingsFrameBtn`) opens a sheet reusing the announcements dialog shell.
Buying is two taps: the first arms a "确认 -N" button for 3.5s, the second pays.

## Adding one
Add an entry to `FRAMES` in `frameDefs.js` and an SVG in `js/avatar-frame-pure.js` (keep the ids in sync with the server catalogue).
