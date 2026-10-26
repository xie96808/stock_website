# 邀请奖励 + 战绩分享海报

Flag: `inviteRewardsEnabled` (env `INVITE_REWARDS_ENABLED=1`, or admin 功能开关). Default **off**.
Off ⇒ `/me/invite` → `{enabled:false}`, register ignores `inviteCode`, the client hides every entry point, and the
settlement poster still gets a QR (plain site link, no code).

## Flow
1. Every user has a 6-char code (alphabet without I/O/0/1), created lazily by `GET /me/invite`.
2. Link: `https://stockgame.xieyw.top/?invite=ABC234`. The client stores the code for 30 days (`localStorage`
   `stockgame.invite.code`), strips it from the address bar, and sends `inviteCode` with `POST /auth/register`.
3. Register never fails because of a code. A valid one creates an `invite_redemptions` row (`pending`) and the response
   carries `invite:{accepted, inviteeCoins}`.
4. The invitee's **first settled game** (`POST /games/:id/finish` answering 201) pays both sides, once:
   invitee +80 (`invite_invitee`), inviter +100 (`invite_inviter`). The finish response carries
   `inviteReward:{inviteeCoins, inviterCoins}` only on that call; the client shows a toast and refreshes the coin chip.

## Anti-abuse (coins have no cash value; this only bounds a farm)
| Rule | Effect |
| --- | --- |
| inviter paid ≤ 20 invitees total, ≤ 5 per Shanghai day | past the cap the invitee is still paid, the inviter is not |
| ≤ 2 rewarded invitees per hashed IP per rolling 24h | `rejected` / `ip_cap`, nobody paid |
| self-invite, inactive / bot accounts | not recorded / `rejected` |
| one invite per account (`invitee_id` PK), unique ledger index per side | no double payout on replays or races |

IPs are stored only as a salted hash prefix.

## Ops
- Tables: `invite_codes`, `invite_redemptions` (migration 031, additive).
- Tune constants in `server/src/lib/invite.js` (`INVITER_COINS`, `INVITEE_COINS`, caps).
- Turn off: admin 功能开关 → 邀请奖励 (or `INVITE_REWARDS_ENABLED=0`) and restart the API. Pending rows stay and pay if re-enabled.
- Audit: `SELECT * FROM invite_redemptions ORDER BY created_at DESC` and ledger reasons `invite_%`.

## Poster
`js/result-share.js` renders the settlement card through html2canvas. Footer = QR + code (`js/invite-pure.js:posterFooter`).
The invite lookup has a 2.5 s timeout so saving the image never waits on the API.
