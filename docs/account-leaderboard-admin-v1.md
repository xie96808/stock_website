# 《早知道当初不炒了》账号、云端战绩、排行榜与管理后台

**产品需求与实施规格 · v1.0 · 2026-09-06**

状态：建议开工基线。本文冻结默认方案；文末列出的生产环境参数在部署前核实，不阻塞本地开发。

> 本轮交付是产品文档，不是已实现的功能。本文中的接口、数据表、命令契约、性能指标均为下一迭代的要求；“现状核验”单独标明已经查证的事实。

## 0. 执行摘要

本次不是给结算页加一个提交接口，而是建立一个可运营的小型在线产品：

**游客继续完整练习；注册用户可保存、复盘并参与分模式榜单；管理员可处理用户与异常成绩；所有持久化数据具有备份和恢复路径。**

采用：原生 H5 + 同域 Node.js / Express API + SQLite + systemd。保留现有纸／墨笔记本风格、ECharts、三个主入口和 GitHub Actions 发布体系。

六项核心决策：

1. 先对齐线上实际版本，而不是直接基于过时的本地 `main` 开发。
2. 保留 `next_open` / `same_close`，分别排行；每个用户在同一个榜单仅占一席，取最佳有效单局。
3. 服务端签发对局、保存固定行情窗口并重放决策计算收益；客户端提交的收益率不是记分依据。
4. 榜单定位为“历史行情练习榜”，不宣称防作弊竞赛。公开历史数据及结算时批量提交的限制必须写清。
5. 管理后台以「最小治理」为必交付；完整四页可后移（见 §0.1）；修改密码、账号恢复和用户注销也进入账号闭环。
6. SQLite 在线一致性备份、版本兼容、发布失败回滚与恢复演练是上线门槛，而非上线后的补充工作。

---


## 0.1 产品冻结覆盖（2026-09-06）

相对本文初稿，以下决策已由产品确认，**实现与验收以本小节为准**（覆盖后文冲突表述）：

1. **密码最短长度：4 个 Unicode 码点**（不是 15）。仍保留最长 128 码点／512 UTF-8 字节、不截断、不 trim、弱口令黑名单与前后端同一校验；放宽最短长度是产品选择，靠限流降低枚举风险。
2. **默认头像：12 个手绘深色十二生肖**，风格贴近纸／墨笔记本 UI；`avatar_id` 取值 **1～12**。骰子在 12 个中随机（尽量避开当前项）。精绘可后补；功能阶段可用统一占位图。
3. **管理后台：最小治理**——禁用／解禁用户、成绩「仅下榜／判无效」（必填原因）、简单审计。完整四页运营仪表可后移。
4. **管理入口先不上公网**：`/admin` 与 `/api/v1/admin/*` 仅 IP 白名单／VPN，或第一期仅 CLI；玩家站点保持公网。无网络边界前不得把管理面暴露到公网。
5. **本版仍不做**：微信登录／支付、小程序迁移、邮箱／手机验证。
6. **分期交付**（每阶段单独验收后再进入下一阶段）：
   - 阶段 0：基线对齐 + 本文档覆盖（本 PR）
   - 阶段 1：共享规则引擎（期末估值 + golden 测试）
   - 阶段 2：账号／会话／十二生肖头像
   - 阶段 3：云端战绩（签发 + 重放）
   - 阶段 4：双模式排行榜
   - 阶段 5：最小治理（不上公网）
   - 阶段 6：发布／备份／回滚上线工程

**基线 SHA（阶段 0 记录）**：生产 `version.json` revision `a2933d0847f993c4fd01d19f43f491d6787d695e`（builtAt `2026-09-05T15:50:50Z`）；本分支自 `origin/main` 检出。未跟踪本地文件 `AGENTS.md`、`js/trading-canvas.js` 已隔离备份，不纳入本 PR。

## 1. 现状核验与基线校正

### 1.1 已验证事实

| 检查项 | 实际结果 | 对迭代的影响 |
|---|---|---|
| 线上首页 | 浏览器打开 `https://stockgame.xieyw.top/`，标题“早知道当初不炒了”；三个入口为模拟盘、知识馆、悔棋局 | 不换品牌，不另起产品首页 |
| 线上视觉 | 米色纸张、手绘边框、猫插画、纸／墨主题 | 沿用现有样式变量，不按旧说明重做赛博朋克主题 |
| 线上开始流程 | 点击开始后先选择成交模式，有次日开盘／当日收盘两个选项 | 账号入口不能覆盖或丢失此流程 |
| 线上版本接口 | `/version.json` 返回 revision `a2933d0847f993c4fd01d19f43f491d6787d695e`，builtAt `2026-09-05T15:50:50Z` | 该提交作为本次评估的产品基线 |
| 本地分支 | 当前 `main` 是 `99b90675cb35639caaf50b4ba3d416a7cd492ee5`；本地 `origin/main` 指向上述线上提交；两者相差 36 个提交，且前者为后者祖先 | 开发前执行受控同步，不把旧结算逻辑搬进服务端 |
| 两版本行情 | 本地旧 main：200 只；线上 revision 对应 Git 数据：999 只；两份日期跨度均为 2024-01-02～2026-09-04 | “198 只、只有 2024 年”文案过时；999 只是对应提交的数据核验，不是对浏览器缓存行情的逐字节证明 |
| 结算差异 | 旧 main：第 31 日开盘平仓；线上提交：两模式均在第 30 日收盘结算 | 排行规则必须版本化，不能混用两个版本 |
| 部署 | 已存在打包、SHA256 校验、release 目录、current 软链接切换、回滚和 GitHub Actions | 扩展现有流程，而非现场 `npm i && restart` |
| 当前文件状态 | `AGENTS.md`、`js/trading-canvas.js` 为未跟踪文件 | 本次保持原样；开工同步分支前先确认归属，禁止清理覆盖 |

证据位置：线上 [首页](https://stockgame.xieyw.top/) 与 [版本接口](https://stockgame.xieyw.top/version.json)；对应 Git revision 下的 `js/game.js`、`js/result.js`、`js/state.js`、`js/load-stocks.js`、`css/base.css`、`data/stocks_data.json`、`deploy/*` 和 `.github/workflows/deploy-production.yml`。

核验边界：已浏览首页及成交选择弹层、核对版本接口和对应源码；没有在生产注册、提交成绩或登录服务器。服务器规格、实际 HTTPS nginx 配置、磁盘余量、备份服务和流量仍待运维核实。初次访问曾超时，后续浏览器与版本接口成功，不据此认定网站故障。

### 1.2 开工基线要求

- 先保护现有未跟踪文件；随后获取远端 main 最新状态，核对与生产 revision 的关系，再从确认后的主线创建 `codex/account-cloud-v1`。本文不替用户执行 checkout、合并或发布。
- 若开工时 main 已继续演进，针对游戏规则与部署做一次增量差异审查，记录新的 base SHA。
- README、AGENTS 中关于主题、数据规模和“没有 CI”的历史说明，列入文档修正任务；不以过时说明覆盖现有产品事实。

## 2. 对原方案的评估与取舍

| 原建议 | 结论 | 定稿方案及理由 |
|---|---|---|
| 静态前端＋同机轻量 API | 接受 | 小规模产品合适，保留同域 `/api/v1/`，降低跨域和部署复杂度 |
| Express 或 Fastify | 收敛 | Express 5 + ESM，避免实现过程中二次选型 |
| SQLite / better-sqlite3 | 有条件接受 | 单机单 API 进程、短事务、WAL；数据访问层独立。迁移 PostgreSQL 仍有 SQL、并发与数据迁移成本，不承诺零改动 |
| 前端原结构完全不动 | 调整 | 页面层少动；交易计算抽为共享纯函数，这是服务端复核的必要改造 |
| 客户端 POST 收益率 | 替换 | 开局签发 + 结束提交完整动作序列 + 服务端重放；保留对局与规则快照 |
| 登录就能防刷、60 秒去重 | 替换 | 登录证明账号，不证明成绩；数据库唯一键解决重复，限流处理滥用，两者独立 |
| 全局按局 Top10，可一人多席 | 调整 | 每人每榜最佳单局，降低霸榜；两成交模式严格分榜 |
| 收益率相加称累计盈亏 | 删除该指标 | 主显最佳、平均、胜率和有效局数；独立局既不相加称收益，也不跨局复利 |
| 随机头像独立 API | 简化 | 客户端随机选一个预设 ID，再统一 PATCH 保存 |
| 预留 email / phone 空列 | 暂缓 | 当前没有相关业务，不收集、不占位；日后通过迁移新增 |
| session 表或签名 cookie | 收敛 | 服务端可撤销 session，浏览器只持不透明随机凭证；不是只靠客户端签名数据 |
| 定期 cp SQLite 文件 | 替换 | 在线 Backup API + 校验 + 异机副本 + 恢复演练 |
| 管理后台本版不做 | 与目标冲突 | 纳入最小后台：用户、战绩、榜单治理、审计、系统状态 |
| 无账号恢复与异常流 | 补齐 | 密码修改、恢复码、退出、过期处理、禁用、注销、断网重试 |

## 3. 产品目标、角色与范围

### 3.1 本版必做（P0）

- 用户名密码注册／登录／退出；当前登录态、改密码、恢复码、注销账号。
- 昵称、12 个十二生肖内置头像、随机选择、参与排行榜开关。
- 登录后发起的完整模拟盘云端保存；个人列表、详情、基础统计。
- 次日开盘榜／当日收盘榜，各 Top10；当前用户排名或未上榜原因。
- 服务端行情快照、动作重放、幂等、防越权和基础限流。
- 最小治理能力（禁用用户、下榜／判无效、简单审计）；管理入口先不上公网（见 §0.1）。
- 数据迁移、发布、备份、恢复、回滚、健康检查、测试与告警。

### 3.2 后续（P1 / P2）

- P1：跨设备续局、训练成绩云同步、每周统一题目挑战、邮件找回、个人资料导出。
- P2：第三方登录、复杂风控、上传头像、关注与社交、赛事、奖励、支付。
- 本版不加入仓位管理、手续费、滑点、涨跌停成交判断、整手交易；保持现有简化模拟模型，并标注“非真实交易撮合”。
- 知识馆、训练题、悔棋局不进入本版排行榜，也不混入模拟盘统计。

### 3.3 权限矩阵

| 能力 | 游客 | 正常用户 | 管理员 |
|---|---|---|---|
| 三个现有模块完整体验、查看公共榜 | 是 | 是 | 是 |
| 创建云端对局、保存战绩 | 否 | 仅自己 | 仅自己 |
| 查看战绩详情、改资料、密码、注销 | 否 | 仅自己 | 仅自己 |
| 后台查用户与战绩 | 否 | 否 | 是，记录访问审计 |
| 禁用／恢复用户、下榜／恢复成绩 | 否 | 否 | 是，必填原因 |
| 改写收益、冒充用户、读取密码或会话凭证 | 无入口 | 无入口 | 无入口 |
| 分配管理员权限、数据库恢复 | 无入口 | 无入口 | 仅服务器受控运维命令，不放网页 |

管理员自己的成绩不进入公共榜，避免治理利益冲突。禁用用户的云端写入全部停止，登录会话撤销；公开榜剔除该用户。游客体验依然可用。

## 4. 页面与关键用户流程

### 4.1 首页与开始游戏

- 不增加第四张大型主卡。在现有首页右上区域增设“登录／注册”或“头像＋昵称”，与纸／墨切换分组；移动端自动换行。
- 主入口旁提供“排行榜”；用户菜单提供“我的战绩、个人设置、退出登录”。管理员菜单额外显示“管理后台”。
- 成交模式选择继续使用当前弹层，并显示状态：游客“本局仅本地练习”；登录用户“本局将保存到我的战绩”。
- 登录后先请求云端开局，再进入游戏；保留现有分阶段加载提示。创建失败提供“重试”和“转为本地练习”，不默默伪装成云端局。
- 已有未完成云端局时提示“继续本机对局／放弃并新开”。一账号最多一个活动局；异机仅提示已有活动局，可主动放弃，不承诺本版跨设备续局。

### 4.2 注册与登录

- 注册字段：用户名、密码、确认密码；昵称可选，默认“新同学”而非登录名；头像默认随机预设。
- 用户名：4～24 位 ASCII 字母、数字、下划线，首位字母；trim 后小写存储与查重；注册后不改。保留 admin、root、system 等运维名称。
- 密码：4～128 个 Unicode 码点（产品覆盖：最短 4；见 §0.1），最多 512 UTF-8 字节；允许粘贴、密码管理器、空格；不截断、不 trim、不强制大小写符号组合；禁止常见弱口令。前后端采用同一校验口径。长度默认参考 [OWASP Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)。
- 昵称：NFC 标准化、两端去空白后 2～16 个码点，可重名；禁止控制字符与冒充官方的保留名称；按纯文本输出。
- 显示数据用途与服务条款入口，由用户主动确认；未勾选不提交。榜单参与是独立开关，默认关闭，不捆绑服务条款。
- 注册成功即建立普通会话；展示一次恢复码，提示妥善保存，然后回到原界面。恢复码不进入日志、埋点或本地存储。
- 登录错误统一“账号或密码错误”，不在登录／找回接口透露账号存在性。注册用户名冲突可明确告知。
- 无邮箱／手机号：恢复账号使用用户名＋恢复码；两者与密码均丢失时，不做人工凭昵称认领或管理员直接设密。

### 4.3 设置与账号生命周期

- 12 张固定 SVG 头像（十二生肖），存 `avatar_id`（1～12）。骰子只改变待保存选择且尽量避开当前头像；一次“保存”提交昵称、头像及榜单开关。
- 修改密码需当前密码；成功撤销所有旧会话，要求重新登录。
- 恢复码：服务端生成 32 字节随机值，只存摘要；找回成功消耗旧码、换发新码并撤销所有会话。设置页凭当前密码可重置恢复码；重置不可重复查看旧码。
- 注销：输入当前密码＋明确二次确认；立即停止登录、撤销会话、移出榜单、终止活动局。后台保留短期去标识审计，具体清理见第 11 节。
- 设置更新失败不关闭表单；退出登录须以服务器确认和清除 cookie 为完成标志。退出失败显示重试提示，不把本地清空等同于服务端退出。

### 4.4 结算页

- 保留身份揭晓、收益、图表、分析。增加存储状态：`未保存 → 保存中 → 已保存 / 待重试 / 校验失败`。
- 已保存展示“查看本局战绩”；参与榜单者显示排名或原因；未参与者显示“在设置中开启排行榜”。
- 服务器复核完成前显示“本机预览收益”；成功后以服务端结果为准。差异超过 0.01 个百分点提示“收益已按统一规则校准”，保留 requestId 供排查。
- 游客文案：“登录后开始的新对局可云端保存并参与排行榜。”登录不追认当前游客局，不展示“登录即可保存本局”的误导承诺。
- 会话过期保留当前结算记录，重新登录同一账号后重试；账号切换不转移记录。
- 本机待提交仅保存对局 ID、规则版本、动作和 owner ID，不保存凭证；最多 5 条、保留 7 天。明确“待提交仅在此设备，清理浏览器数据会丢失”。退出／换号后停止自动发送并隔离原账号记录。
- 请求超时先显示待重试，绝不立即生成新对局 ID。确认网络恢复后重试原对局即可。

### 4.5 我的战绩与排行榜

- 我的战绩为独立页面区域（建议 `/#/me/games`），不是嵌套弹窗。列表按完成时间倒序，20 条一页，有空态、错误态和加载态。
- 筛选：成交模式、规则版本、行情版本；默认当前榜单口径。每条包含收益、日期、模式、交易次数、标的、保存状态。
- 详情：完整 30 日图、决策序列、实际成交点、期末估值标记、规则／行情版本。只对本人和管理员开放。
- 排行榜（`/#/leaderboard`）：两个模式标签、Top10、自己的名次卡、最近更新时间、规则说明、匿名或不参榜说明；游客可读。
- 公开只展示名次、当前昵称、头像、收益率、现实完成日期；不返回登录名、密码、会话、IP、动作全日志或他人的私有详情链接。
- 空榜写“还没有有效成绩，完成一局试试”；零收益使用中性色；正红负绿并同时显示正负号，颜色不是唯一信息。
- 移动端以卡片展示列表；弹层可键盘操作，焦点限制在弹层内，Esc 关闭后回到触发点；错误状态使用可访问提示。

## 5. 统一游戏规则：必须先于战绩接口完成

### 5.1 冻结 `rule_version = sim30-mtm-v1`

当前线上有一个需修正的边界：next_open 在第 29 日下买单，会于第 30 日开盘买入；线上 endGame 又把这笔锁定持仓当日收盘记为卖出。收益有数值，但与 T+1 的真实成交叙述冲突。

本版采用**期末净值估值**，而不是把期末所有仓位伪装成实际卖出。这样保留 30 日收盘收益口径，不再引入第 31 日，也不制造锁定仓位的同日卖出。

| 规则项 | 定义 |
|---|---|
| 时间窗口 | 最多 30 个历史预览交易日＋恰好 30 个游戏交易日；日期来自行情序列，不按自然日推算 |
| 决策 | 第 1～29 日每日至多一个动作：buy / sell / hold；每次动作推进一日；第 30 日仅“结束并结算” |
| next_open | 看到第 d 日收盘后，动作按第 d+1 日开盘成交，d=1…29 |
| same_close | 看完第 d 日 K 线后，动作按第 d 日收盘成交，d=1…29；明确是教学简化 |
| T+1 | 卖出成交日必须大于该持仓买入成交日；可在买入成交日收盘挂次日开盘卖单 |
| 仓位 | 空仓／全仓，不做杠杆、做空、部分成交；买入要求空仓，卖出要求持仓 |
| 第 30 日 | 所有未平仓头寸以第 30 日 close 估值，记 `valuation`，不计入卖出成交次数；空仓直接结算 |
| 初始资产 | 每局重新设为 100,000 模拟元；无手续费和滑点，不继承上一局资金 |
| 完整局 | 决策日 1～29 齐全、合法、有最终 finish；没有买卖的完整局仍记个人战绩 |
| 显示与标记 | K 线只包含 30 个游戏日，期末估值用不同于买卖的标记及图例；不显示第 31 日 |

此处是有意的产品微调：第 30 日去掉“卖出”，只保留“结束并结算”；原线上按第 30 日 close 卖出的数值与期末估值一致，但成交次数和已实现／未实现分类会变化。因此新旧规则分开，不回填假想历史战绩。

### 5.2 收益与精度

设已平仓各笔收益倍数为 `sell_price / buy_price`，其乘积为 `M`（无平仓时为 1）。

```text
空仓：equity_multiple = M
持仓：equity_multiple = M × day30.close / current_buy_price
return_ratio = equity_multiple - 1
return_pct = return_ratio × 100
```

- 服务端使用十进制定点／高精度计算；选定一套十进制实现，在共享引擎中使用，禁止各端自行 toFixed 后累计。
- 排序落库 `return_ppm = round_half_up(return_ratio × 1,000,000)`（有符号整数，半值远离零）；1 ppm = 0.0001 个百分点。显示 `return_ppm / 10,000` 的百分数，保留两位小数。
- 服务端重算后只在最后量化一次；API 同时返回整数 `returnPpm` 与十进制字符串 `returnPct`，例如 123400 和 `"12.34"`。
- 非有限数、非正价格、异常 OHLC 或不完整窗口在导入／开局时阻断；不靠拍脑袋设置“收益最多 100%”代替复核。
- 游戏内浮盈与最终净值共用同一引擎；评分维持教学展示，不参与榜单。若持仓未卖，评分不得伪造卖出点，应显示“期末估值”。

### 5.3 个人统计

- 分相同模式、规则、行情版本统计有效完整局；默认当前口径。退出、过期、校验失败、被判无效的局排除。
- 指标：有效局数、最佳收益、平均单局收益、盈利局数、胜率；0 局时收益与胜率展示 `—`。
- 胜率 = `return_ppm > 0` 的局数 / 有效局数；零收益计入分母，不计入盈利局。
- 平均 = 各局 return_ppm 的算术平均，显示前才舍入；不命名为累计收益。
- 示例：两局 +10%、−10%，平均 0%，胜率 50%；不能解释为一笔资金的连续投资结果。
- `trade_count` 只计真实 buy / sell 成交笔数；valuation 不计。未平仓利润仍属于本局净值收益，详情予以区分。

## 6. 云端可信度、状态机与失败处理

### 6.1 本版可信边界

采用“服务端签发题目＋结算时动作重放”，不是每点一次就联网，也不是只接收客户端报分。

它能阻止随意修改收益、伪造价格、错用规则、重复记分和挪用他人对局；**它不证明玩家没有提前看过行情，也不证明动作是在当时真实做出的**。静态数据、开源历史数据和批量动作上报仍允许事后构造合法序列；账号也不等于真人唯一身份。

所以：页面明确“历史行情练习榜，仅供娱乐与复盘”；本版不关联奖励或奖金。若未来做竞赛，另立项目实现受控行情逐日下发、不可回改的逐步事件、统一题目／次数限制与额外风控；仅隐藏股票名或把数据移到后端仍不足以保证公平。

### 6.2 开局与结算

1. 登录用户选择模式，带 `Idempotency-Key` 请求创建对局。
2. 服务端校验账号状态、活动局上限、频率；随机选股票，再从合法起点（含末端）均匀选窗口，固定模式、规则与行情版本。
3. 原子写入对局，保存历史＋30 日行情快照（最小重放材料），返回 gameId、expiry、窗口索引与版本。客户端从同版本行情包取显示数据；版本不匹配则更新数据，不能继续用旧包。
4. 本机记录 1～29 日动作；仅对操作后的最终序列记一次，不提交客户端成交价格或 userId。
5. 结束时提交 `{ actions, finish: true }`；服务器从快照重放，验证持仓、日期、T+1 和规则。
6. 在同一事务内保存动作、派生成交、收益与结果；同时将对局置为 settled。响应返回权威结果。
7. 个人统计与排行榜查询数据库，不由前端更新计数；榜单受参与开关、账号状态与治理状态实时过滤。

### 6.3 状态与幂等

```text
active ──合法结算──> settled
active ──主动放弃──> abandoned
active ──超过 7 天──> expired
settled ──完全相同请求重试──> 同一结果（不新建、不累计）
```

- 使用服务端 UTC 开始／完成时间；行情日期单独存 date string；UI 转 Asia/Shanghai 显示。上榜日期不是历史行情日期。
- 建局有效期 7 天，规则版本部署更新不改变已有对局；过期局只保留必要元信息，不再接受首笔结算。
- 无效动作请求返回 422，原活动局保持不变；已落库的同局不同动作返回 409，严禁覆盖。
- 一账号一活动局由数据库约束实现；同一建局幂等 key + 相同 payload 返回原局；同 key 不同模式返回 409。
- 对已 settled 局的相同重试，即使已超过 expires_at 仍返回原结果；对未结算局才执行过期检查。
- 结算检查顺序：认证和归属 → 已保存结果及 payload hash → 活动状态／过期 → 重放 → 事务提交。
- 对局归属由 session 确定，path ID 必须匹配；他人 ID 统一按 404 处理，前端传入 userId 没有效力。
- 自动重试最多 3 次（1、3、10 秒），只对网络错误／可重试 5xx；429 尊重 Retry-After；401 重新登录；409／422 显示具体中文处理指引。

## 7. 排行榜规格

### 7.1 榜单键与排序

榜单键：`(rule_version, dataset_version, fill_mode)`。默认展示当前发布指定的规则与行情版本；旧版榜可切换查看但不与新榜合并。第一版只做历史最佳榜，不加月榜／赛季系统。

入榜条件：

- 对局 settled，服务端复核通过，至少一次 buy；零交易局可存档但不入榜。
- 结果 `validity=valid`、`leaderboard_hidden=false`；账号 active、role=user、参与开关开启。
- 每用户选其该榜最高 return_ppm 的一局；同收益选择更早完成的局，仍相同则 gameId 升序。
- 然后按 return_ppm 降序、finished_at 升序、userId 升序排序并取前 10；使用确定性序号，不设并列名次。
- 登录用户返回自己在完整候选集中的名次，而非仅 Top10 中的名次；不满足资格返回明确 reason。
- 收益展示四舍五入相同仍可能排序不同，说明“按未展示的内部精度排序”。

### 7.2 治理与统计联动

- “仅下榜”：结果仍有效，个人统计保留；该用户下一条有效最佳可递补。
- “判为无效”：个人统计和榜单都排除；本人仍看得到该记录和原因。
- 禁用用户、用户关闭参榜或注销立即排除其全部公开成绩；解除禁用／重新参榜按当前有效记录重新计算。
- 修改昵称／头像后历史榜项展示当前资料，不复制登录名到成绩表。
- MVP 先采用有索引的实时查询，不引入 Redis 或榜单物化表。若加缓存，治理与隐私变更必须同步失效，不能等待 TTL。

## 8. 技术架构与代码落点

```text
浏览器：现有 H5、账号／战绩／榜单页面、独立 /admin/
        │ HTTPS 同域 /api/v1/*
nginx ──┼─ public/：HTML / CSS / JS / 行情 / 头像
        └─ 127.0.0.1:3001 → Node API（stockapi 用户，单进程）
                               ├─ SQLite（账户、会话、战绩、审计）
                               └─ 只读不可变行情版本
```

- Node.js 24 LTS；Express 5；better-sqlite3；ESM JavaScript。确切依赖版本在脚手架阶段锁定 lockfile，CI 与 Linux 生产验证一致。Node 官方建议生产使用受支持的 LTS，参见 [发布表](https://nodejs.org/en/about/previous-releases)；框架见 [Express 5 文档](https://expressjs.com/en/5x/api/)。
- 保留前端零框架；管理员列表也先用原生模块，不为四个管理页面引入独立前端框架。
- 共享领域模块不引用 DOM、window、网络或数据库；前端负责展示，服务端负责裁决。数据库访问仅在 repository 层。
- 十进制依赖通过固定版本供应到共享引擎（原生 ESM 本地 vendor 或一个确定性的小型生成步骤），不在浏览器运行时从 npm 下载。这不要求重写整站为打包应用。
- 新增测试：领域逻辑用 Node 内置 test runner；API 集成测试用临时 SQLite；浏览器回归使用 Playwright。

建议增量目录（相对项目根）：

```text
shared/engine.js                 # 动作重放、T+1、估值、收益
shared/rules.js                  # 版本化规则定义
js/api-client.js                 # fetch、错误、CSRF、超时
js/auth.js                      # 会话与账号弹层
js/profile.js                   # 设置
js/game-sync.js                 # 建局、动作记录、待提交
js/my-games.js                   # 列表与复盘
js/leaderboard.js                # 榜单
images/avatars/01.svg … 12.svg（鼠…亥，深色手绘）    # 沿用现有 images 打包路径
admin/index.html + js/ + css/    # 仅静态管理壳，敏感数据来自鉴权 API
server/package.json + package-lock.json
server/src/app.js + index.js + config.js
server/src/routes/{auth,me,games,leaderboard,admin}.js
server/src/services/             # 对局、治理、备份状态等
server/src/repositories/ + middleware/
server/migrations/               # 有序前向 SQL 迁移
server/scripts/                  # migrate、admin、backup、restore-check
server/tests/ + tests/e2e/
docs/openapi.yaml                # 开发阶段产出，本文先锁定契约
deploy/stockgame-api.service     # systemd
```

现有文件改动重点：`index.html` 入口与路由；`js/state.js` 增加云端状态但不混入凭证；`js/game.js` 调共享引擎；`js/result.js` 权威结算与保存状态；`js/analysis.js` 区分估值／成交；`js/load-stocks.js` 校验行情版本；`deploy/*` 扩展服务端发布。

新增 `images/avatars` 利用现有打包目录，避免新建 `assets/` 后忘记加入发布清单；新增 `shared/`、`vendor/`、`admin/` 仍须显式打包。

## 9. 数据模型与约束

所有 ID 使用随机 UUID 字符串；时间为 UTC ISO 8601，数据库字段 snake_case、JSON camelCase。枚举加 CHECK，关联加外键。以下是实现必需字段，不是建议预留列。

| 表 | 必需字段与约束 |
|---|---|
| users | id PK；username_normalized UNIQUE；password_hash；nickname；avatar_id CHECK 1…12；role=user/admin；status=active/disabled/deleted；leaderboard_opt_in 默认 false；recovery_code_hash；created_at、updated_at、deleted_at |
| sessions | token_hash PK；user_id FK；csrf_token_hash；created_at、last_seen_at、expires_at、revoked_at；admin_verified_at 可空；token 原文不落库 |
| datasets | version PK（规范化行情文件 SHA256）；file_path（服务端只读路径）；sha256；stock_count；date_min、date_max；created_at；active；复权方式和导入校验摘要 |
| game_sessions | id PK；user_id FK；create_key；create_payload_hash；rule_version；dataset_version FK；fill_mode；stock_code、stock_name、window_start；snapshot_json、snapshot_sha256；status；started_at、expires_at、finished_at；UNIQUE(user_id, create_key) |
| game_results | game_id PK/FK（一局一条）；submission_hash；actions_json；trades_json；return_ppm INTEGER；equity_multiple_decimal TEXT；trade_count；valuation_json；validity=valid/invalid；leaderboard_hidden；moderation_reason；moderated_by、moderated_at；created_at |
| audit_logs | id PK；actor_id（系统任务可空）；action；target_type、target_id；reason；before_json、after_json（字段白名单）；request_id；created_at |
| idempotency_keys | scope、actor_id、key 复合主键；payload_hash；result_ref／脱敏响应；created_at、expires_at；用于后台写操作，禁止缓存密码、恢复码和 session 原文 |
| schema_migrations | version PK；checksum；applied_at |

- `game_sessions` 对 status=active 的 user_id 建部分唯一索引；创建前同事务先处理过期旧局。
- 会话索引 `(user_id, expires_at)`；战绩列表索引 `(user_id, status, finished_at DESC, id)`；榜单维度索引 `(rule_version, dataset_version, fill_mode, status, user_id)` 和收益索引 `(validity, leaderboard_hidden, return_ppm DESC, game_id)`；审计索引 `(target_type, target_id, created_at)`。
- 用 EXPLAIN QUERY PLAN 和 10 万条种子数据确认榜单查询，不假设一个 return_pct 索引就能解决所有连接与去重。
- 不单独持久化“累计局数／总收益”作为另一个真相源；MVP 从有效结果聚合。
- 交易日志为服务端重放的派生数据；前端上传原始动作限 29 个，每个只有 day、action，拒绝未知字段。
- 行情抓取使用前复权，重新抓取可能改变过去价格。因此旧对局依赖不可变 snapshot，不随行情文件更新重算。
- 完成局保留 snapshot 以供复盘；行情大版本文件按引用保留，不随静态 release 自动清理；活跃局保留支持它的规则实现直至有效期结束。
- SQLite 开启 foreign_keys、WAL、合理 busy_timeout（初始 5 秒）和 synchronous=FULL；重放计算在写事务外完成，事务内再次验证状态后短时间提交。WAL 的并发行为参见 [SQLite 文档](https://sqlite.org/wal.html)，better-sqlite3 的事务函数不跨 await，参见 [API 文档](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)。

## 10. API 契约

统一前缀 `/api/v1`。请求 JSON；所有写操作执行认证、CSRF／Origin、字段白名单和大小校验。公共认证写操作免登录但不免 Origin／限流。

### 10.1 接口清单

| 方法与路径 | 输入 / 输出要点 | 权限 |
|---|---|---|
| GET /config | 当前规则／行情版本、可用模式、开关、最低客户端协议版本 | 公开 |
| POST /auth/register | username,password,nickname?,termsVersion,leaderboardOptIn；201 用户、csrfToken、一次性 recoveryCode；Set-Cookie | 公开 |
| POST /auth/login | username,password；200 用户、csrfToken；Set-Cookie | 公开 |
| POST /auth/logout | 撤销当前 session、过期 cookie；204，已退出同样返回 204 | 当前会话或无会话 |
| POST /auth/recover | username,recoveryCode,newPassword；200 新 recoveryCode；撤销会话、不自动登录 | 恢复凭据 |
| GET /me | 用户与 csrfToken；匿名 401；不内嵌全量战绩 | 本人 |
| PATCH /me | nickname?,avatarId?,leaderboardOptIn?；200 当前用户 | 本人 |
| POST /me/password | currentPassword,newPassword；204，撤销所有会话 | 本人 |
| POST /me/recovery-code | currentPassword；200 一次性新 recoveryCode | 本人 |
| DELETE /me | currentPassword,confirmation="DELETE"；204；立即去榜及注销 | 本人 |
| POST /games | fillMode；Idempotency-Key 必填；201 新对局／200 原对局 | 正常用户 |
| GET /games/active | 活动局元信息或 null，不承诺跨设备同步未提交动作 | 本人 |
| POST /games/:id/abandon | 终止活动局；204；已终止重试同结果；settled 返回 409 | 对局所有者 |
| POST /games/:id/finish | actions,finish=true；201 首次保存／200 相同重试 | 对局所有者 |
| GET /me/games | fillMode,ruleVersion,datasetVersion,cursor?,limit?；items,nextCursor | 本人 |
| GET /me/stats | 三个口径筛选；局数、最佳、平均、胜率 | 本人 |
| GET /games/:id | 本人保存详情；活动局仅元信息；无权 404 | 本人 |
| GET /leaderboard | 三个口径筛选；top10、myRank、ineligibilityReason、asOf | 公开，登录时附自己排名 |
| GET /health/live | 进程存活，不泄露配置 | 运维，nginx 限制来源 |
| GET /health/ready | DB 可访问、迁移匹配、行情可用；失败 503 | 运维，nginx 限制来源 |

全部成功 JSON 外层 `{ "data": ... , "requestId": "..." }`；204 无 body。注册由用户名唯一约束防重复；若响应丢失，提示使用刚设置的账号密码登录，恢复码可在设置中重新生成，不缓存敏感注册响应。

建局返回 data 示例（ID 为说明用值）：

```json
{
  "gameId": "uuid",
  "ruleVersion": "sim30-mtm-v1",
  "datasetVersion": "sha256-of-canonical-dataset",
  "fillMode": "next_open",
  "stockIndex": 12,
  "windowStartIndex": 50,
  "historyLength": 30,
  "gameDays": 30,
  "startedAt": "2026-09-06T12:00:00.000Z",
  "expiresAt": "2026-09-13T12:00:00.000Z"
}
```

完成请求 actions 为 29 项、day 从 1 严格连续至 29。示例形态：`{ "actions": [{"day":1,"action":"buy"}, …, {"day":29,"action":"hold"}], "finish":true }`。省略号仅表示文档省略，不是合法 JSON；实现测试必须生成完整 29 项。

完成响应包含 gameId、returnPpm、returnPct、tradeCount、valuation、validationStatus、savedAt；列表、详情、榜单复用同一结果 DTO，不各自算收益。

### 10.2 错误与访问策略

```json
{
  "error": {
    "code": "INVALID_ACTION_SEQUENCE",
    "message": "第 8 日卖出动作与当前持仓不符",
    "details": { "day": 8 }
  },
  "requestId": "uuid"
}
```

- 400 格式／字段错误；401 未登录／过期；403 账号受限、CSRF 或权限失败；404 不存在或他人对象；409 幂等冲突／活动局冲突／不支持版本；410 活动局过期；422 重放校验失败；429 频率限制；503 临时不可用。
- 列表默认 20、最大 50；游标按 `(finished_at,id)`，服务器验证其结构与筛选维度；API request body 最大 64 KB。
- API 默认 `Cache-Control: no-store`，尤其 `/me`、登录、恢复码和带 myRank 的榜单；不通过公共 CDN 缓存个性化 JSON。
- 管理路由、未知 API 返回 JSON 404，不走静态首页 fallback；所有查询参数和排序字段使用白名单与参数化 SQL。

## 11. 账号与数据保护

### 11.1 密码、session 与请求

- 密码使用 Argon2id，独立随机 salt，至少 m=19456 KiB、t=2、p=1；在生产同规格机器压测并限制并发哈希。依据 [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)。
- session 使用 32 字节密码学随机 token，DB 存 SHA256 摘要；这与密码的慢哈希用途不同。登录轮换 token；登出、改密、找回、禁用、注销立即撤销。
- Cookie：`__Host-stockgame_session; HttpOnly; Secure; SameSite=Lax; Path=/`，不设置 Domain。普通会话 7 天空闲过期、30 天绝对过期；last_seen 更新节流至每 5 分钟，避免每次读取都写库。
- 前端同域 `credentials:'same-origin'`；凭证不存 localStorage。开发环境单独 cookie 名，通过本地同域开发服务代理，生产 Secure 规则不随开发设置降低。
- 已认证写请求检查会话绑定 CSRF token，同时精确核对 Origin（含 scheme、host、port）；无 Origin 的浏览器写请求默认失败。登录、注册、找回也核对 Origin，防 login CSRF；跨域默认不开放。机制参考 [OWASP CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)。
- CSRF token 由独立 CSRF_SECRET 对 session 原始随机 token 做带用途前缀的 HMAC 派生，数据库只存摘要；GET /me 可利用请求 cookie 重新派生返回，不通过读取摘要还原 token。凭证轮换后 CSRF token 同步变化，校验采用恒定时间比较；密钥置于服务端环境文件。
- 只信任来自 loopback nginx 的转发头，不用无条件 trust proxy；nginx 覆盖 X-Forwarded-For 为实际 remote_addr，避免伪造 IP 绕过限流。
- 昵称等用户内容使用 textContent；禁止插入用户 HTML。所有客户端错误只返回白名单字段，不回传堆栈／SQL／目录／密钥。
- 管理页 CSP 从严且全部脚本同源。现有主站有内联 onclick、外部 ECharts 和 new Function 行情加载，不能直接加严格 CSP 使整站失效；先迁移行情为 JSON、移走事件内联并自托管依赖，再从 Report-Only 收紧。
- 会话策略参考 [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)；以上具体过期时间是本产品默认值。

### 11.2 限流初始值（可配置，不作为作弊判决）

| 操作 | 初始限制 |
|---|---|
| 登录／找回失败 | 账号＋IP 组合 5 次／15 分钟；另设 IP 30 次／15 分钟，渐进退避，无永久自动锁号 |
| 注册 | IP 5 次／小时、20 次／天；NAT 误伤有明确提示，管理员可排查 |
| 开局 | 用户 10 次／分钟、100 次／天；只有一个 active 局 |
| 保存 | 用户 30 次／分钟；合法重复不新增统计，但仍计入请求频控 |
| 资料更新 | 用户 10 次／分钟 |
| 公共榜单 | IP 120 次／分钟 |

nginx 做基础 IP 请求速率限制；单 API 进程做业务限流。进程重启会重置内存计数，不能作为唯一风控依据；每日建局上限直接查询持久化对局数。禁止把共享 IP 上用户一律禁用。

### 11.3 数据用途与保留

- 只收集账号、密码哈希、昵称头像、必要战绩与运维事件。公开榜参与默认关闭，关闭后立即去榜，私有记录保留。
- 日志不含密码、恢复码、cookie、CSRF token、完整请求 body。仅为滥用排查保留必要 IP，运维访问受控；应用日志默认 30 天、审计 180 天，这是产品保留策略，不是法律结论。
- 未结算过期／放弃局 30 天后清理快照与动作；有效战绩随账号保留；服务条款说明数据范围及删除流程。
- 注销立即去标识并使公开成绩不可见；30 天内删除该账号凭据、session、对局及成绩，保留不含昵称／登录名的必要审计。用户名在清理前保持占用，清理后可再注册为新账号，不恢复旧身份。
- 备份最长保留 30 天；删除任务生成受控 tombstone 清单，恢复旧备份时先重放删除／撤销清单，再开放服务，避免“备份恢复使已注销账号复活”。
- 上线前由运营核查隐私声明、备案、行情使用与相关合规要求；本规格不把技术选型等同于合规结论。

## 12. 最小管理后台（P0）

> **分期说明**：阶段 5 先交付「禁用用户、成绩下榜／判无效、简单审计」；完整四组页面可在网络边界就绪后补齐。管理入口默认不上公网（IP／VPN／CLI）。

### 12.1 四组页面

1. **概览与系统**：用户总数、近 7 天注册、完整云端局数、保存失败率、API 版本、schema 版本、行情版本、最近备份成功时间和磁盘告警。无埋点时不声称 DAU／留存已统计。
2. **用户管理**：按用户 ID／登录名／昵称搜索，状态筛选、游标分页；详情展示资料、创建时间、战绩摘要；禁用／恢复、强制退出、重置不当昵称。无密码查看、代登录和网页提权功能。
3. **战绩与榜单治理**：按模式、用户、日期、收益、状态筛选；查看服务端动作重放与快照；“仅下榜／恢复展示／判无效／恢复有效”分别操作，必填原因。禁止直接编辑收益率或行情。
4. **审计日志**：记录操作者、对象、动作、原因、前后状态、时间、requestId；只读分页，不给网页清空日志按钮。

后台以可读表格和筛选为主，复用颜色、字体和基础卡片，不需要首页级插画动效。移动端可完成查找、查看和禁用，复杂日志以横向滚动表格展示。

### 12.2 权限与接口

- `/admin/` 是静态壳，隐藏链接不是权限控制。所有 `/api/v1/admin/*` 请求服务端检查 `role=admin` 和账号 active。
- 第一位管理员通过服务器交互式命令创建／授予，不设默认密码、不暴露注册传 role；管理员账号也可正常登录，但不入榜。
- 首版后台入口和 admin API 通过 nginx 的运维 IP 白名单／VPN 限制；生产未具备该网络边界时，后台暂不上公网，待补 TOTP 后再开放。这是部署门槛，不是省略后台。
- 管理员进入后台需密码二次验证，`admin_verified_at` 有效 15 分钟；管理写操作超时重新验证；敏感账号、重要成绩操作二次确认并填写理由。
- 禁用用户须同事务更新状态＋撤销会话＋写审计；客户端隐藏菜单后仍需后端逐次校验权限。管理员不得禁用自身或最后一个管理员；最后一个管理员的自助注销也必须先完成受控权限交接。

| 路由 | 内容 |
|---|---|
| POST /admin/reauth | 当前密码；更新 admin_verified_at |
| GET /admin/overview | 聚合与系统健康摘要 |
| GET /admin/users；GET /admin/users/:id | 搜索、列表、详情 |
| PATCH /admin/users/:id/status | active / disabled、reason、expectedUpdatedAt |
| POST /admin/users/:id/revoke-sessions | reason；撤销所有会话 |
| PATCH /admin/users/:id/profile | 仅 nickname、avatarId、reason、expectedUpdatedAt |
| GET /admin/games；GET /admin/games/:id | 列表与重放明细 |
| PATCH /admin/games/:id/moderation | validity、leaderboardHidden、reason、expectedModeratedAt |
| GET /admin/audit-logs | 操作者／对象／日期筛选 |

管理写操作支持幂等请求键；乐观版本不匹配返回 409，防止两个管理员相互覆盖。读取敏感详情与全部写操作均记审计；失败日志不记录密码。

注册／保存／榜单展示开关本版用受控环境变量，不做通用网页配置中心；更改需运维审计。关闭新局不影响已有局完成，除非显式进入保存维护模式。

## 13. 部署、备份与回滚

### 13.1 扩展现有 release 结构

生产推荐目录（服务器路径，不是本机产物）：

```text
/srv/stock-website/releases/<sha>/public/   # nginx 唯一静态根
/srv/stock-website/releases/<sha>/server/   # 不经 nginx 暴露
/srv/stock-website/current → releases/<sha>
/var/lib/stockgame/app.sqlite              # 与 release 生命周期分离
/var/lib/stockgame/datasets/<hash>/        # 不可变数据版本
/var/backups/stockgame/                    # 本机一致性快照
/etc/stockgame/api.env                     # 最小权限，不进仓库
```

现有 nginx root 是 `/srv/stock-website/current`，必须同步更新为 `.../current/public`；否则将 server 目录一起打包可能暴露源代码、配置或数据库。首次转换须保留旧 nginx 配置，回滚不仅切软链接，还需恢复相应静态根。

- 打包严格白名单：public 只收前端文件、admin 壳、共享模块、版本化 vendor、images、公开行情；不包含 `.git`、`.env`、SQLite、server/tests、私有日志和备份。
- 现有 shell 部署框架继续保留校验、锁、原子切换。服务端依赖用 `npm ci --omit=dev`，在与目标 OS／架构一致的构建环境或新 release 的 staging 中以无特权用户安装；不复用 Mac 上的 native node_modules。
- systemd 单进程运行于 stockapi，监听 loopback；运行用户只写数据库／业务状态目录，代码只读。stockdeploy 只负责受限发布，不与数据库读写身份共用。
- API 反代 `location ^~ /api/` 必须优先于静态规则；proxy_pass 保留 `/api/v1` 路径；设置请求大小、超时及安全转发头。未知 API 不落回 index.html。
- 实际 TLS 配置需查看服务器当前配置；仓库现有示例只有 80 端口，不能直接覆盖生产 HTTPS 配置。
- 当前静态 JS／CSS 缓存 7 天且文件名不含 hash，需要修复发布一致性：未指纹化 HTML／JS／CSS 使用 revalidate；新 hash 资源可 immutable；行情文件按 dataset hash 命名，config 和 version no-store。
- API 至少兼容上一前端协议一个发布周期；旧页面缺少云端能力仍能游客游玩。客户端版本过低时云端开局返回明确升级提示。

### 13.2 发布顺序

1. CI：规则测试、API 测试、浏览器回归、schema 检查、打包白名单、依赖审计；产出 SHA256 和版本 manifest。
2. 上传并验证包；在新 release staging 完成依赖安装与配置校验；数据库／行情目录绝不随解包删除。
3. 创建一致性 DB 备份并校验；迁移采用前向、兼容旧代码的 expand 模式，记录 checksum。破坏性删列另一个发布做。
4. 首次路径迁移准备可恢复 nginx 配置；发布进入短维护窗口：停止新建／写入、等待在途请求结束，再迁移和切换 current、重启 API、reload nginx。
5. 检查 ready、version、登录、建局、结算、榜单、管理权限；通过后解除维护。对单机承诺短暂 API 中断，前端重试兜底；不宣称零停机。
6. 失败自动回滚代码软链接和相关 nginx 配置、重启旧 API；保留兼容性迁移和最新业务数据。记录 revision、schema、dataset 三个版本。
7. 确认稳定后按现有策略清理旧代码包；被对局引用的数据与规则版本另行保留。

### 13.3 备份与恢复

- 使用 better-sqlite3 `db.backup()` 或 SQLite Online Backup API。运行中的数据库不直接只 cp 主文件，尤其 WAL 模式；依据 [SQLite 在线备份文档](https://sqlite.org/backup.html)。
- 默认每小时一致性快照：最近 48 个小时点、最近 30 个日点；总保留不超过 30 天。至少一份加密副本位于另一台机器或受控对象存储，同机副本不能覆盖主机损坏风险。
- 同时保全行情清单、schema、release manifest 和恢复所需配置；密钥单独受控备份，不混入公开 release。
- 每次备份执行 integrity_check／foreign_key_check、记录大小与摘要；每日校验异机可读取；每月至少一次在隔离目录恢复，验证用户／战绩数量、随机对局重放和登录撤销。
- 目标 RPO ≤1 小时、RTO ≤1 小时，首次演练计时验证后才作为运维承诺。
- 代码回滚不等于数据库恢复：普通发布失败保留新写入。仅数据灾难才停写、保全故障副本、核对丢失窗口并人工批准恢复；恢复前先应用注销 tombstone、全量撤销旧 session，防止失效会话重新生效。

开发阶段必须实现并在临时目录验证的命令契约：`npm run db:migrate`、`npm run admin:create`（交互式）、`npm run db:backup -- --output <path>`、`npm run db:restore-check -- --backup <path>`、`npm test`。这些是待实现脚本名称，不表示当前仓库已存在。

### 13.4 监控与容量

- 指标：请求量、5xx、登录失败、结算成功／失败、重放不一致、SQLite busy、磁盘使用、备份年龄、API 重启。
- 初始告警：5xx 连续 5 分钟 >1% 且至少 100 请求；任意持续写入失败；磁盘 >80%；最近成功备份 >2 小时；ready 连续失败。
- 预发布容量基线：10 万条完成局，20 个并发虚拟用户模拟混合读写，持续 10 分钟。非哈希读接口 P95 <300ms，结算 P95 <500ms，认证 P95 <1.5s，整体错误率 <1%；记录机器规格，不把目标当实测结果。
- 若短事务优化后仍出现持续写争用、需要多实例／高可用或备份窗口不达标，再评估 PostgreSQL。不要仅凭用户总数自动迁库。

## 14. 开发拆分与验收

### 14.1 可直接拆成 issue 的工作包

按 1 名熟悉项目的全栈开发者估算，约 20～29 个开发日，含联调测试；实际受服务器环境和存量代码差异影响，不是承诺工期。

| 阶段 | 工作包与交付物 | 依赖 | 估算 |
|---|---|---|---|
| M0 基线 | 保护未跟踪文件、对齐生产主线；冻结规则；更新过时说明；记录 baseline SHA | 无 | 1 天 |
| M1 可验证内核 | shared engine、两模式、期末估值、固定样例、行情版本 manifest、旧体验回归 | M0 | 3～4 天 |
| M2 账号与库 | server 骨架、迁移、session、注册登录、资料、改密、恢复码、注销、权限测试 | M1 | 4～5 天 |
| M3 云战绩 | 开局、唯一约束、重放与 finish、待重试、我的战绩／详情／统计 | M2 | 4～5 天 |
| M4 排行与后台 | 分模式榜、每人最佳、参榜开关、后台四页、治理和审计 | M3 | 4～6 天 |
| M5 上线工程 | 原子发布扩展、nginx/systemd、恢复演练、性能和移动端回归、灰度 | M4 | 4～8 天 |

账号登录、排行、后台并非三个彼此独立的开发任务：规则与数据契约先稳定，再写页面。若时间紧，优先缩减装饰和统计种类，不删服务端重算、幂等、权限或恢复演练。

### 14.2 必过验收用例

| ID | 场景 | 预期 |
|---|---|---|
| BASE-01 | 当前线上三入口、纸／墨、两成交模式、加载失败提示 | 新版本仍可用，游客无 API 也可玩 |
| AUTH-01 | Alice 与 alice 并发注册 | 只生成一个标准化用户名 |
| AUTH-02 | 密码空格／中文／长密码、弱密码、粘贴 | 按同一规范处理，无截断；弱密码给中文错误 |
| AUTH-03 | 登录轮换、退出、改密、恢复、禁用 | 旧会话按策略失效，不被本地 UI 假象掩盖 |
| AUTH-04 | 恢复码重复使用、日志检查 | 旧码失效，日志没有原始凭证 |
| PRIV-01 | 关闭榜单参与、注销后刷新榜单 | 立即移出，公共响应不含登录名 |
| GAME-01 | 29 次 hold 后 finish | 完整保存，0%收益；不入榜 |
| GAME-02 | next_open：d1 买、d2 卖；d2 open=10、d3 open=11 | 10%，两次实际成交，T+1 合法 |
| GAME-03 | same_close：d1 买、d2 卖；d1 close=10、d2 close=9 | −10%，两次实际成交 |
| GAME-04 | 两笔已平仓收益分别 +10%、−10% | 本局收益 −1%，不是 0% |
| GAME-05 | next_open：d29 买，d30 open=10、close=11 | 期末净值 +10%；一次 buy、零 sell、一个 valuation |
| GAME-06 | same_close：d29 买，d29 close=10、d30 close=9 | 期末净值 −10%，valuation 不是实际卖出 |
| GAME-07 | 同日 round-trip、空仓 sell、重复 buy、缺日、多日、非法枚举 | 422，不产生结果，不改变活动局 |
| GAME-08 | 重复 endGame／finish、并发 10 个相同 finish、响应丢失后重试 | 只有一条结果；收益和计数不重复累计 |
| GAME-09 | 同一对局改动作重交／拿他人 ID／提交伪造价格或收益 | 409／404／400，不改变已有成绩 |
| GAME-10 | 数据更新前建局、更新后结算 | 使用旧快照与规则；不同版本榜不混合 |
| GAME-11 | 到期、主动放弃、活动局冲突、账号切换 | 状态和错误码符合第 6 节，不串号保存 |
| RANK-01 | 一人多条、同收益、显示舍入相同、负收益 | 每人一席；按内部精度和规定次序稳定排序 |
| RANK-02 | 手动下榜／判无效／恢复／封禁／退出参榜 | 下榜和无效的统计差异正确，下一最佳递补 |
| ADMIN-01 | 普通用户直接请求 admin API、伪造 role | 403；静态管理壳不泄露数据 |
| ADMIN-02 | 二次验证过期、缺少原因、并发修改 | 认证提示／400／409；成功治理原子写审计 |
| SEC-01 | 跨站写请求、SQL 元字符、昵称含 HTML、伪造转发头 | 校验生效；无脚本执行、SQL 注入和限流绕过 |
| OPS-01 | 打包清单与 HTTP 探测 server、.env、SQLite、备份路径 | 无私有文件暴露；API 404 不是首页 HTML |
| OPS-02 | 迁移失败、API 启动失败、旧浏览器缓存、旧 active 局 | 回滚保持数据；旧协议按兼容策略处理 |
| OPS-03 | 从异机备份恢复并重放 tombstone | 已注销账号不复活；旧 session 不恢复有效 |
| UX-01 | 375px／768px／桌面、纸／墨、键盘、慢网／断网 | 核心流程无横向溢出，错误不吞掉操作 |

固定游戏样例须构造完整 30 日、合法 OHLC 的行情；两端跑相同 golden fixtures，最终 return_ppm 完全一致。表中的片段价格只是关键断言，不是完整行情文件。

### 14.3 完成定义（Definition of Done）

- 全部 P0 页面和接口有集成用例，核心领域边界有自动化测试；文档／OpenAPI 与实现一致。
- 任何公开收益来自服务器复核；个人列表、统计、榜单统一口径。
- 普通用户越权、管理员绕过审计、重复结算、CSRF、凭证泄露检查通过。
- 预发布完成真实 Linux 部署、回滚、异机备份恢复和性能报告，记录命令、输入、输出与退出码。
- 用户数据不随发布丢失；生产静态根不暴露后端目录；新功能关闭时游客模式继续运行。
- 未达到这些条件时，不因“页面已完成”而宣称整体迭代完成。

## 15. 发布计划与效果观察

1. 预发布：独立数据库、测试账号、独立 cookie／域名；完成全套验收。不得把生产账号和战绩复制到公网测试站。
2. 内部试用：白名单开放云端新局；榜单标注测试、测试数据隔离，后台先接 VPN／IP 限制。
3. 小流量开放：开启注册和云保存，观察至少 48 小时；重点看保存失败、账户问题、SQL busy、恢复路径。
4. 全量：完成一次回滚／恢复演练后扩大入口；保留关闭注册、关闭新云局、关闭榜单的运维开关。

产品观察指标（目标后续用真实基线设定，不凭空承诺增长）：注册完成数、登录用户建局数、有效完成率、保存成功率、7 日重复游玩用户占比、参榜开启率。放弃／过期局必须进入完成率分母，避免幸存者偏差；游客转化漏斗需要另行说明匿名测量方式后再加埋点。

**开工前可直接按本文默认值推进的决策已经冻结：两模式分榜、每人最佳、游客不追认、30 日期末估值、服务端重放、最小后台、单机 SQLite。**

仅以下环境事项在部署前确认：服务器 OS／CPU／RAM／磁盘；生产 nginx 的 HTTPS 配置；运维 IP／VPN；异机备份目的地与凭据管理；隐私声明与运营联系人。它们不影响先完成 M0～M4，但属于上线放行条件。

---

## 附录：给实施者的第一张任务单

**任务：完成 M0＋规则骨架，不先写登录弹窗。**

1. 记录生产 revision、开发 base SHA、工作区未跟踪文件归属；在确认后的主线创建功能分支。
2. 把两成交模式和期末估值抽成无 DOM 纯函数，先用 GAME-01～07 固定样例跑通。
3. 在现有界面接入该引擎，保留首页、模式弹层、图表、知识馆、悔棋局；修正第 30 日按钮与估值标记。
4. 生成带 hash 的行情 manifest，确保前端索引与服务端快照同版本。
5. 评审规则与接口 DTO 后，再进入数据库、账号、对局持久化开发。

这样能避免“登录、排行榜、后台都写完了，最后才发现前后端收益口径不同”的返工。
