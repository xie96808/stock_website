# 实时对战 PvP「对战」：产品与实施规格

> 版本：v1.1，2026-10-11；状态：**设计已评审，功能未实现**。
> 评审基线：线上静态 revision 与本地远端跟踪分支均为 `fb13936984ae9166d58fa2bdc72423aee445933e`。
> 本文替代原设计稿；原稿备份与修订证据在 `docs/reviews/pvp-battle-2026-10-11/`。文中的新模块、接口、迁移、容量指标都是开发要求，非已上线能力。

## 0. 结论与阅读顺序

**可行，但应实现为独立的服务端裁决双人玩法，不是把幽灵对局换成 WebSocket。** 现有账号、韭币、交易引擎、曲线、图表、API 和 SQLite 可复用；难点在双人一致性、有限信息、计时、资金台账、异常终局和部署恢复。

本版定位：两名登录用户主动约战，同一股票窗口、固定次日开盘成交，29 回合同步锁定、30 个交易日估值；终局比较收益及回撤。韭币仅为站内虚拟积分，不引入充值、提现、转让或现金奖励。历史行情可被识别，本功能不宣称竞技级反作弊。

实施顺序：先读 §1 的差异与阻断问题 → §2～7 产品及裁决规则 → §8～11 数据、接口和工程边界 → §12～15 资源、验收、部署与工作包。

### 0.1 原稿决策的保留与调整

保留原稿“已确认”栏目记载的方向：30 根 K 线／29 次决策、对手昵称可见、固定 next_open、每人 20 韭币、胜者到账 35、平局／系统作废退款、每日最多 10 次胜奖、不做免费友谊赛、不做 PvP 排行榜、称号展示、相对价格图表。该栏目是产品输入记录，不代表本轮所有新增取舍已再次经人工确认。

本轮给出以下明确默认方案，可据此开发；如要改变，先改文档与对应验收用例：

| 项目 | 定稿 | 相对原稿的改变与原因 |
|---|---|---|
| 实时通道 | REST 承担全部业务写入；WS 只推状态与心跳；轮询降级 | 删除两套写协议，复用已有认证、CSRF、错误码和幂等 |
| 扣费时点 | 双方准备完成、playing 开始时，双人原子扣费 | 准备超时尚未扣款，减少退款分支与争议 |
| 每日奖励上限 | 双方开局前均须有胜奖资格；当日已领 10 次者暂停新开 PvP | 删除“照收 20、赢了奖 0”的隐性惩罚；本版没有无奖付费局 |
| 同对手限制 | 同一无序用户对 24 小时最多 3 场已开局对战；第 4 场拒绝开局 | 替代只把积分乘零却继续奖币；系统作废不占此额度 |
| 断线策略 | WS / REST 心跳统一；自动 hold，连续 5 回合缺席判弃权；双方同批次达到阈值作废 | 轮询玩家不再被误判为离线 |
| 服务重启 | 首版一律将未完局系统作废并精确退款；正常发布先排空 | 删除“有时恢复、有时中止”的双策略，避免计时补偿和版本混跑 |
| 部分对局复盘 | 只展示实际共同揭示区间及当时净值；不补满未来 hold | 弃权仍记胜负，但不把反事实收益混入完整局均值 |
| 等级 | 修正分段公式；固定 K=32；不承诺“再赢几局升级” | 原公式、称号表、示例互相矛盾；预测场次数学上也依赖对手 |
| 复盘范围 | V1 做双人曲线、成交点、回撤、基准与分歧日；最优 DP / B/S 报告后置 | 避免在关键计时和终局路径运行重分析、或引入前端依赖 |
| 服务器规模 | 小流量 20 房间起，压测通过再升至 50 | 原“1.6GB、77MB RSS、微秒引擎、200 房间”缺本轮实测支撑 |

## 1. 已部署产品、代码事实与可行性边界

### 1.1 本轮核验（2026-10-11）

| 证据 | 查证结果 | 开发影响 |
|---|---|---|
| [线上首页](https://stockgame.xieyw.top/) 浏览器访问 | 纸／墨手绘笔记本、登录／注册、公告、模拟盘／知识馆／悔棋局、安卓下载入口 | 延续现有外观和导航，不另造首页 |
| 模拟盘及选择玩法页面 | 模拟盘有选择玩法、战绩、榜单；选择玩法可见经典、今日挑战、一把梭、生存模式 | PvP 放模拟盘二级入口，与“选择玩法”并列，减少等待对手时的导航层级 |
| [版本接口](https://stockgame.xieyw.top/version.json) | revision=`fb13936984ae9166d58fa2bdc72423aee445933e`；builtAt=`2026-10-11T02:43:38Z` | 对应源码用于本次评审；这证明静态版本，不单独证明 API 二进制 revision |
| [公开配置](https://stockgame.xieyw.top/api/v1/config) | ruleVersion=`sim30-mtm-v1`；event-v1、日挑战、幽灵、残局、韭币答题等开关为 true；尚无 pvpBattle | 原有功能已存在，不能再沿用 9 月“先建账号后台”的规划 |
| 行情版本 | version/config 均为 `f87951444560053c680c2920e06fbd8169ce07d57ff43882f306048f1a809d03` | 对局建立时固定该类 dataset version，不随更新漂移 |
| 本地工作区 | main=`da83f941c675a10183d83b0a3fac517bfc08eca0`，落后上述 origin/main 59 个提交；目标文档只在 origin/main 存在 | 本次只提取、修订文档，不切分支、不合并或覆盖已有改动 |
| 未提交文件 | users.js、request.js、auth.js 有修改，另有 release/ 和残局脚本 | 全部保留，开发前另行整合归属 |
| 服务器参数 | 未登录服务器，未测真实 RSS／CPU／磁盘／并发／生产端口 | 原稿的 8790、1.6GB 等只能作为待核实参数 |

本轮只读访问页面和公开接口，无生产注册、约战、币操作、服务器重启或性能压测。游客会话未验证登录后的个人面板及后台；这些部分结合对应提交源码评估。

### 1.2 复用清单与真实限制

| 现有模块 | 可以复用 | 需隔离／修改 |
|---|---|---|
| `shared/rules.js`、`shared/engine.js` | 29 动作、T+1、全仓、`settleGame` 终局口径 | `replayGame(...finish:false).returnPpm` 不直接作为 PvP 已揭示日净值，见 §4 |
| `shared/equityCurve.js` | 曲线、MDD、买入持有基准、revealedGameDay | 净值计算只使用已裁决动作；锁定当前动作后不得提前外发派生价格／收益 |
| `server/src/lib/dataset.js` | `pickRandomWindow`、原始快照、数据版本 | 服务端选窗一次；历史固定 30 根；检查选窗后长度和 OHLCV，无客户端股票选择 |
| `server/src/lib/gameProtocol.js` | 可见行情切片的思想和函数 | `buildVisibleMarket` 仍带原日期／价格，需再白名单变换；`buildStateDto` 追加完整 window，严禁直接复用 |
| ghost / 图表 / screen-router | 对手揭示节奏、可见图表构造、路由与主题 | 独立 PvP 状态与屏幕，不接单人完整 window、快进、反悔、自动保存路径 |
| sessions / request / auth-http | cookie session、REST Origin／CSRF、中文错误 | WS upgrade 不经过 Express 中间件；`originOk` 当前为私有函数，需抽公开纯校验函数 |
| `jiuCoin.js`、台账 | 余额和通用 `insertJiuCoinLedger` | `deductGameCreateCost` 按 game refId 去重，同 matchId 连扣两人会跳过第二人，必须新增 PvP 经济服务 |
| 现有 SQLite 与迁移 | 独立 pvp 表、短写事务、备份 | 最新是 019；实施时取下一空闲迁移号，当前候选 020，不改既有迁移 |
| `js/analysis-pure.js` | 未来可提取纯分析能力 | 依赖 patterns；API 包当前仅含 server/shared，不含 js。不要直接从服务器 import 前端文件 |
| API 打包与回滚 | `package-api-production.sh`、bootstrap、rollback-api | 打包明确排除 node_modules；原稿“打包 node_modules/ws”与白名单相冲突。回滚脚本也需补 npm ci，见 §14 |

### 1.3 已复现的三个问题

- 固定样例：d1 close=10，d2 open=20／close=22，d1 买入。原引擎非终局 returnPpm 为 **−500000（−50%）**；裁决后已揭示 d2 收盘净值应为 **100000（+10%）**，与 equityCurve 尾点一致。原因是该返回值用旧日收盘除以次日买价。PvP 要明确用曲线尾点，不在本特性里悄悄改全站引擎。
- `next_open` 的 `['buy','sell']` 是合法动作：d1 决策→d2 买；d2 决策→d3 卖。因此“locked 状态禁用卖出”错误，按钮要判断预计卖出成交日。
- 原 `floor((rating-700)/100)` 在 1000 得 3，而称号表要求 4；1132 的称号等级也与原返回示例不一致。详见 §7。

## 2. 产品范围与交互

### 2.1 P0 必做

- 大厅、上线可约战、约战／拒绝／取消／超时、准备确认、实时双人房间。
- 服务端逐回合锁定和揭示、REST 降级、断线重同步、多标签一致性。
- 正常／弃权／作废结算、双人原子扣费、奖励／退款唯一性、评分和私有历史。
- 基础双人复盘、举报＋后台处理、屏蔽用户、运维排空／紧急关闭、恢复作废。
- 浏览器与现有 Android WebView 可玩，无需强制 App 更新。

后置：自动匹配、跨服／多实例、聊天、观战、好友、推送通知、PvP 公开排行榜、免费友谊赛、长断线恢复、最优多笔 DP、升级场次预测、图片分享、新原生 App 能力。结果页 V1 “分享”只复制双方战绩摘要，不生成公开私有复盘链接。

### 2.2 用户流程

```text
模拟盘 → 对战大厅（游客只见玩法说明与在线人数）
登录 → 主动开启「可约战」（进入页面不自动公开在线状态）
选择在线对手 → 约战 20 秒 → 接受 → 双方准备 10 秒
双方就绪 → 同事务校验与扣费 → 房间首屏（历史30根 + 游戏d1）
每回合30秒：买／卖／观望 → 锁定 → 等对手或截止
裁决 → 揭示下一根、对手动作、双方当前净值 → 下一回合
第29回合裁决 → 第30日收盘估值 → 胜／负／平、收益、币和评分变化
结果 → 复盘／回大厅／再次约战（重新征求同意，不直接扣费）
```

- 房间主标识“决策回合 d/29 · 已见第 d/30 个交易日”；不能把回合数写成 30。
- 对手当日只显示“尚未锁定／已锁定”，不显示选择、价格、仓位变化或预计算收益。
- 自己点击后显示“提交中”，收到成功确认才显示“已锁定”。超时／断网先 GET state 确认，再用同一幂等键重试；不先切下一根。
- 进入准备页说明：双方各付 20、胜者**到账 35（净赚 15）**、负者净减 20、平局退 20、每日胜奖额度、最长约 15 分钟、切后台继续计时。
- 等待时明确退出和取消入口；房间返回键弹“离开后继续计时／认输”提示。关闭浏览器不自动发送认输。
- 为动画预留 1 秒：每次裁决后新回合 `opensAt=resolveTime+1000`，`deadlineAt=opensAt+30000`；双方看到相同时间戳。下一回合开放前按钮禁用。
- 可并存原有单人活动局，但不修改它的状态或期限（当前 games.js 是 7 天，不是原稿的 24 小时）。进入 PvP 后前端离开单人屏并保存既有草稿；禁止由单人模块触发 PvP 自动保存、快进或扣币。

### 2.3 页面与空态

- 新路由：PVP_LOBBY、PVP_ROOM、PVP_RESULT、PVP_HISTORY；深链只含随机 matchId，恢复时先检查权限。
- 大厅只向已登录用户列出**主动公开可约战**的用户（头像、昵称、称号、最近 5 场，最多 50 条分页）；游客只见人数、说明和登录入口。无在线对手时引导“去玩幽灵对局／稍后再来”，不偷偷匹配机器人。
- 首页登录芯片菜单增加“对战档案”；个人设置弹层新增对战 Tab，但渲染逻辑独立模块，避免继续扩张 auth.js。
- 结果同屏突出胜负原因、双方收益／回撤和币变化；收益高但回撤决胜／弃权胜的原因明确展示。
- 红涨绿跌沿用中国市场规则；胜／负／平用文字和图形，不仅靠颜色。375px 手机、纸／墨主题、键盘焦点和动态状态可访问性均为验收项。

## 3. 大厅、约战、准备与互斥

### 3.1 presence 不是持久化房间状态

- 内存按 userId 聚合，连接最多 3 条；WS 心跳或鉴权 REST heartbeat 每 15 秒更新 lastSeen。45 秒未收到任一有效活动即判离线、从可约战名单移除。
- WS 断开不立即移除，REST 正常轮询的用户仍在线；WS protocol pong 仅说明连接健康，JS heartbeat 作为页面存活证据，两者分别记录。
- 退出大厅关闭可约战；已有 preparing／playing 房间不因此被终止。退出登录撤销对应连接，其他有效登录仍可恢复同一对局。
- 一名用户：最多 1 个出站 pending、3 个入站 pending、1 个准备中或进行中 PvP。pending 本身不占“房间锁”；列表的“忙碌”只用于 preparing／playing，避免原稿“收一条就忙”与“三条入站”矛盾。

### 3.2 约战竞态规则

- 自己约自己、目标离线／关闭可约战、互相屏蔽、任一方房间锁被占用、余额或计奖资格不足，直接拒绝；发出时检查一次，正式开局再次检查。
- 同时 A→B、B→A：唯一无序 pair pending 键；第二个创建返回已有约战及“请接受”状态，**不替用户自动接受**。
- 接受在 `BEGIN IMMEDIATE` 短事务内：检查 pending 和截止 → 检查双方房间锁 → 创建 waiting_ready、两席 player、两条 active_member → challenge accepted → 取消涉及双方的其他 pending。只允许事务全部成功。
- 接受 A→B 与 C→B 同时到达，B 的 active_member 主键使其中一个成功；另一方得到 TARGET_BUSY，零扣费。
- 准备超时／任一取消：aborted(reason=ready_timeout/ready_cancelled)，释放双方锁，零扣费、零胜负。连续 3 次准备超时／15分钟暂停约战 5 分钟，避免单次弱网即惩罚。
- 两人准备确认后再校验资格与余额；双人扣款任一失败，整笔扣款回滚；随后单独将准备房间作废并释放锁，错误中不暴露对方具体余额。

### 3.3 多设备

不使用“最新 hello 自动抢主控”。同一账号各端看到同一 match state；第一条被服务器接受的本回合 action 生效。相同 key 重试返回同一确认；另一设备不同 key 返回 ALREADY_LOCKED，再获取状态。明确提示“本账号已在另一设备锁定”；其他设备不可修改。

## 4. 回合裁决与信息隔离（最高优先级）

### 4.1 精确日序

设 `resolvedRounds=k`，范围 0…29：

- 正在决策 `round=k+1`（仅 k<29），已揭示游戏 bar 数 `k+1`。
- 首屏 k=0：历史 30 根＋游戏 d1；双人的动作累计为空。
- round=d 选择，按 d+1 开盘成交。双方锁定或到 deadline 才把两人的该回合动作加入已裁决序列，然后揭示 d+1 完整 K 线。
- d=29 裁决后 k=29：全部 30 根揭示，按 d30 close 估值终局；没有第 30 次决策，也没有第 31 根游戏 K 线。
- 末日持仓为 valuation，不伪造 sell，不计入交易笔数。

### 4.2 锁定时只验证动作，不泄露成交结果

提交 schema：`{round,action}`，action 为 buy/sell/hold；不可带 userId、收益、价格、snapshot、rule、daySeconds。

合法性根据**已裁决状态**判断：空仓才可 buy；持仓且预计卖出成交日大于买入成交日才可 sell；hold 总合法。服务端可内部用 `replayGame` 验证，但确认只包含 actionAccepted、round、lockedAction（仅本人）、revision；未来成交价、buyPrice、未揭示日 MTM 和错误内的原始引擎对象一律不返回。

例：d1 决策 buy→d2 开盘买。到 d2 决策，显示“可挂卖单，d3 开盘成交”，即使 engine rawPosition 仍标 locked，也允许 sell。

### 4.3 日终收益唯一口径

在双方本回合已经裁决的前提下，k=已裁决动作数：

```js
// bars 是服务器私有的30日原始快照；actions 只含已裁决动作。
const curve = buildEquityCurveCash({
  fillMode: 'next_open', bars, actions, finish: k === 29
});
const visibleMtmPpm = roundHalfUp((curve.at(-1) / INITIAL_CASH - 1) * 1e6);
// k=0 特判空仓、0收益；k=29另用settleGame核对终局收益相等。
```

只使用 shared 现有数值与 ppm 量化口径，不为 PvP 另换一套浮点／定点算法。正常终局两个路径的 returnPpm 必须一致；发现差异停止结算并系统作废退款，告警而非静默改分。

### 4.4 PvP 专用白名单 DTO

- `pvpMatchView(match,viewerId)` 独立构造。游戏中 REST、WS、错误、重连、日志给客户端的字段都经过同一视图，禁止 spread 数据库 row 或通用 game DTO。
- history=30，gameBars=k+1；日期替换为 `h1…h30`／`d1…d30`，不用与真实日期有映射的时间戳。
- 价格基准固定为游戏 d1 close（双方首屏已知）；所有可见 OHLC 同乘 100/base，展示相对百分比，不返回 base 或真实 costBasis。
- 成交量相对**只由历史＋d1**确定的固定尺度，如这 31 根正成交量的均值归一化；全为零则尺度=1。禁止用未来 30 日最大值／均值归一化，避免提前信息泄露。
- MA、区间范围、最佳点、图轴 min/max 仅根据可见 slice 算。服务器逐日净值由原价计算，展示归一化和舍入不参与撮合。
- 剔除股票名称／代码／index、windowStart、真实行情 date、随机种子、完整快照 hash、未揭示价格、未来分析和原始成交价；双方相同。datasetVersion 可用于规则标识，但不会带具体股票索引。
- 本人本回合 lockedAction 可见；对手只见 lockedToday，已裁决动作截止 k。任一方锁定到 resolve 之间，双方净值仍为上一已揭示收盘状态。
- 正常 completed 终局才揭示原股票与全部窗口；弃权结果只返回已揭示段，见 §6。系统作废不开放额外行情。
- 同域静态行情和历史价格走势仍可用于反查；归一化不是加密或强反作弊。不得据此承诺“查不到股票”。

## 5. 时间、事务、传输与恢复

### 5.1 服务端权威时钟

- 所有 PvP 新时间字段使用 UTC epoch 毫秒；日计奖键独立采用 Asia/Shanghai。客户端使用 serverNow 校准显示，客户端时间无裁决效力。
- `deadlineAt` 就是唯一有效截止；删除额外不展示的 500ms 宽限。处理函数在进入裁决临界区读取服务器时间，`now < deadlineAt` 才接新 action，等于截止即关闭。
- 先验 session／归属，再查询幂等记录：已接受的相同 key 即使过截止仍返回旧确认；新 key 才检查时间。客户端自带 sendTs 仅作诊断。
- 每房间一个定时器是唤醒提示，不是事实来源；timer、收到第二份 action、REST sync、后台巡检都调用同一个幂等 `resolveIfDue`。
- 每 1 秒扫描逾期活动房间补偿漏 timer；所有更新检查 match 的 status、round、revision。实现不得在事务中 await 网络或跑重分析。
- 单次进程／宿主机卡顿超过 5 秒导致错过有效截止时，该局标 system_stall 作废，而非把服务故障当玩家 AFK；监控记录。部署排空、连接上限是防止该路径大量触发的第一道保护。

### 5.2 两个必须原子的写路径

**锁定事务**：读当前轮与状态 → 时间／动作／归属校验 → 插入唯一 `(match,user,round)` action → 记录幂等 payload hash → match.revision++ → commit → 推送对手 locked（不含动作）。

**裁决事务**：读并确认未裁决轮 → 对未锁定者插入 timeout hold → 基于两方同时的存活快照计算缺席计数 → 计算两方已揭示净值 → 写双方派生状态和 pvp_rounds → 原子推进 k / 新 opensAt、deadlineAt、revision，或进入终局事务 → commit 后再广播。

最后回合／弃权终局由同一应用服务处理：条件更新未终止状态、写双方 outcome／指标／评分、插入唯一 settlement、转币、更新统计缓存、释放双方 active_member，全部在一个 SQLite 事务中完成。重分析不参与该事务。崩溃于 commit 前则无终局；commit 后但推送前，重连查询得到唯一终局。

### 5.3 传输定稿：REST 写 + WS 状态失效通知

- Node `ws` 挂现有 http.Server（noServer）。保留 app.listen 的返回句柄；不引入独立实时进程、Redis 或消息队列。
- WS 上行仅 `hello / ping / sync`，不实现 challenge/action/forfeit 等业务命令；所有业务 POST 走相同 service 与幂等规则。
- 下行用 `lobby.changed / challenge.changed / match.changed` 提醒客户端读取 REST 快照，可附白名单状态；同资源 200ms 内合并通知，不对每个大厅心跳做全量广播。
- `match.revision` 是数据库持久化版本，每次可见状态变化递增；大厅另用 `(serverRunId,lobbyRevision)`。不拿全局 seq 比较不同资源，不靠进程内 seq 跨重启排序。
- 乱序／丢帧：较旧 revision 丢弃；收到新 revision 立即 GET；重连无条件 GET active 及当前 state。不实现逐条历史事件补发。
- WS 建连失败时：大厅 GET 5 秒一轮，房间 GET 2 秒一轮，challenge 状态由 `/me/pvp/state` 合并获取；同时鉴权 heartbeat 每 15 秒保持可约战。退避加随机抖动，页面退出即停止，避免重连风暴。
- WebSocket send 队列每连接上限 256 KiB，超过就关闭并要求客户端重同步；4 KiB 是上行消息限制，不是完整行情快照的响应大小限制。

### 5.4 WS 认证与会话撤销

1. 浏览器 POST `/api/v1/pvp/ws-ticket`，已有 session＋CSRF＋Origin；生成 32 随机字节、不透明 ticket，TTL=30秒，存摘要，绑定 sessionHash/userId，单次使用。
2. 连接 `wss://同域/api/v1/pvp/ws?ticket=...`。upgrade 必须精确校验允许 Origin，匹配 active session cookie，原子消费对应 ticket，再接管 socket。
3. nginx／应用对该路径访问日志只记 `$uri` 而非带参数的 `$request_uri`；不记录 ticket、cookie、CSRF。禁止把长期 CSRF token 放 URL。
4. 握手限流、连接数与 4KiB 上行、JSON schema、perMessageDeflate=false；浏览器用原生 WebSocket。实现参考 [ws 官方文档](https://github.com/websockets/ws)。
5. 每 30 秒重新验证会话，收到 logout／revoke／disable／delete 时主动关闭对应连接；每次 REST 写仍查实时账号状态。单次登录退出不是弃权，计时继续；账号禁用／注销是账号不可参赛，走 account_unavailable。
6. 身份检查先于任何 match 读取。第三人 REST 404，WS 不订阅；WS ticket 无权扩张订阅范围。安全依据见 [OWASP WebSocket Security](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html)。

### 5.5 断线、缺席与重启

- 已锁定动作落库，断线不丢；未锁定到期填 hold。只在“该回合 source=timeout 且最后45秒无有效应用 heartbeat”时 AFK+1；用户明确 hold 或有效操作归零，在线自动 hold 不算缺席。
- 同一裁决事务同时检查两方：均 AFK≥5 → aborted(both_afk)；仅一方≥5 → 对方弃权胜；不允许先遍历 A 判负而漏掉 B 的同轮缺席。
- 检查优先级：系统故障作废 → 双方账号不可用／双方AFK → 单方账号不可用／单方AFK → 正常推进或末轮完成。若同一次裁决同时满足末轮与AFK阈值，按此前置缺席规则处理；明确hold不触发AFK。
- REST-only 玩家依然更新 heartbeat，不能把 `ws.isOpen=false` 当缺席依据。App 后台 JS 停顿不暂停服务器。
- 首版每次 API 启动先恢复数据库，再开放 readiness：旧 pending 过期、waiting_ready 作废（零扣费）、playing 系统作废（各退已扣20）；settled 原样。恢复逻辑不依赖 `PVP_BATTLE_ENABLED`，flag OFF 也必须清账。
- 退款 transaction 可重复执行；恢复失败 ready 返回非成功，禁止带着悬挂扣费开放新局。移除原稿“deadline近120秒恢复并顺延”的分支。

## 6. 胜负、经济与统计

### 6.1 胜负与终局类型

| 类型 | 判定 | 行情／收益展示 | 计胜负／评分 |
|---|---|---|---|
| completed | return_ppm 高者胜；相等则 mdd_ppm 小者胜；仍同为平 | 全30日、真实身份、双方最终净值 | 是 |
| forfeited | 主动认输／单方AFK／单方账号不可用 | 只到 resolvedRounds+1 日，显示“中止时净值”；不补满 hold | 是；胜负由退出原因决定 |
| aborted | 准备失败／系统重启或卡顿／双方AFK／双方账号不可用 | 仅已揭示区间，原因及退款，不额外揭露身份 | 否 |

认输和末轮裁决并发以首先提交成功的终局事务为准；终局条件更新确保只发生一次。认输时尚未共同裁决的 locked action 作取消处理、不撮合，存审计但不显示为成交。所有 type 不再混用 `finished` 和 `settled`。

交易次数=buy＋sell，valuation 另列；删去原稿“sell＋valuation算交易次数”。个人胜率=(win)/(win+loss+draw)，平局进分母；近20场仅含计胜负局，最新在左。完整局数、完整局均值单独列，forfeited／aborted 不混入平均收益。删除“累计收益 +312%”标签，独立局收益不能解释为一笔资金的累计收益。

### 6.2 韭币资格与费用快照

- 每人入场20、胜者到账35、平局各到账20、作废退各自已扣金额。所有配置在开局时写入 `economy_json`（含 economyVersion），中途调环境变量不改变在途局。
- 双方开始时需余额≥20、账号 active、注册满24小时且已完成至少3局有效经典练习、各自该日胜奖次数<10、无双人屏蔽、同pair最近24h已开始且非系统作废的场次<3。资格限制与金额在大厅／准备页说明；未满足者可看介绍，不付费参赛。
- 资格按**开局日 Asia/Shanghai**归属，在 match.reward_ymd 冻结；跨午夜结束仍计开局日。每用户只有一个活动 PvP，计奖槽检查和正式开局同事务，防并发超额。
- 今日胜奖达到10者暂停新开对战，明日恢复。若后续要做“只计分不奖币”需单独设计免费／不同费率玩法，不在这版暗中引入。
- 同IP只是诊断信号，不等于同设备／小号；不因同宿舍或家庭网络没收奖励，不引入设备指纹采集。限制账号年龄、有效练习、pair次数、举报及审计仍无法完全阻止小号串通，需监控而非夸大承诺。

### 6.3 转币矩阵（假设A胜）

| 事件 | A变动 | B变动 | 净流通量 |
|---|---:|---:|---:|
| 双方准备成功，正式开局 | −20 | −20 | −40 |
| 正常／弃权胜结算到账 | +35 | 0 | +35；整局净−5 |
| 平局 | +20 | +20 | +40；整局净0 |
| 系统／双方AFK作废且此前已收费 | +20 | +20 | +40；整局净0 |
| 未开局准备取消 | 0 | 0 | 0 |

新增 `chargePvpEntry`、`settlePvpEconomy`，在同一个 db transaction 内调用余额更新与通用 ledger insert。现有 game_create 不改，不用字符串改造 matchId 绕开旧唯一键。

- ledger reason=`pvp_entry / pvp_reward / pvp_refund`，ref_type=`pvp_match`，ref_id=matchId；新增唯一键 `(user_id,ref_id,reason)` 的 PvP 部分索引。
- `pvp_settlements.match_id UNIQUE` 保证 refund 与 reward 等互斥终局，单靠各 reason 唯一键不足以防止一局先奖后退。
- 更新余额必须带 `balance>=cost` 条件检查 affectedRows；余额或ledger失败全部回滚，两人不能只扣一人。
- `coin_delta` 是该用户整局净额（胜+15、负−20、平／退0），响应同时带 entryCharged、payout、netDelta，避免把35当净赚。
- 账务核对：users余额变化＝流水 delta 之和；每个已开局 match恰好2条 entry，且一个 settlement；任何异常进入告警及新局熔断。
- 异常作弊举报不自动追回或重写历史奖励；管理员可禁用后续参赛，经济纠错需独立审计补偿单，不删除原流水。

## 7. 评分与称号：可重放的简单版本

- rating 初始1000；V1固定K=32，前10场显示“定级中”但不另设不同K。取开局时双方rating_before（每人一活动局确保无并发变化）。
- 期望 `Ea=1/(1+10^((Rb-Ra)/400))`；Sa为1／0.5／0，`deltaA=roundHalfUp(32*(Sa-Ea))`，`deltaB=-deltaA`；各自更新为 `max(700, before+delta)`。触底导致实际delta不一定零和，落库实际变化并测试。
- `level = clamp(floor((rating-700)/100)+1,1,15)`；level≤14区间宽100，level15为2100及以上；不存可与rating不一致的冗余level。

| level | 称号 | 积分 |
|---|---|---|
| 1／2／3 | 韭菜 一／二／三段 | 700–799／800–899／900–999 |
| 4／5／6 | 散户 一／二／三段 | 1000–1099／1100–1199／1200–1299 |
| 7／8／9 | 股民老手 一／二／三段 | 1300–1399／1400–1499／1500–1599 |
| 10／11／12 | 游资 一／二／三段 | 1600–1699／1700–1799／1800–1899 |
| 13／14／15 | 庄家 一／二／三段 | 1900–1999／2000–2099／≥2100 |

新号为散户一段；1132为散户二段、距下一档68分。UI展示称号与本段进度，不显示“N级”，不推算“再赢4局必升级”；满级显示最高段位，无下一档。

- ratingVersion=`pvp-elo-v1`、before／after／actualDelta随终局固化；aborted没有评分事件。
- `pvp_ratings` 是缓存，可按 `pvp_settlements.id` 的提交顺序和已固化delta重建；不能按游戏开始顺序或今天的配置重算旧局。
- 历史score事件保留，不因改昵称／关参榜删掉。自身档案与双方历史私有；大厅只在用户主动可约战时展示摘要。删除原稿匿名 `/users/:id/pvp/stats` 公开接口。

## 8. 数据设计与约束

迁移候选 `020_pvp_battle.sql`，实施前检查主线最新号。以下为**待实现契约**，不表示已经创建表。复用当前 users.id INTEGER、datasets.version TEXT；PvP match／challenge ID用随机UUID，新表时间统一 epoch ms。

| 表 | 必需字段 |
|---|---|
| pvp_challenges | id PK、from_user_id/to_user_id FK、pair_key（minId:maxId）、status(pending/accepted/declined/cancelled/expired)、create_key、payload_hash、created_at、expires_at、responded_at、cancel_reason |
| pvp_matches | id PK、challenge_id UNIQUE FK、status(waiting_ready/playing/settled/aborted)、rule_version、pvp_version、rating_version、dataset_version FK、fill_mode CHECK next_open、snapshot_json、snapshot_sha256、history_length、economy_json、reward_ymd、resolved_rounds 0…29、revision、round_opens_at、round_deadline_at、ready_deadline_at、boot_id、winner_user_id、terminal_reason、created_at/started_at/finished_at |
| pvp_match_players | (match_id,user_id) PK，seat(1/2) UNIQUE within match、ready_at、afk_streak、outcome(win/loss/draw/aborted)、return_ppm/mdd_ppm（正常局；否则NULL）、partial_return_ppm、trade_count、valuation_json、rating_before/after、actual_rating_delta、coin_delta、actions_json（已裁决序列）、analysis_version/analysis_json、analysis_status(pending/ready/failed) |
| pvp_active_members | user_id PK FK、match_id、seat；复合FK(match_id,user_id)→pvp_match_players；只保留waiting_ready/playing成员，结束同事务删除 |
| pvp_actions | (match_id,user_id,round) PK；复合FK→players；round CHECK 1…29；action enum；source(player/timeout)；command_key可空、payload_hash、locked_at；不存 forfeit_fill |
| pvp_rounds | (match_id,round) PK；resolved_at、revealed_day、both_players_state_json（裁决后必要派生值）；用于检测推进一次性、诊断和重放一致性 |
| pvp_settlements | id INTEGER PK AUTOINCREMENT、match_id UNIQUE FK、terminal_type、reason、winner_user_id、resolved_rounds、economy_version、rating_version、created_at；与双方结果、币、评分原子写 |
| pvp_commands | (user_id,scope,key) PK；payload_hash、resource_id、ack_json（白名单）、created_at、expires_at；ready/respond/cancel/forfeit/创建等命令重试使用 |
| pvp_ratings | user_id PK；rating、games、wins/losses/draws、completed_games、completed_return_sum_ppm、updated_at；近期记录按历史查询，不另存recent_json真相源 |
| pvp_reward_days | (user_id,ymd) PK；win_reward_count；只在发胜奖的事务中+1，可由settlements+ledger重建 |
| pvp_blocks | (blocker_user_id,blocked_user_id) PK，created_at；CHECK双方不同；任一方向存在即禁止新约战 |
| pvp_reports | id INTEGER PK、match_id FK、reporter_id、reported_id、reason enum、detail≤500码点、status(open/resolved/dismissed)、resolution、reviewer_id、created_at/closed_at；UNIQUE(match_id,reporter_id) |
| pvp_runtime_control | key TEXT PK、value_json、version、updated_at；持久化drain及操作原因，避免服务重启自动恢复接单 |

### 8.1 必须落库的约束，不只依赖单进程

- challenge发起人≠接收人；status=pending的from_user_id部分唯一；status=pending的pair_key部分唯一。
- 容量槽在accept和进入playing时事务内检查，waiting_ready也占20房上限。选窗快照在正式扣费前生成并验证；只记录完整snapshot及SHA即可审计，删除没有实际种子化RNG支撑的window_seed伪承诺。
- player同局两席独立唯一；每个active_member只属于一个用户；进入playing前确认恰好两席且对应challenge的两人。应用事务维护房间锁生命周期，定期对账检查孤儿锁。
- action必须引用真实参赛者，而非仅外键users；已裁决轮action不可变；`command_key`按用户／match唯一（忽略NULL）。同key不同payload为409。
- `pvp_rounds(match,round)`、`pvp_settlements(match)`和PvP ledger部分唯一索引共同兜底重复执行；同事务状态CAS防过时timer。
- 为matches(status,round_deadline_at)、challenges(to_user_id,status,expires_at)、players(user_id,match_id)、settlements(created_at,id)、reward_days(user_id,ymd)、reports(status,created_at)建索引。
- 事务使用同步better-sqlite3、BEGIN IMMEDIATE语义；DTO构造和广播在提交后，禁止在DB事务内await。保持现有WAL／备份策略，不迁PostgreSQL、不扩成多实例。

### 8.2 幂等、保留与删除

- Idempotency-Key 16～128个ASCII字符；对写请求以route scope＋规范化payload hash比对；成功确认至少保存7天。action已落库的key在对局保留期内可确认；相同key不同action永远409。
- 先认证再读幂等缓存，避免撤销会话仍重放敏感响应。传输结果丢失不等于业务失败；任何重试不重复收费、推进和加分。
- 模式快照、原始行情和动作保留默认180天；之后保留结果／评分／经济摘要，详情显示“复盘已过保留期”。窗口快照供历史重放，不跟随更新后的前复权价格重算。
- pending命令、过期约战默认30天清理；屏蔽持续到用户解除；举报及审计按现有运营保留策略（实施时对齐）。未经完成的举报关联快照暂停清理。
- 接入softDeleteUser、admin disable与tombstone流程：进行中先判账号不可用，连接撤销、列表去标识；历史对手显示“已注销用户”，不把旧昵称永久复制进快照。删除任务按FK顺序清理／匿名化，新pvp表必须纳入恢复与tombstone演练。

## 9. REST 与推送契约

统一前缀 `/api/v1`，沿用项目 `{data,requestId}`／`{error,requestId}` 外壳；所有业务写经过 requireUser、checkOrigin、requireCsrf、PvP资格及限流。公开人数接口不返回用户清单。

| 方法与路径 | 输入／返回 | 权限与要点 |
|---|---|---|
| GET /pvp/lobby/summary | {availableCount,acceptingNew,disabledReason} | 游客可读，不暴露用户身份 |
| GET /pvp/lobby | cursor?,limit≤50 → entries,nextCursor | 登录；只列主动可约战用户；屏蔽双向过滤 |
| POST /pvp/lobby/presence | {available:boolean} | 登录；显式同意上线，无扣费；目标状态幂等 |
| POST /pvp/heartbeat | {} | 登录；WS／降级统一应用存活，15秒一次 |
| GET /me/pvp/state | presence、收到／发出的pending、activeMatchId、资格及本人余额 | 登录；轮询时一次读取避免遗漏邀请 |
| POST /pvp/challenges | {toUserId} | 幂等；201新建／200重复 |
| POST /pvp/challenges/:id/respond | {accept:boolean} | 仅收件人；确认状态快照 |
| POST /pvp/challenges/:id/cancel | {} | 仅发件人；重复返回已取消状态 |
| POST /pvp/ws-ticket | {} → ticket,expiresAt,wsPath | 短期一次性；no-store；丢失可重新申请，不复用旧ticket |
| GET /pvp/matches/:id | PvP专用state／result | 仅双方；第三人404；后台另用admin路由 |
| POST /pvp/matches/:id/ready | {} | 双方ready后原子收费并开始 |
| POST /pvp/matches/:id/cancel-ready | {} | 准备阶段任一方，零扣费 |
| POST /pvp/matches/:id/actions | {round,action} | 必须Idempotency-Key；首次和重复均200确认 |
| POST /pvp/matches/:id/forfeit | {} | playing；幂等，终局返回已有状态而非再次结算 |
| POST /pvp/matches/:id/report | {reason,detail?} | 仅双方，终局后；reportedId由服务端取对手 |
| POST /pvp/blocks | {userId} | 登录；阻止未来约战，不中断当前局 |
| DELETE /pvp/blocks/:userId | 无 | 本人屏蔽记录，返回204 |
| GET /pvp/blocks | 游标列表 | 本人 |
| GET /me/pvp/stats | 称号、进度、胜负、完整局均值、近期20场 | 私有，不设置公开用户stats |
| GET /me/pvp/matches | cursor?,limit默认20最大50 | 按finished_at,id倒序，返回自己的结果和对手公开昵称 |

除presence／heartbeat／ticket外，所有业务POST必须带Idempotency-Key；终局写一次；report另有(match,reporter)唯一性。返回错误映射明确：401会话、403资格/Origin/CSRF、404他人资源、402余额、409状态/同key不同payload/重复锁定、422动作非法、429频率、503容量/排空。登录后被禁用显示账号受限，不泄露引擎原始报错中的行情。

### 9.1 房间 state 示例（字段示意，无省略号JSON）

```json
{
  "matchId": "example-match",
  "status": "playing",
  "revision": 4,
  "serverNow": 1791676830000,
  "resolvedRounds": 0,
  "round": 1,
  "opensAt": 1791676820000,
  "deadlineAt": 1791676850000,
  "market": {
    "historyLength": 30,
    "revealedDay": 1,
    "history": [],
    "bars": [{"label":"d1","open":99,"high":102,"low":98,"close":100,"volume":1.2}]
  },
  "me": {"lockedToday":true,"lockedAction":"buy","mtmPpm":0,"canBuy":false,"canSell":false},
  "opponent": {"nickname":"对手","lockedToday":false,"mtmPpm":0},
  "resolvedActions": []
}
```

示例history为缩短篇幅置空；真实playing首屏必须30根，验收不可使用此空数组冒充完整响应。锁定当前buy后me.mtmPpm仍0，不能提前填次日仓位。resolvedActions每项只包含已裁决round及双方动作，长度严格=resolvedRounds。

### 9.2 推送与动作确认

```json
{"t":"match.changed","matchId":"example-match","revision":5,"serverNow":1791676831000}
```

```json
{"data":{"matchId":"example-match","round":1,"lockedAction":"buy","accepted":true,"revision":4},"requestId":"example-request"}
```

POST响应可能比推送晚到，客户端不可把revision5退回4；action确认和完整状态分开处理。每次重连只同步授权资源。REST响应no-store，WS状态按viewer构造，不广播一份带me信息的DTO给两人。

### 9.3 初始限流与防骚扰

| 项目 | 初始值 | 行为 |
|---|---|---|
| 发约战 | 用户6/分钟、60/日 | 429；同目标被拒3次后10分钟冷却 |
| presence切换 | 用户20/分钟 | 429，不阻断已有房间读取 |
| ticket | 用户10/分钟、IP60/分钟 | 429；共享IP仅粗粒度防滥用 |
| WS并发 | 用户3条，IP软限30条，总限见§12 | 超限拒绝新连接，不踢其他正在玩的用户 |
| action | 用户10/秒、60/分钟 | 包括重试；不重复结算 |
| 私有state GET | 用户120/分钟 | 足够容纳2秒轮询和多标签；超限提示 |
| heartbeat | 用户12/分钟 | 多标签合并／随机抖动 |
| report | 用户10/日 | 超限拒绝；每match一条 |

日级业务额度持久化查询／计数，不能只依赖会随重启清零的内存桶。节流只处理请求，不是作弊判决；禁止用同IP直接定输赢。

## 10. 复盘、个人面板与治理

### 10.1 V1 基础复盘

- 双方完整局收益、最大回撤、每日净值曲线、买入持有基准、真实buy/sell笔数、估值、原始行情（仅正常终局）。
- K线用“我的买卖”和“对手买卖”两种符号／描边，别用红绿区分玩家以免与涨跌冲突；valuation独立标记。
- 逐日滑块由只读已裁决数据渲染；交易按钮永不出现；部分局只到lastRevealedDay。
- “分歧日”：从动作不同的已裁决轮中按双方当日收益差变化绝对值选最多3项；文案只陈述同日操作和差距变化，不把相关性写成因果保证。
- 分析轻量且确定性；analysisVersion固定。可在终局提交后计算缓存，失败仍可看已保存胜负与基础图，不阻塞奖励。重算使用原快照，结果hash可比对。
- `computeBSReport`、最优多笔DP、timingScore先不接入V1：原 `return/optimal` 在负收益／optimal=0时无定义，前端依赖也不在API包。未来需迁至shared、明确T+1及0收益基线，并用暴力枚举小样本校验后再做。

### 10.2 私有面板

展示称号（定级中标识）、总胜负平、近20局点阵、胜率、完整局数、平均完整局收益、最佳完整局收益、历史入口、近20场弃权数。零局显示“尚无战绩”，不显示0%胜率冒充已玩。

原稿近10场可在近20条中截取；不新增累计收益，不把partiallyPlayed收益算完整局。当前账号昵称和头像沿用publicUser投影，支持现有12默认头像／自定义头像，不写死10个。

### 10.3 举报与后台

- 结果页举报选项：疑似作弊／恶意弃权／昵称问题／其他；detail 0～500码点；仅举报当前对手。举报本身不自动退款、改分或处罚。
- 现有非公开admin框架增“对战”：活动房间数／排空状态、终局查询、两方动作审计、金额对账、举报列表、处理备注。
- admin接口：`GET /admin/pvp/overview`、`GET /admin/pvp/matches`、`GET /admin/pvp/matches/:id`、`GET /admin/pvp/reports`、`PATCH /admin/pvp/reports/:id`、`POST /admin/pvp/drain`、`POST /admin/pvp/abort-active`。
- 写操作复用requireAdmin、二次验证、Origin／CSRF、幂等、必填reason和audit_logs；abort-active先显示预计房间／退款人数并二次确认。后台不开放编辑return_ppm、删除ledger或随意改胜者。
- 持久化双向屏蔽过滤大厅和挑战；只阻止未来约战，不给输了的玩家一个“屏蔽即退款”的出口。

## 11. 代码资源、依赖与集成清单

### 11.1 增量模块

```text
server/src/lib/pvp/
  config.js          校验配置／版本化经济参数
  presence.js        内存连接与统一应用心跳
  challenges.js      邀请、接受、房间锁、准备
  match.js           actions、resolveIfDue、状态机
  economy.js         双人扣费、唯一奖励／退款
  settlement.js      原子终局、评分、统计事件
  view.js            按viewer白名单、可见行情归一化
  realtime.js        ticket、WS升级、推送、backpressure
  recovery.js        开机清账、定时巡检、排空
  reports.js         举报、屏蔽、admin治理
server/src/routes/pvp.js
server/migrations/020_pvp_battle.sql   实施时确认序号
shared/pvpMetrics.js                  曲线净值适配和winner纯函数
shared/pvpRating.js                   评分／称号纯函数
js/pvp/{lobby,room,result,transport,profile-battle,store}.js
css/pvp.css
server/tests/pvp/ + tests/pvp/
scripts/pvp-load.mjs                  仅预发布压测
```

### 11.2 必须修改的已有落点

| 文件／区域 | 修改目的 |
|---|---|
| server/src/index.js、app.js | 保留http.Server句柄、启动恢复、WS挂载、路由、退出排空；新表已存在时恢复不依赖flag |
| server/src/lib/config.js、routes/games.js的config响应 | 统一env→config→features.pvpBattle，新增acceptingNew状态、客户端协议版本 |
| request.js / sessions.js / users.js / admin.js | 导出适用WS的Origin纯校验；会话撤销、禁用、注销回调；避免与当前未提交认证修改相互覆盖 |
| jiuCoin.js / 新migration | 复用ledger插入，不改旧game收费；增加PvP唯一索引 |
| index.html、home-ia.js、screen-router.js、auth.js | 入口、独立屏幕、对战档案、feature OFF隐藏；按需加载PvP模块 |
| kline-option.js | 抽可见数据图表适配、去日期／价格刻度；不引入完整窗口依赖 |
| deploy/api.env.example、systemd、nginx片段、README-api | flags、WS代理、停机排空、实际端口、包版本 |
| deploy/rollback-api.sh、发布运维文档 | 正反发布都安装锁定依赖并运行健康检查，不依赖被rsync删除的node_modules |
| backup / tombstones / user cleanup | PvP表、未完局清账、会话撤销、隐私清理和恢复验证 |

依赖仅新增server的 `ws` 稳定版并锁package-lock；浏览器使用原生WebSocket。不使用第三方实时托管，不添加Redis/Postgres。图形用既有ECharts、头像、CSS与SVG图标，无新图片或字体采购；P0无需Android发版。若以后加keepScreenOn，需单独原生接口审查、生命周期清理和App回归，不阻塞Web发布。

## 12. 资源预算、容量与观测

### 12.1 可执行资源表

| 资源 | V1默认 | 必须核实／交付 |
|---|---|---|
| 进程 | 同一台机器、一个API进程管理所有房间 | systemd与反代配置；禁止PM2 cluster或两个写同库的计时进程 |
| CPU／RAM | 先以2 vCPU、2GiB预发布机为参考；若生产约1.6GiB须按真实规格复测 | 30分钟基线RSS、free、CPU、event-loop lag、经典API延迟 |
| 初始房间 | PVP_MAX_ACTIVE_MATCHES=20（准备＋进行合计） | 20房＋60大厅用户通过后才灰度；50房需第二次压测 |
| 总WS连接 | 初始200，单用户3 | 包含大厅／房间／重连重叠；超过拒绝新连接不影响已有局 |
| 内存 | warm API基线之外，PvP增量RSS目标≤128MiB | 不是容量保证；机器仍需≥25%可用内存，V8限堆不等于进程RSS上限 |
| 存储 | 预留至少2GiB新增空间再依据实测调整 | 每局snapshot+58 actions+29 rounds+索引／WAL。按50KiB/局粗估，1万局约0.5GiB未含备份；记录实测均值后重算 |
| 网络 | WS稀疏通知＋按需GET，无全大厅全量高频广播 | 分别压测WS模式和100%轮询降级；后者通常更费HTTP与DB |
| 备份 | 复用SQLite一致性备份及异机副本 | 恢复后旧playing必须作废、退款一次、旧session撤销 |
| 人力 | 1全栈主开发＋QA／运维配合 | 见§15约26～35人日，按角色责任交付，不承诺22天包干 |

### 12.2 负载验收目标（待实测）

- 真实30秒回合连续30分钟：20活动房＋60大厅用户；另测50房＋100大厅、同步截止突发、批量重连、多标签、慢消费者和全轮询。
- action持久化HTTP响应P95<250ms、P99<750ms；服务器裁决延迟P99<250ms；event-loop延迟P99<100ms；非预期5xx<0.1%。数据库一致性错误、重复转币必须0。
- 同机经典局／登录／日挑战的P95相对无PvP基线恶化不超过20%；超限先降房间数／减负，不能只看PvP自己能跑。
- 回合1秒／2秒的加速测试只检验逻辑与写入峰值，不可代替30秒真实时长的连接、心跳、GC与过期测试。
- 监控：active rooms、ws数、queue bytes、action延迟、deadline lateness、AFK、abort原因、SQLite busy、dedupe命中、ledger异常、奖币次数、举报、恢复处理数量。
- 1分钟内system_stall连发3局、账务对账任一异常、DB写失败、内存/磁盘告警即停止新局并告警；不自动把既有局都判玩家负。

## 13. 测试与验收（发布阻断清单）

| ID | 输入／场景 | 必须满足 |
|---|---|---|
| R01 | k=0…29每个阶段 | 已见bar=k+1，决策仅1…29；d29后自动估值，无d31 |
| R02 | d1close10、d2open20/close22，d1buy | 锁定时净值仍0；裁决后+10%，不能−50% |
| R03 | d1buy、d2sell | d2买→d3卖合法；按钮不因locked一律禁售 |
| R04 | d29buy | d30open买，d30close估值；无伪造sell |
| R05 | 完整随机合法序列1000组 | PvP逐日结果、equityCurve和settleGame终值一致 |
| R06 | 未锁定／一人锁定／双方锁定前后的所有REST/WS | 只泄露已裁决信息；锁定不变价、不提前变对手净值 |
| R07 | 两份仅未来bars不同的快照，相同可见前缀与动作 | 进行中响应除随机ID/时钟字段外相同，连归一化volume和错误都不能透露差异 |
| R08 | 不同deadline边界：−1ms、=、+1ms；相同key晚到重试 | 新请求按统一截止；重复已确认动作可回旧ack |
| C01 | A→B、B→A | 一条pending；不自动接受；双方显式同意后才准备 |
| C02 | A→B和C→B并发接受 | 只一个房间占B锁，余额无变化；失败方明确状态 |
| C03 | 准备超时／取消／第二人余额不足 | 零扣费、释放双方锁、不能半扣款 |
| C04 | 最后action、timer、forfeit同时触发 | 一轮只裁决一次，一局只一个终局和转币路径 |
| E01 | 准备成功后两人各20；A赢 | ledger两条entry、A+35；净变动A+15/B−20 |
| E02 | 并发10次相同结算／重复恢复 | 无重复扣费、退款、奖币、评分；settlement唯一 |
| E03 | 每日第10次胜奖后请求新局；同pair第4场 | 拒绝开局、无扣费；上海跨日按开局日冻结 |
| E04 | 同一共享IP两名合格用户 | 不仅凭IP取消奖励；仍受账号/pair规则 |
| S01 | REST-only、WS掉线、App后台、网络恢复 | 应用heartbeat有效者非AFK；重连回同一局，不重复动作 |
| S02 | 双方同一轮都达AFK5／仅单方达 | 双方作废退款／单方弃权负，遍历顺序不影响结果 |
| S03 | commit前进程终止；commit后推送前终止 | 前者按旧活动局恢复退款；后者保持已终局，不重复退 |
| S04 | flag OFF启动，但库有playing | 恢复先清账；新局关闭，历史与结果仍可读 |
| A01 | 第三人访问、跨Origin、无CSRF、过期／重用ticket、注销session | 拒绝，连接和订阅立即或30秒内失效，不泄露对局 |
| A02 | 错key重用、不认识字段、巨大消息、慢消费者 | 明确错误／断开，内存队列有界 |
| P01 | rating700/999/1000/1099/1100/2100；同分平局 | 称号边界正确，K固定，触底实际delta记录正确 |
| P02 | 弃权净值／完整局均值／0局／重建rating | 口径正确，重建不按今天算法重算历史delta |
| G01 | 举报、屏蔽、禁用、删除、恢复旧备份 | 不绕过admin权限和审计；已删除用户不复活，不自动改账 |
| D01 | 从生产同结构API包启动，安装ws；再回滚旧包 | 没有server import js/失效模块；旧依赖重装；旧游戏不退化 |
| U01 | 手机375px、桌面、纸/墨、Android旧版、键盘 | 核心按钮可用、计时可见、无登录弹层覆盖关键动作；后台不暂停计时 |

测试工具：Node内置test runner、真实临时SQLite、两个HTTP会话＋ws客户端、浏览器双用户上下文；注入统一Clock和fake timer，不通过改宿主机时间测试。测试必须覆盖现有主线完整回归，不只新增pvp测试。

资源缺口必须产出报告：相同规格机压力报告、事务故障注入、受限公网WS反代、Android前后台、退款及备份恢复。未经验证的20房／50房只是目标，不写成“已支持”。

## 14. 部署、关闭与回滚

### 14.1 配置与基础设施

| 环境变量 | 默认／含义 |
|---|---|
| PVP_BATTLE_ENABLED | 0；入口与新会话能力 |
| PVP_ALLOWLIST_USER_IDS | 灰度用户列表；双方都需在名单 |
| PVP_MAX_ACTIVE_MATCHES | 20 |
| PVP_MAX_WS | 200 |
| PVP_DAY_SECONDS | 30；生产范围固定，测试由注入Clock加速 |
| PVP_ENTRY_COST / PVP_WIN_REWARD | 20 / 35；写入开局经济快照 |
| PVP_DAILY_REWARD_CAP | 10 |
| PVP_PAIR_LIMIT_24H | 3 |

`acceptingNew = featureEnabled && !drain`；drain持久化到 `pvp_runtime_control`（见§8），不能只放内存重启自动解除。只读历史、认输、退款、恢复和已有房间请求不被“全部路由403”挡住。完全未部署功能时不存在这些接口是另一回事。

nginx在实际HTTPS server中增加WS精确location。**精确匹配的优先级不依赖它出现在 `/api/` 前还是后**。使用与现有API相同upstream，不把本轮未核验的8790写成确定生产端口。

```nginx
# stockgame_api 为待接入的 upstream 名称；部署时指向经核验的当前API端口。
location = /api/v1/pvp/ws {
    proxy_pass http://stockgame_api;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 90s;
    proxy_send_timeout 90s;
    proxy_buffering off;
    # 专用access_log格式只含$uri，不含查询串；在http级定义后启用。
}
```

此片段不是可直接覆盖生产配置的完整文件；保留已有证书、反代头、安全限制，创建upstream和无ticket日志格式后 `nginx -t`。Upgrade/Connection转发依据 [nginx官方说明](https://nginx.org/en/docs/http/websocket.html)；25秒协议ping低于代理90秒空闲阈值。

### 14.2 发布流程

1. 对齐最新main及用户未提交修改；记录静态／API／schema／规则版本。合并含新表与功能默认OFF代码，不借文档评审直接部署。
2. CI跑现有测试＋PvP测试；API打包含server/shared/lockfile，不含node_modules、数据库、密钥。新增ws在Linux目标安装阶段通过 `npm ci --omit=dev` 获取锁定版本；浏览器无需ws包。
3. 先一致性备份→迁移新表及索引→在隔离目录验证API包和依赖→部署API OFF→合并WS nginx配置→nginx -t→检查ready和接口→发布静态。
4. 打开3～10人双方白名单，至少3天；初始20房上限。检查奖币账、断线、弃权、旧玩法延迟，再扩大。无登录测试账号及Android实体机验证就不全量。
5. 静态Actions自动发布、API当前需人工运维；原 `deploy-release.sh` 是静态脚本，不拿它当API发布器。使用现有bootstrap流程前检查其停服／依赖安装权限，在运维手册写清执行用户、产物和检查点。

### 14.3 排空、紧急关闭、回滚

- 常规发布：持久化drain=true→禁止新challenge/accept/开局，已有playing继续→waiting_ready取消且未扣费→等待active=0（上限约16分钟）→备份→停API→部署→ready→恢复接单。
- 等待超时或严重故障：经管理员确认先系统作废＋退款所有活动局，确保账务成功且active=0，再停服。不要先关flag卸载路由而让钱卡在旧局。
- 意外退出：新服务启动执行§5.5恢复，即使flag OFF；回到**不认识PvP表的旧API**前，必须用新版清账工具处理活动局并验证active=0。
- API回滚保留新表与数据，不回滚业务数据库；恢复旧server与shared后重装旧lockfile依赖再启动。当前rollback-api脚本只有依赖注释、没有实际npm ci，且rsync --delete会影响node_modules：修复并实测是上线阻断项。
- 已终局的历史与奖币不回滚。灾难备份恢复走现有tombstone、会话撤销，再处理旧playing退款；在隔离副本检查ledger一致性后才开放。
- 发布成功标准是HTTP/WS、两账号短局、奖励、历史、旧单人玩法与回滚报告均通过，不只是systemd显示running。

## 15. 工作包、交付物与完成定义

按1名熟悉项目的全栈主开发估算，约26～35人日；可由前后端两人并行但总量不简单减半。测试、运维和设计资源需明确安排，不隐含为开发者“顺手做”。

| 阶段 | 内容／产物 | 主责与依赖 | 人日 |
|---|---|---|---:|
| M0 基线与规则合同 | 对齐SHA、工作区归属、字段契约、R01～R08固定样例、端口/机器确认 | 主开发＋运维；先于页面 | 2～3 |
| M1 持久化与账务 | migration、active_members、挑战与准备、ledger唯一、终局纯服务、故障注入 | 后端；依赖M0 | 5～6 |
| M2 实时房间 | WS ticket/通知、REST动作、timer巡检、有限DTO、降级、缺席、恢复 | 后端＋前端；依赖M1 | 5～7 |
| M3 用户界面 | 大厅/准备/房间/基础结果、响应式、草稿隔离、状态错误 | 前端；可在M1接口冻结后mock并行 | 4～5 |
| M4 档案与治理 | Elo、历史、基础复盘、屏蔽、举报后台、隐私删除 | 全栈；依赖M2终局契约 | 4～5 |
| M5 生产工程 | Linux同规格压测、Android QA、备份退款恢复、反代、依赖打包回滚、白名单 | QA＋运维＋主开发 | 6～9 |

所需非代码资源：至少2个互不共享会话的预发布测试账号、额外若干灰度用户；Android WebView设备＋桌面浏览器；同规格预发布主机与独立数据库；SSH／nginx/systemd操作责任人；备份位置与恢复空间；测试用充币只能在预发布或受审计测试账户，不改生产普通用户余额。

验收资料必须包含：规则／DTO合同、数据库迁移、自动测试结果、事务故障注入记录、账户与币对账、压力测试机器规格／原始指标、截图或录屏、发布与恢复操作记录（命令、输出、退出状态）。

**完成定义：** 功能默认OFF可正常启动；全部P0用例通过；任何一局的动作、揭示、资金和评分可解释且可重放；陌生用户读不到私有局；没有未来bar或锁定结果泄露；系统失败只系统退款而非误判玩家；旧玩法与当前未提交认证工作经过整合回归；发布／回滚不留挂账。未达到这些条件，不能以“大厅和K线画出来了”判定完成。

### 15.1 后续变更控制

优先缩减复盘装饰、分享图、段位动画，不删原子结算／信息隔离／断网恢复。经济规则、截止策略、Elo或日序变化必须提升pvpVersion或economy/ratingVersion，补测试与迁移说明。本文资源额度与工期是规划值，只有压测与实际迭代报告才算验证结果。

## 16. 评审交付与限制

本轮已完成：线上只读产品探查、版本与公开配置核验、对应Git源码核对、三个固定样例实验、文档重写与结构校验。未实现PvP、未修改业务代码、未更新生产、未实测房间容量。

审查材料：原稿 `docs/reviews/pvp-battle-2026-10-11/original.md`；修订diff `changes.patch`；验证记录 `verification.json`；可运行的文档还原工具 `rollback.py`（仅还原这份文档并校验摘要）。这些是本次文档变更证据，不是PvP已通过验收的报告。

开工第一项：**在确认的最新main建立开发分支，先写R02局中净值、R06/R07信息隔离、C02房间互斥、E01/E02双人资金幂等测试，再实现大厅。**
