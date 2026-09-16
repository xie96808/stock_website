# 残局可玩性：韭币进出 + 同题周榜

## Product defaults (shipped)

### A) 韭币进出

| 事件 | 韭币 | 说明 |
|------|------|------|
| 同 `rewardFamilyId` **首次开局**（尚无已结算局） | **0** | 保持首通精神；resume / Idempotency-Key 不扣 |
| 同 family **已有 settled 后再开新局** | **−10** | 入局时扣除；UI 确认后再请求 |
| 首次达 **2★** | **+20** | `puzzle:first-clear:<familyId>`；本章 cap 120 不变 |
| 首次达 **3★** | **+15** | `puzzle:three-star:<familyId>`；与 2★ 独立、不占 chapter cap |
| 余额不足 | 402 `INSUFFICIENT_FUNDS` | 不部分扣款 |

### B) 同题周榜

- **周界**：Asia/Shanghai 本地日历日 → **ISO week**（周一至周日），week id `YYYY-Www`。
- **选题**：`sha256("puzzle-weekly:" + weekId)` 前 8 hex → int → `%` published ch1+ch2+ch3+ch4 `levelKey`（按 key 升序）。全服同一关。
- **排名**：该周（`finished_at` ∈ [周一 00:00+08, 下周一)）在该 `levelKey` 上 settled 的最佳 **returnPpm**（并列再比 MDD↑、时间）；每用户一行。
- **隔离**：不进经典练习榜 / 日挑战榜。
- **Flag**：`PUZZLE_WEEKLY_ENABLED`（`features.puzzleWeekly`），**默认 OFF**。上线后在 29 日再开。

## API

| Method | Path | Flag |
|--------|------|------|
| GET | `/puzzles?chapter=` | `PUZZLE_CHAPTER_ENABLED` — 现含 `entryFee` / `retryFee` / `threeStarGranted` |
| POST | `/puzzles/:levelKey/entries` | 同上；retry 扣 10 |
| POST | `/puzzles/games/:gameId/finish` | 同上；可发 2★+3★ |
| GET | `/puzzles/weekly` | `PUZZLE_WEEKLY_ENABLED` |
| GET | `/puzzles/weekly/board` | 同上 |

## Deploy

1. 先部署代码（两 flag 默认关不影响现网）。
2. 确认残局章已开：`PUZZLE_CHAPTER_ENABLED=1`。
3. 日 29（或约定日）再开：`PUZZLE_WEEKLY_ENABLED=1`。
4. Migration `019_puzzle_weekly_board.sql`：settled puzzle `finished_at` 索引。

## Out of scope

Rooms、残局↔模拟盘深联动、主题周内容、ch3、改 ch1/ch2 关卡表。
