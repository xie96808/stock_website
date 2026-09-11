# F11 每日知识挑战奖励（academy quiz rewards）

PRD §4.4。新增「今日计奖题组」，**保留**现有免费训练区（`enterTrainingZone` / `js/quiz.js`）不变。

## Feature flag（默认关闭）

| Env | Config | Client (`GET /api/v1/config` → `features`) |
|-----|--------|---------------------------------------------|
| `QUIZ_REWARDS_ENABLED=1`（或 `true`） | `config.quizRewardsEnabled` | `features.quizRewards` |

- **默认 OFF**：奖励 API 返回 `404 QUIZ_REWARDS_DISABLED`；知识馆卡片隐藏；免费训练不受影响。
- **不要**在生产 deploy 配置里默认打开；QA 本机/预发显式开启。

本地开启示例：

```bash
QUIZ_REWARDS_ENABLED=1 npm start
# 或在 server 进程环境中导出同名变量
```

## Migration

| File | Contents |
|------|----------|
| `server/migrations/012_quiz_rewards.sql` | `quiz_questions`（种子约 30 道规则/概念题）、`quiz_daily_sets`、`quiz_attempts`、`quiz_answers` |
| `server/tests/fixtures/quiz_question_bank.json` | 题库只读副本，便于审题（`server/data/` 被 gitignore） |

每日题组：按 Asia/Shanghai 日期对题库做**确定性**抽取（哈希洗牌），全站同日同题；题库不足 5 道时接口返回「今日题组准备中」。

## 奖励规则

- 完成 5 题：`+10`
- 首次答对 ≥4：再 `+10`（当日最多 `+20`）
- 与每日领取（50–200）独立
- `grantRewardClaim`：`reward_key = quiz:YYYY-MM-DD`（上海日历日），`reason = quiz_daily_reward`，与 settle **同一事务**
- 首次答案锁定；结算后重练/重交不改分、不重发
- 登录才发奖；游客可继续免费训练，无追认

## API（`/api/v1`，需 flag ON）

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/quiz/daily` | 可选 | 题干/选项、进度、结算态；未结算不泄露正确答案 |
| POST | `/quiz/daily/attempts` | 是 | 创建或恢复当日尝试 |
| POST | `/quiz/attempts/:id/answers` | 是 | `{ questionId, optionId }`；末题 settle + 发币 |
| GET | `/quiz/attempts/:id` | 是 | 结算后解析 |

## 前端

- 知识馆卡片「今日赚韭币」（`index.html` + `js/daily-quiz.js` + `js/academy.js`）
- 读 `features.quizRewards`；关闭则隐藏
- 币展示：数字 + 绿色硬币图标（`amountWithCoinHtml`），不用 ¥

## 测试

```bash
QUIZ_REWARDS_ENABLED=1 node --test server/tests/quiz-rewards.integration.test.js
# 或
node scripts/run-tests.mjs
```

覆盖：完成 +10、≥4 → +20、答案锁定/幂等结算、未登录 401、flag off → 404。

## QA 开启清单

1. 跑迁移（服务启动会自动 `migrate`）
2. 设置 `QUIZ_REWARDS_ENABLED=1`
3. 打开知识馆，应出现「今日赚韭币」
4. 登录后答完 5 题，余额增加 10 或 20；再提交不变
5. 关掉 flag 后刷新：卡片消失，训练区仍可用
