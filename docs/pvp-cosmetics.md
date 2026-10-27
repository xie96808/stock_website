# 对战装扮：表情包 + 出场特效

Flag: `pvpCosmeticsEnabled` (env `PVP_COSMETICS_ENABLED=1`, or admin 功能开关). Default **off**.
Off ⇒ `GET /me/cosmetics` → `{enabled:false}`, buy / equip / send are `FEATURE_DISABLED`, the lobby「对战装扮」entry and the
sticker tray stay hidden, and no `pvpEntrance` property is emitted anywhere (see `entranceProp`).

## Catalogue (`server/src/lib/cosmeticDefs.js`)
| id | 名称 | 价格 | 内容 |
| --- | --- | --- | --- |
| `pack_market` | 行情表情 | 200 | 涨停 跌停 满仓 空仓 抄底 追高 止盈 止损 |
| `pack_leek` | 韭菜日常 | 300 | 被割 套牢 回本 躺平 真香 破防 稳住 梭哈 |
| `ink_splash` | 泼墨 | 400 | 一团浓墨在头像处炸开 |
| `seal_stamp` | 盖印 | 400 | 红印「战」盖在头像上 |
| `leek_rain` | 韭菜雨 | 600 | 韭菜叶从头顶落下 |
| `gold_burst` | 金光 | 800 | 金色光芒四射 |

Stickers are owned per pack; entrances are owned per item and one is equipped at a time (`users.pvp_entrance`).

## Data
- `user_cosmetics(user_id, item_id, kind, price, acquired_at)` — purchases. `users.pvp_entrance` — equipped entrance id.
- Coins go through `jiu_coin_ledger` (`cosmetic_purchase`, ref_id `<uid>:<itemId>`, unique partial index), so a double tap
  or a second tab gets `409 ALREADY_OWNED` and never double-charges. Migration `034_pvp_cosmetics.sql`.

## API
- `GET  /me/cosmetics` — `{enabled, packs[], entrances[], equippedEntrance, balance}`
- `POST /me/cosmetics/:id/buy` — 200 / 402 `INSUFFICIENT_FUNDS` / 404 `UNKNOWN_ITEM` / 409 `ALREADY_OWNED`
- `POST /me/cosmetics/equip-entrance {id|null}` — 200 / 403 `NOT_OWNED`
- `POST /pvp/matches/:id/stickers {stickerId}` — only while the match is `playing`, only for a sticker whose pack you own;
  at least 2.5 s between stickers, at most 20 per match, 12/min rate limit. Delivered over the match socket as `match.sticker`.

## Client
- Shop sheet `#cosModal` (`js/cosmetic-shop.js`), opened from the lobby「对战装扮」button or the tray's「更多表情」.
  Buying is two taps (first arms「确认 -N」for 3.5 s). Entrances have a「试看」preview.
- Room: the message picker (`#pvpMsgPicker`) gets a sticker tray (`js/pvp/cosmetics-ui.js`). A sticker pops beside the sender's
  seat for 3.4 s. Stickers are code-drawn SVG seal badges (`js/sticker-art-pure.js`), no assets.
- Entrance: played once per match when it first shows as `playing` (mine, then the opponent's 450 ms later). A reload
  mid-match does not replay (`shouldPlayEntrance`). Web Animations API on a fixed `.fx-layer`; `prefers-reduced-motion`
  falls back to a single ring.
- Keep client art ids in sync with the server catalogue (`tests/cosmetics.test.js` enforces it).

## Adding one
Add the item to `cosmeticDefs.js`, draw it in `sticker-art-pure.js` / `entrance-fx.js`, run the tests.
