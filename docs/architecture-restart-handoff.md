# 架构重启交接（Architecture Restart Handoff）

## 状态日期 / Status

- **日期**：2026-09-10
- **基线**：约 `0a84741`；`main` 在合并 [#66](https://github.com/xie96808/stock_website/pull/66) 之后（merge `c0dc52e`）
- **服务器**：昵称 **29**（`121.199.33.29`），**不是** 39
- **测试账号**：`aaaa` / `1111`

---

## 已上线（Already shipped）

简要清单（勿在此 PR 再改代码）：

| 项 | 说明 |
| --- | --- |
| Phase1 | Shell 解耦 |
| Phase2 | analysis-pure + kline-option |
| Phase4 | 廉价 brotli + `?v=` |
| Versioned pack | 版本化 pack URL；[#65](https://github.com/xie96808/stock_website/pull/65) 已上服务器 **29** |
| Game-session seams | 写路径 + 读路径 [#63](https://github.com/xie96808/stock_website/pull/63) / [#64](https://github.com/xie96808/stock_website/pull/64) |
| Deploy 修复 | hardlink / nginx `{64}` 引号修复 [#66](https://github.com/xie96808/stock_website/pull/66) |

---

## ChatGPT 二次评审（Second review）

- 用户已粘贴完整二次评审正文。
- **证据目录**：`docs/architecture-second-review-evidence/`
- **`probe-results.json`** 可复现：
  - restore resurrection（恢复复活）
  - draft overwrite（草稿覆盖）
  - snapshot volume gap（快照成交量缺口）
  - stale finish（陈旧 finish）

相关正文亦可参考：`docs/architecture-second-review-2026-09-10.md`（若本地有未提交副本，以证据目录与用户粘贴为准）。

---

## Grok Bot 反馈摘要

- **强烈同意 R1–R5**。
- 优先级建议：
  - **P0**：R2、R1
  - **P1**：R3、R4、R5、R6
  - **稍后**：R7、R8
- **§7**：同意拆分 auth HTTP 与 game use-case。
- **不做** big-bang 文件夹大搬家（folder theater）。
- **不声称**当前架构已经干净；重启以证据与波次为准，而非重命名表演。

---

## 停泊的下一波（Parked next waves）

> **本 PR 仅文档，不实现下列任何项。**

### Wave A（先做）

1. **R2**：tombstone 独立于 restore 的 ledger + 真实 backup 验收
2. **R1**：不可变静态资源（immutable static assets）
3. **R3**：auth 状态机
4. **R4**：草稿单写者（single-writer drafts）

### Wave B

1. **R5**：`SettlementSnapshot` vs `GameWindowDTO`（OHLCV）→ cloud create/active window → 云端去掉 full-pack
2. **R6**：非阻塞 ECharts

### Wave C

1. 抽出 auth HTTP
2. game / game-sync / result 的 use-case / view 分层
3. theme 去偷渡（de-smuggle）
4. 随后再纯化 hindsight / quiz

---

## 明确推迟（Explicitly deferred）

- **跨设备 resume**：用户已放弃，不做
- **seat materialization**：等到有量再说
- **compact pack / worker window**：先测量，再动
- **React 重写**：不做（当前阶段）

---

## 重启检查清单（Restart checklist）

1. 读本文档
2. 读二次评审证据：`docs/architecture-second-review-evidence/`（含 `probe-results.json`）
3. 与用户确认后，从 **Wave A 第一项**（R2）开工
4. 对 `main` 开 PR（小步、可回滚）
5. 用测试账号 `aaaa` / `1111` 做 smoke
6. 若涉及静态发布变更：核对服务器 **29** 的 nginx 备注（hardlink / 引号 / pack 缓存等）

---

## 本 PR 范围

- **仅新增**本交接文档。
- **无代码变更**。实现工作留待后续独立 PR（优先 Wave A）。
