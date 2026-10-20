# PvP 对战分享与微信能力说明

## 当前能力（H5 + APK WebView）

- 大厅「分享对战」优先走系统分享面板（APK：`StockGameApp.share` → Android `ACTION_SEND`；浏览器：`navigator.share`）。
- 不支持系统分享时，复制短邀请文案 + **路径型链接** `https://stockgame.xieyw.top/invite.html?c=xxxxxxxx`。
- `invite.html` 带 Open Graph / Twitter meta，供微信内转发、iMessage / Discord 等抓取链接卡片；直接粘贴进微信聊天的链接是纯文本，不会变成卡片。
- 打开邀请链接后会跳到 `/#/pvp/join/{code}`，登录后进入准备房间（与原先 hash 深链一致）。

## 「直接跳转微信」做不到什么

本站是普通 H5 / Android WebView shell（`top.xieyw.stockgame`），**不是**微信小程序。

没有微信开放平台（公众号 / 开放标签 / JS-SDK）域名校验与 AppId 时：

| 期望 | 现实 |
| --- | --- |
| 一键唤起微信并打开指定会话 / 小程序卡片 | 不可用 |
| 站内用 `weixin://` 等 URL Scheme 稳定跳转 | 不可靠，且易被系统拦截 |
| 在微信内用 JS-SDK 自定义分享到朋友圈 / 好友 | 需要公众号 + JS 安全域名 + 签名 |

可做的最接近「小红书式分享」的路径：

1. 系统分享面板里选微信（APK / 支持 Web Share 的浏览器）。
2. 或复制链接粘贴到微信（聊天里是纯文本链接；从微信内 ··· 转发时才可能出卡片，OG 不保证生效）。

若以后要「真正的微信内跳转 / 定制分享」，需要：注册微信开放平台或公众号 → 校验 `stockgame.xieyw.top` → 接入微信 JS-SDK（或做小程序）。那是独立工单，不在本改动范围。
