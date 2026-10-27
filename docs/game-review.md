# 付费复盘：最优路线重演 + 死拿对照

Flag: `gameReviewEnabled` (env `GAME_REVIEW_ENABLED=1`, or admin 功能开关). Default **off**.
Off ⇒ `GET /games/:id/review` → `{enabled:false}`, unlock is `FEATURE_DISABLED`, the result-page card stays hidden.

## 产品
| 商品 | 价格 | 内容 |
| --- | --- | --- |
| `route` 最优路线重演 | 30 韭币 / 局 | 同一段行情从第 1 天重走，买卖锁住，只能「下一天 / 自动播放」；走到最优买点 / 卖点自动暂停并弹窗讲理由；走完有总结 |
| `hold` 死拿对照 | 10 韭币 / 局（需先买 route） | 重演里多一条「一直死拿」收益线，总结里并排列出 |

解锁按局永久有效，结算页卡片可「再看一遍」。你自己当时的买卖点（「我买 / 我卖」灰色标记）和收益线免费显示。

## 算法 (`shared/reviewEngine.js`，纯函数)
- `optimalActions`：对 29 个决策日做 DP（状态 = 空仓 / 持仓，可选买入次数上限）。成交价按 `fillMode`（next_open 取次日开盘，same_close 取当日收盘），
  卖出成交日必须严格晚于买入成交日（T+1），期末仍持仓按第 30 天收盘估值。每笔收益相乘，所以对数相加求最大。
  测试用暴力枚举所有合法序列（8 个决策日 × 两种成交模式）核对 DP，并检查最优路线被 `settleGame` 回放得到同样的收益。
- 曲线直接复用线上的 `buildEquityCurveCash`，最优路线、你的操作、死拿三条曲线口径一致。
- `attributeGap`：把最优与你之间的对数差距按「每天谁在场」拆成 空仓错过 / 该跑没跑 / 进出场价差，三项加起来等于收益差（点数）。
- `judgeTrip`：逐笔点评（追高、抄在低位、卖飞、卖在高点、割在底部、深套、拿得住），只用窗口自己的行情。
- `routeSteps`：重演的停靠点，每个最优买 / 卖一条，理由用「事后视角」写（不假装当时能预知），弹窗里有一行小字说明。
- 一把梭（`maxBuys=1`）的最优路线受买入次数限制。

## 适用范围
经典局、一把梭局。每日挑战要等当天榜单关闭（次日 0 点）后才能复盘（同题窗口，避免提前泄题）。
残局 / 生存 / 幽灵对局暂不支持（`REVIEW_UNSUPPORTED`）。必须是已结算的、属于自己的局。

## 数据
- `game_reviews(game_id, user_id, product, price, created_at)`，主键 (game_id, product)。迁移 `035_game_reviews.sql`。
- 韭币走 `jiu_coin_ledger`（`review_purchase`，ref_id `<gameId>:<product>`，唯一部分索引），双击 / 两个标签页不会重复扣费。

## API
- `GET  /games/:id/review` — 未解锁：`{enabled, eligible, owned, products[], balance, teaser:{optimalReturnPct, yourReturnPct, capturePct}}`；
  已解锁：多 `review`（曲线、route 停靠点、逐笔点评、差距拆解、文字总结；未买 hold 时 `hold:null`）、`window`（历史 + 30 根 K 线）、`stock`。
  不可复盘：`{eligible:false, reason, message}`（`NOT_SETTLED` / `REVIEW_NOT_YET` / `REVIEW_UNSUPPORTED`）。
- `POST /games/:id/review/unlock {product}` — 200（返回同上的完整状态）/ 402 `INSUFFICIENT_FUNDS` / 404 / 409 `ALREADY_UNLOCKED` | `NEED_ROUTE` / 422。

## 客户端
- 结算页 `#reviewEntry` 卡片（`refreshReviewEntry`，仅云端局保存成功后出现）→ 全屏浮层 `#rrOverlay`（`js/route-replay.js`）。
- 状态机在 `js/route-replay-pure.js`（逐天推进、暂停、确认、跳到结尾；next_open 的成交落在次日，same_close 在确认时成交），有单元测试。
- 解锁两步确认（第一次点击变「确认 -N」，3.5 秒内再点才扣）。
- K 线复用对局里的 `buildKlineOption`（新增 `extraMarks` 画「我买 / 我卖」）。

## 未做
- 「我的对局」历史列表里的入口（目前只在刚结算的结果页）。
- 残局 / 生存 / 对战的复盘。
