# 韭币到账弹窗 + 音效 (coin gain)

Whenever 韭币 is **earned**, the player gets the same 「获得韭币」card, a coin-shower sound (金钱哗啦啦) and a light haptic tick.

## Rules (decided with the product owner)
- One card **per gain** — no merging. Several gains queue and show one after another (`createGainQueue`).
- The card sits **on top of everything** (`z-index: 190`: above toasts 180 / dialogs 150–170; only the first-game tutorial, 12000, is higher). It is never held back behind another dialog.
- Refunds (押注退回本金、对战平局/取消退款) and admin grants/adjustments **never** pop a card.
- The coin in the middle spins continuously (CSS 3D, hand-built: 7 stacked rim discs + a front and a back face, traced from the drawn coin art). `prefers-reduced-motion` freezes it.
- Dismissing sends small coins flying to the balance chip in the top bar, which bumps as they land. No chip on screen → the coins just rise and fade.
- Sound: 「金钱哗啦啦」— synthesised with WebAudio (no files), **no settings switch**: a swell of metallic rustle plus 14–27 tiny coin clinks that start dense and thin out as the pile settles; bigger gains pour longer (≈0.8 s → 1.2 s). Seeded PRNG: tests are repeatable, live play uses a random seed so no two sound identical. Browsers need one user tap before audio may play; `installAudioUnlock()` handles it, and a sound is never scheduled on a context that is not running (silence beats a late sound). The Android app's WebView allows autoplay.
- Haptic: `navigator.vibrate(14)`. Needs `android.permission.VIBRATE` in the APK (added to the manifest — takes effect with the next APK release; Chrome on Android works already; iOS has no vibration API).

## Code
| file | role |
| --- | --- |
| `js/coin-gain-pure.js` | copy per source, `normalizeGain`, queue + key dedupe, timings, the coin-shower **score**, and one builder per earning site (`streakGain`, `puzzleGains`, `stakeGain`, `pvpGain`, `quizGain`, …) |
| `js/coin-sfx.js` | plays the score (`renderShower` works on any `BaseAudioContext`, live or offline), audio unlock, `hapticCoin`, `playGainFeedback` |
| `js/coin-gain.js` | `showCoinGain({amount, source, sub?, balance?, key?})` — DOM card, count-up, fly-to-balance, focus / Esc / ghost-tap guard |
| `css/coin-gain.css` | card (reuses the lucky wheel's `lw-result-card` / `lw-go-*` art), 3D coin, halo, stars, bump |
| `js/jiu-coin.js` | `announceCoinGains(list)` / `announceCoinGain(x)`: refreshes the status once (≤ 0.9 s) when the response has no balance, and gives each card the balance **after that gain** |

## Where cards come from
| source | trigger | caption |
| --- | --- | --- |
| 每日领取 (wheel off) | `POST /me/jiu-coin/daily` | 每日领取 |
| 签到转盘 | the wheel's own pop-up (shower sound + haptic added) | — |
| 连续登录 | `POST /me/streak/claim` | 连续登录第 N 天 [· 转盘 +N 次] |
| 成就 | claim / claim-all (one click = one card; unlocks stay a toast) | 成就「name」/ 领取 N 个成就 |
| 好友邀请 | finish response `inviteReward` | 好友邀请奖励 |
| 注册 / 游客 | register success / `POST /auth/guest` | 注册礼包 +500 / 游客体验礼包 +100 |
| 残局 | finish response `reward` / `threeStarReward` with `grantedThisTime` (one card each) | 残局首通二星 / 残局三星奖励 |
| 韭币局 | settled with `net > 0` (amount = net profit) | 韭币局盈利 · 本金已退回 |
| 双人对战 | fresh result (`celebrate`) with `outcome === 'win'` | 对战奖励 |
| 知识学习 | the answer that completes the set and `!rewardUnchanged` | 知识学习奖励 |

Dedupe: stake / puzzle / pvp / quiz / register / guest cards carry a `key`, so a retried request or a re-render can never show the same card twice in a page session. Everything here is **client-only** — no API change, no migration.

## Tests
- `tests/coin-gain-pure.test.js`, `tests/coin-sfx.test.js` (fake audio context), `tests/coin-gain-ui.test.js` (wiring, layering, reduced motion, no refund paths) — part of `npm test`.
- `scripts/coin-gain.browser.mjs` — real browser at six phone sizes (see the header for how to run).
