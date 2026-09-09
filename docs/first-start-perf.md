# 首局开局准备性能

更新：2026-09-09（`perf/first-start-prep`）

## 问题

在 #41（deferred pack + worker）之后，用户仍反馈**第一次点开始游戏 → 进入模拟盘**偏慢。规则与成交逻辑不变；本轮只动加载 / 并行 / 感知路径。

## 生产资产（抽样 2026-09-09）

| 资源 | 原始 | 传输（Accept-Encoding: gzip） | 备注 |
|------|------|-------------------------------|------|
| `data/stocks_data.json` / `.js` | ~55 MB | ~11.8 MB gzip | nginx 已开 gzip；**未开 brotli**（`Accept-Encoding: br` 时仍回落未压缩或仅 gzip） |
| `js/load-stocks.js` | ~15–20 KB | ~4–5 KB gzip | |
| `js/game.js` | ~31 KB | ~8 KB gzip | |
| ECharts | CDN `echarts@5.4.3` | 外链 | 开局前 `waitForEcharts` |

瓶颈不在 JS bundle，而在 **~12MB 行情包下载 + 解析 + worker→main 结构化克隆**，以及确认开局后的 **串行等待 / 人为进度动画**。

## 已验证的剩余瓶颈

| 假设 | 结论 |
|------|------|
| 包只在点「开始」后才拉 | **部分属实**：#41 有 idle 预取（~2.5s），但进「模拟盘」hub 未强制预热；快速点击仍会撞上冷下载 |
| gzip 已开 / brotli | gzip **有**；brotli **无**（运维侧） |
| worker→main 传整包 | **属实**：`postMessage(pack)` 对 ~999×~650 根 K 线做 structured clone，首访不可避免一次 |
| 确认后假进度拖时间 | **属实**：本地练习在包已就绪时仍有约 0.5–1.8s 的 `animateTo` / `delay` |
| `POST /games` 挡 UI | **属实**：先等包再创建云局，网络 RTT 全露在进度条上 |
| ECharts `init` 挡首屏 | **属实**：`startGame` 同步 `echarts.init` 后才返回，模态框要等图表 |
| 包格式 / 体积可再削 | 数组化 K 线可再降体积，但要改 engine/hindsight，本轮未做 |

## 本轮改动（静态前端，规则不变）

1. **更强预热**：进入「模拟盘」hub 立即 `prefetchStocksPack`；首页 idle 预取 2.5s → ~0.9s；打开成交方式弹窗继续预热。
2. **IndexedDB 缓存**：按 ETag / Last-Modified / Content-Length 校验，命中则跳过网络，worker 仍负责解析；原文写入 IDB 供回访。
3. **优先拉 `stocks_data.json`**（`JSON.parse`），失败回落 `.js`；worker 两种都认。
4. **并行**：确认开局后 **pack ensure ∥ `POST /games`**（登录且非本地练习时）。
5. **去掉过长假等待**：包已就绪时进度动画大幅缩短；结束 `delay` 220→60ms；阶段文案更清楚（资源 / 云端 / 进入模拟盘）。
6. **图表懒初始化**：先切到 `gameScreen` 并画壳层 UI，双 `rAF` 后再 `echarts.init`；`updateChart` 在 chart 未就绪时 no-op。

## Before / after（理论）

假设：包已在 hub 预热完成，本地练习，ECharts 已缓存。

| 阶段 | 改前（约） | 改后（约） |
|------|------------|------------|
| 假进度（资源已就绪） | ~0.5–1.8 s | ~0.1–0.2 s |
| 云创建（与包串行） | pack + RTT | max(pack, RTT) |
| 图表 vs 关模态 | 等 init 完才关 | 壳层先亮，再 init |
| 回访（IDB 命中） | 再下 ~12MB + 解析 | 无网络 + 解析（仍有一次 clone） |

冷启动（无缓存、直点开始）仍受 **~12MB 下载 + 解析 + clone** 限制；本轮不能消掉物理传输。

## 残余限制（未做 / 需运维）

- **Brotli / 更高压缩**：需 nginx（或 CDN）开启；静态发版 alone 不够。
- **拆包 / 只下本局窗口**：要改选题与 hindsight 共用包，触及规则外的数据架构。
- **K 线数组化 / 去 py·jp 的 game-only 包**：可再压体积，需 engine + 悔棋局适配。
- **worker 常驻、主线程按 code 询价**：可避免整包 clone，改动面大。
- **云局真正「乐观开局」**：云种子来自 `POST /games`，在响应前无法选定同一题；已并行等待，但不能零等待进房。
- **测量**：本地可设 `localStorage.STOCKGAME_PERF=1` 看 `[perf] pack.*` / `start.total` 日志。

## 部署

- **只需发静态前端**（`js/`、`docs/`）。**不需要 API redeploy**。
- 确认生产仍提供 `data/stocks_data.json`（与 `.js` 同内容）；旧环境仅有 `.js` 时会自动回落。
