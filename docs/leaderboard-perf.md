# 排行榜性能与增长路径

更新：2026-09-09（`perf/leaderboard-speed`）

## 已验证的瓶颈

| 假设 | 结论 |
|------|------|
| 每次请求对全部已结算局做窗口排序 | **属实**：旧实现 `loadRankedSeats` 物化全量 ranked 再 `slice(0,10)` |
| 全表扫描 / 缺索引 | 部分属实：已有 `003_leaderboard_indexes.sql`，但窗口函数仍要读齐符合条件的对局；`user_stats` CTE 曾对榜上所有人二次聚合 |
| 每次请求重算全站名次 | **属实**（含 Top10 外用户） |
| 客户端切 tab 重拉 + 清空 DOM | **属实**：无 per-mode 缓存，先写「加载中…」再替换 |
| 头像/历史整包重拉 | 头像仅为 URL；历史不在榜单 API。自定义头像走 `/api/v1/avatars/*`（已允许浏览器缓存） |
| 无 HTTP/内存缓存 | **属实**：全局 `Cache-Control: no-store`；无进程内缓存 |
| N+1 / 顺序 await | API 单条 SQL 为主；客户端双模式顺序请求、无预取 |

生产抽样（2026-09-09，Origin 本站，top10≈5）：首连 ~1.0s（含 TLS），keepalive 约 **0.24s**。延迟里网络 RTT 占大头，但无缓存时切 tab 仍要完整等一轮，体感慢。

## 本轮改动

1. **API**：只物化 **Top N**（N=10）+ `total`；站外 `myRank` 用「最佳席位 + 更优席位计数」；胜率仅对 Top N（及查看者）聚合。
2. **进程内短 TTL 缓存**（默认 8s，`LEADERBOARD_CACHE_TTL_MS`）：键 = `fillMode|ruleVersion|datasetVersion`，缓存共享榜；`myRank` 仍按登录态附加。失效：结算、unlist/relist/invalidate/restore、禁用/启用用户、opt-in/昵称头像变更、测试 helper。
3. **前端**：按 `fillMode` 缓存上次响应；切 tab 先画缓存再后台刷新（busy 样式）；打开时预取另一模式；头像 `loading=lazy`。
4. **正确性**：双模式语义不变；公开字段不变。

## 增长路径（用户/对局变多时）

当 settled 局数到数万、单次 TopN CTE 稳定 >50ms 时，升级为**物化最佳席位**，避免每次 `O(all eligible games)`：

### 推荐表

```sql
-- 未来 migration（示意，尚未落地）
CREATE TABLE leaderboard_best_seats (
  rule_version TEXT NOT NULL,
  dataset_version TEXT NOT NULL,
  fill_mode TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  game_id TEXT NOT NULL,
  return_ppm INTEGER NOT NULL,
  finished_at TEXT NOT NULL,
  PRIMARY KEY (rule_version, dataset_version, fill_mode, user_id)
);
CREATE INDEX idx_lb_best_rank
  ON leaderboard_best_seats(
    rule_version, dataset_version, fill_mode,
    return_ppm DESC, finished_at ASC, user_id ASC
  );
```

### 维护方式

- **同步写路径（优先）**：`finishGame` 成功后 upsert 该用户在该 board 的 best seat（与现有资格过滤一致）；unlist/ban/opt-out 时 delete；relit/enable 时重算该用户。
- **或周期性重建**：cron/`node scripts/refresh-leaderboard-best.mjs` 全量刷新（运维简单，短暂滞后可接受）。
- **读路径**：`SELECT … ORDER BY return_ppm DESC … LIMIT 10` + `COUNT(*)`；`myRank = 1 + COUNT(更优)`。进程内 TTL 缓存可保留。

在物化表落地前，当前「Top N SQL + 8s 内存缓存 + 客户端 per-mode 缓存」足以覆盖早期增长；**生产 API 需重新部署**后内存缓存与查询优化才生效（静态前端可单独发）。

## 运维

- 环境变量：`LEADERBOARD_CACHE_TTL_MS`（默认 `8000`；测压可调大，强一致可设 `0` 关闭缓存——实现上 expires 立即过期即可，或后续加开关）。
- 部署：本改动含 `server/src/**` 与静态 `js/`/`css/`，**需要 API 进程重启/redeploy**。
