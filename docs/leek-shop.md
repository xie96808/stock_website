# 韭菜商店

首页顶栏「商店」按钮（公告与韭币余额之间，登录后可见）打开一个带标签页的弹层，所有韭币消费集中在这里。
头像框不再有头像菜单入口。

| 标签 | 模块 | 服务端开关 | 说明 |
|---|---|---|---|
| 头像框 | `js/frame-shop.js` | `AVATAR_FRAMES_ENABLED` | 100–2000 韭币，1000+ 为动态精品 |
| 对战装扮 | `js/cosmetic-shop.js` | `PVP_COSMETICS_ENABLED` | 6 个表情包（共 80+ 表情）+ 入场特效；对战表情栏「去解锁」直达此页 |
| 称号 | `js/title-shop.js` | `TITLE_SHOP_ENABLED` | 10 个称号 200–5000 韭币，显示在昵称旁（榜单、对战） |
| 改名卡 | `js/rename-card-shop.js` | `RENAME_CARD_ENABLED` | 300 韭币/张；开启后改昵称消耗 1 张（管理员/机器人免） |

每个标签模块导出 `probe()` 与 `mount(el,{balance})→{refresh(),leave()}`；开关关闭则标签自动隐藏。购买采用两次点击确认。
目录数据（纯数据文件）：`server/src/lib/{frameDefs,cosmeticDefs,titleDefs}.js`，客户端按 id 镜像美术，测试保证两边一致。
称号 DTO 字段为 `shopTitle`（对战段位的 `title` 字段已被占用）。迁移：`037_leek_shop.sql`。
