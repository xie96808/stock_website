# 活过三十日（survival）— Phase B

单人规则变体：买卖次数不限，但 **相对开局净值浮亏触及 −20% 立即强制结束**。不对战。

## Feature flag（默认关闭）

| Env | Config | Client (`GET /api/v1/config` → `features`) |
|-----|--------|---------------------------------------------|
| `SURVIVAL_MODE_ENABLED=1`（或 `true`） | `config.survivalModeEnabled` | `features.survivalMode` |

- **默认 OFF**：`POST /api/v1/games` 带 `gameKind=survival` 返回 `403 FEATURE_DISABLED`；三级卡片隐藏。
- 生产可在 `/etc/stockgame/api.env` 打开；需 **API + static** 同发（迁移 `016` 已含 `survival` CHECK，无新迁移）。

本地开启：

```bash
EVENT_PROTOCOL_ENABLED=1 SURVIVAL_MODE_ENABLED=1 npm --prefix server start
```

## Bust 判定（钉死）

- `modifiers`: `{"bustNavPpm":-200000,"bustBasis":"start_nav"}`
- 每次 decision 后用引擎 `returnPpm`（相对开局净值）判定：`returnPpm <= -200000` → 爆仓
- **不是**峰值回撤（MDD）。先涨后回落到开局附近不爆仓。
- 爆仓：服务端同事务 auto-finish，`busted=true`，收益按爆仓当天盯市净值；客户端不可继续翻 K。

## 规则

1. 费用 **20 韭币**（与经典一致；一把梭 30，今日挑战 50）。
2. 与经典 / 一把梭共用 **ACTIVE 互斥**。
3. 反悔关闭：`REWIND_NOT_ALLOWED`。
4. 成绩 **不进** 默认经典练习榜。无独立生存榜（Phase C）。

## 入口

L3 玩法页「活过三十日」卡（flag 开才显示），CTA「开始生存模式」。
