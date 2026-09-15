# 幽灵对局（ghost duel）— Phase C

单人玩法：重玩 **昨日** 今日挑战同题，并以昨日日榜 **#1** 的轨迹作为幽灵对手（按日锁步回放）。无房间 / 无 WebSocket / 不占今日挑战正式机会。

## Feature flag（默认关闭）

| Env | Config | Client (`GET /api/v1/config` → `features`) |
|-----|--------|---------------------------------------------|
| `GHOST_DUEL_ENABLED=1`（或 `true`） | `config.ghostDuelEnabled` | `features.ghostDuel` |

- **默认 OFF**：`GET/POST /api/v1/daily-challenge/ghost*` 返回 `403 FEATURE_DISABLED`；日榜入口隐藏。
- 生产可在 `/etc/stockgame/api.env` 打开；需 **API + static** 同发（迁移 `017_ghost_duel.sql`）。
- 幽灵依赖日挑战快照种子；API 进程在 `ghostDuel` 或 `dailyChallenge` 开启时都会 `seedNearDailyChallenges()`。

本地开启：

```bash
DAILY_CHALLENGE_ENABLED=1 GHOST_DUEL_ENABLED=1 npm --prefix server start
```

## Migration

| File | Contents |
|------|----------|
| `server/migrations/017_ghost_duel.sql` | 重建 `game_sessions`：`game_kind` CHECK 含 `ghost` |

`modifiers`（TEXT JSON）在开局时冻结幽灵身份与轨迹：

```json
{
  "ghost": {
    "userId": 1,
    "gameId": "...",
    "nickname": "...",
    "avatarId": 1,
    "avatarUrl": null,
    "returnPpm": 12345,
    "actions": ["hold", "..."],
    "equityCurve": [{ "day": 0, "equity": 100000 }, ...],
    "sourceDate": "YYYY-MM-DD"
  },
  "sourceChallengeId": "daily:YYYY-MM-DD",
  "sourceChallengeDate": "YYYY-MM-DD"
}
```

## 规则

1. 幽灵来源：上海日历 **昨日** 日榜 `board_eligible=1` 且 `settled` 的第一名；需 `game_results.actions_json` 可解析为 29 步。
2. 无合格幽灵 / 无回放 → 预览 `available:false`（`NO_GHOST` / `NO_REPLAY` / `CHALLENGE_MISSING`），不创建残局。
3. 玩家局 `game_kind=ghost`，窗口 = 昨日挑战快照；`legacy-batch`；费用 **20** 韭币（经典开局价）；**不**写入 `daily_challenge_attempts`。
4. 与经典 / 今日挑战 / 一把梭 / 生存共用 **ACTIVE 互斥**。
5. 反悔关闭；成绩不进经典练习榜 / 日榜。
6. HUD **全程**展示幽灵昵称 + 头像（`#ghostHudChip`），并对比当日深度收益。
7. **揭示节奏（必须）**：玩家先锁定当日买卖/观望，**之后**再揭示幽灵同日操作（`modifiers.ghost.actions[i]`，`i = actions.length - 1`）。幽灵持仓日仍显示 **观望**，不得静默跳过。揭示出现在芯片下的 `#ghostHudAction`（纸感闪一下），并写入交易日志「幽灵」行（昵称 + 头像）。中途续玩按当前决策深度回放已揭示的最后一步，不提前偷看未到日。

## API

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/daily-challenge/ghost` | 可选 | 预览；含 `ghost.nickname` / `avatarId` / `avatarUrl` |
| POST | `/daily-challenge/ghost/games` | 是 | 开局/恢复；session `modifiers.ghost` 含完整身份+轨迹 |

## 入口

首页 → 模拟盘 → 玩法（L3）→ **查看日榜** → 「挑战幽灵」（flag ON 且有幽灵时）。

## 测试

```bash
DAILY_CHALLENGE_ENABLED=1 GHOST_DUEL_ENABLED=1 node --test server/tests/ghost.integration.test.js
node --test server/tests/ghost-off.integration.test.js
node scripts/run-tests.mjs
```
