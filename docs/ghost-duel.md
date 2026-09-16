# 幽灵对局（ghost duel）— Phase C

单人玩法：重玩 **昨日** 今日挑战同题，并以昨日同题 **可回放历史局** 的轨迹作为幽灵对手（按日锁步回放）。无房间 / 无 WebSocket / 不占今日挑战正式机会。

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

## 幽灵池（eligibility）

范围：**仅上海日历昨日** 的同一 `challenge_id` / 日挑战窗口。不混经典 / 一把梭 / 生存 / 其他日期。

1. **首选**：`daily_challenge_attempts` 上 `status='settled'` 且 `board_eligible=1`，且 `game_results.actions_json` 可解析为与挑战决策数一致的完整轨迹（通常 **29** 步 `buy|sell|hold`）。
2. **过少则扩池**（`GHOST_POOL_MIN_PREFERRED=1`）：若首选可回放集合为空，再纳入同题 `status IN ('settled','settle_late')` 且同样具备完整可回放轨迹的正式日挑战局（含迟到结算、`board_eligible=0`）。仍不混其他玩法。
3. 排序：`board_eligible DESC`，再 `return_ppm DESC, mdd_ppm ASC, settled_at ASC, user_id ASC`；上限 `GHOST_POOL_LIMIT=50`。
4. 预览 `ghost` = 池内第一名（兼容旧客户端）；`ghosts: [...]` = 完整列表（含 `gameId` / 昵称 / 头像 / 收益，**不含** actions）。
5. 空池 → `available:false`（`NO_GHOST` / `NO_REPLAY` / `CHALLENGE_MISSING`），日榜条展示与今日相同的清晰空态。
6. 允许挑战自己（若本人在池内）。

## 规则

1. 玩家局 `game_kind=ghost`，窗口 = 昨日挑战快照；`legacy-batch`；费用 **20** 韭币（经典开局价）；**不**写入 `daily_challenge_attempts`。
2. 与经典 / 今日挑战 / 一把梭 / 生存共用 **ACTIVE 互斥**。
3. 反悔关闭；成绩不进经典练习榜 / 日榜。
4. HUD **全程**展示幽灵昵称 + 头像（`#ghostHudChip`），并对比当日深度收益。
5. **揭示节奏（必须）**：玩家先锁定当日买卖/观望，**之后**再揭示幽灵同日操作（`modifiers.ghost.actions[i]`，`i = actions.length - 1`）。幽灵持仓日仍显示 **观望**，不得静默跳过。揭示出现在芯片下的 `#ghostHudAction`（纸感闪一下），并写入交易日志「幽灵」行（昵称 + 头像）。中途续玩按当前决策深度回放已揭示的最后一步，不提前偷看未到日。

## API

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/daily-challenge/ghost` | 可选 | 预览；`ghost`（#1）+ `ghosts[]`；含 nickname / avatar / `gameId` / return；`poolSource` |
| POST | `/daily-challenge/ghost/games` | 是 | body 可选 `ghostGameId`；缺省 = 池内第一名；不在池 / 无回放 → `404 GHOST_NOT_IN_POOL` 等；session `modifiers.ghost` 含完整身份+轨迹 |

## 入口 UX

首页 → 模拟盘 → 玩法（L3）→ **查看日榜** → 「挑战幽灵」（flag ON）。

- 仅 1 位幽灵：原单卡 CTA。
- 多位：纸感列表（昵称 + 头像 + 收益）**点选一位**，主按钮「挑战所选」；另有 **随机挑战**。
- 空池：与今日相同的清晰空态文案。

## 测试

```bash
DAILY_CHALLENGE_ENABLED=1 GHOST_DUEL_ENABLED=1 node --test server/tests/ghost.integration.test.js
node --test server/tests/ghost-off.integration.test.js
node scripts/run-tests.mjs
```

覆盖：多幽灵预览；按 `ghostGameId` 开局；非法 id 拒绝；单幽灵仍可用；flag OFF。
