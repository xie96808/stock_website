# 手绘控件全量重做：产品调研与开发规格

> 版本：v1.2 · 2026-10-12（Asia/Shanghai）  
> 状态：**仅文档 / 未实现 UI**。本文件指导绘图 Bot 出图与后续前端实施；**禁止**在本 PR 内改控件实现。  
> 产品：`stockgame.xieyw.top`（股市模拟盘小游戏）· 仓库 `/workspace/stock_website`  
> 依据：`index.html` + `css/*` + `js/auth.js` / `feedback.js` / `pvp/*` 实盘点；既有 `docs/pvp-battle-design.md`、纸墨 tokens（`css/base.css`）；News Bot 竞品素材（精炼并入 §3）；REA Bot 逆向摘要（并入 §3.7 / §4.1 / §6）；公开网页检索（真实链接，不编造评测）。

---

## 0. 执行摘要（给 Bill / 父代理）

| 项 | 结论 |
|---|---|
| 病根 | 多数控件是「纸墨皮肤的原生 button/input」：系统字体区过大、缺统一 press→release、无读条/冷却/错误抖动仪式感；布局仍像表单/后台。PvP 底栏已有手绘切片雏形（`assets/pvp/btn-*.png`），但全局未成体系。 |
| 方向 | **全控件手绘定制**（禁止默认 textbox/button 观感）+ **WoW 式点击反馈系统** + 楷体/硬阴影/不规则 hit 区。 |
| Top 10 优先重绘 | ①买卖主按钮 ②观望/保持 ③消息气泡键 ④准备/取消准备 ⑤匹配/约战行按钮 ⑥离开/退出确认三键 ⑦登录主 CTA ⑧自定义输入框 ⑨加载/开局读条 ⑩Toast |
| REA 优先逆向 | 坐庄风云(itch) → Drawably → Wired Elements → Papercuts → 252（补充）/ 最强富翁(若可) |
| 跨站硬规则 | 见 §4.1「跨站 10 条」：120ms 内物理按下、loading 不换控件、虚实线语义、主循环唯一高亮等 |
| 静态换皮预算 | 线上可换皮静态约 **4.2M**（images≈3.5M / css≈244–412K / assets/pvp≈280K）；**无 sprite**；重绘重点 `assets/pvp` + `images` 品牌 + avatars + `game`/`pvp` CSS |
| 下一步 | 绘图 Bot 按附录 brief 出状态帧 → P0 全局 press（可无新图）→ 换 `assets/pvp` 切片 → P2 输入壳；子屏过渡见 **§6.4** |

---

## 1. 背景与问题诊断

### 1.1 产品气质目标

站点视觉已声明「手绘 notebook」：`--paper` / `--ink` / `--kaiti` / 硬阴影 `--shadow-nudge` / 不规则圆角 `--radius-card`（见 `css/base.css`）。玩法是轻竞技模拟盘 + PvP，应让每次点击像**盖章、落笔、按技能键**，而不是填后台表单。

### 1.2 「AI 味 / 机械感」从何而来（代码事实）

| 来源 | 证据 | 玩家感受 |
|---|---|---|
| 系统控件骨架 | `auth-form input` 为 `border-radius:8px` + 白底原生框；指标面板 `input[type=checkbox]` 仅改 `accent-color`；举报区原生 `select`/`textarea` | 一眼认出「网页默认表单」 |
| 字体分裂 | `body` 用 `--sans`（系统 UI 字体）；楷体多用于标题/部分按钮，输入区与大量正文仍是无衬线 | 「标题手绘、控件办公软件」割裂 |
| 缺统一 press 态 | `.lane:active`、`.pvp-sketch-ctl:active`、`.fill-mode-btn:active` 有位移；**`.action-btn` 无 `:active`**；**`.pvp-btn` 无 `:active`** | 单人买卖键「点了没动静」；大厅按钮发飘 |
| 反馈只有 CSS 淡入 | Toast（`auth-toast`）做 opacity/translate；busy 只改文案+opacity；加载多为「大厅加载中…」纯文字 | 无施法条、无冷却转圈、无错误红闪抖动 |
| 布局像目录/表单 | 首页 lanes 已像卡片；但登录/反馈/设置/举报仍是 label+input 垂直堆叠 | 像管理后台而非游戏 HUD |
| 音画未绑定 | 无统一 click SFX / 成功叮 / 错误 Buzz；礼物有动画，常规 CTA 无 | 静默机械 |

### 1.3 已有正确雏形（应扩展，勿推倒）

- PvP 交易条：`pvp-sketch-ctl` + `assets/pvp/btn-{buy,sell,hold,message}.png`（约 190×80 / 80×80），含 hover/active 硬阴影位移。
- 纸墨 tokens、日夜主题、部分 lane `:active` 已示范「按下阴影收紧」。
- `setBusy()`（`js/auth.js`）证明团队已知「网络 RTT 下要点击即时感」——缺的是**视觉层仪式**，不是业务钩子。

---

## 2. 现状控件清单

> 盘点范围：`index.html` 静态节点 + `js/auth.js` / `feedback.js` / `announcements.js` 动态注入。问题等级：P0 立刻伤害手感 · P1 核心玩法 · P2 表单/设置 · P3 抛光。

### 2.1 总表（按场景）

| 控件 ID / 类 | 位置 | 现状实现 | 问题等级 |
|---|---|---|---|
| `#buyBtn` `.action-btn.buy` | 单人局底栏 | CSS 色块按钮，楷体字；**无 `:active`** | **P0** |
| `#sellBtn` `.action-btn.sell` | 同上 | 同上 | **P0** |
| `#holdBtn` `.action-btn.hold` | 同上 | 同上；观望是高频键 | **P0** |
| `#fastForwardBtn` / `#finishBtn` / `#rewindBtn` | 同上 | 色块；反悔有图标 span | P1 |
| `#pvpTradePrimary` + img | PvP 底栏 | 手绘 PNG + 标签叠字；有 `:active` | P1（需完整状态帧） |
| `#pvpHold` | PvP 底栏 | 同上 | P1 |
| `#pvpMsgOpen` | PvP 底栏 | 图标 PNG；消息列表 `.pvp-msg-line` 仍偏扁平按钮 | P1 |
| `#pvpBuy` `#pvpSell`（hidden） | 兼容隐藏 | 逻辑保留 | — |
| `#pvpReadyBtn` / `#pvpCancelReadyBtn` | 房间准备 | `.pvp-btn` **无 `:active`** | **P0** |
| `#pvpRoomLeave` + `#pvpLeaveDialog` 三键 | 退出确认 | 对话框 + 扁平按钮 | **P0** |
| 大厅约战行按钮（JS 渲染于 `#pvpLobbyList`） | 匹配 | 动态 `.pvp-btn` | **P0** |
| `#pvpInviteAccept/Decline/Ignore` | 约战弹窗 | 扁平 | P1 |
| `#pvpLobbyLoading` / `#fillModeLoadingPane` | 等待 | 纯文案 / 简单 loading pane | **P0** |
| `.lane` 系列（模拟盘/玩法/残局入口） | 首页导航 | 卡片按钮，有 `:active` | P2（可换手绘边框切片） |
| `#authLoginBtn` / `.auth-primary` | 登录 CTA | 圆角 pill + 硬阴影；busy 改字 | **P0** |
| `#auth*Form` inputs | 登录/注册/设置 | **原生 text/password** | **P0** |
| `.auth-check` checkbox / 生肖骰子 | 注册 | 原生 checkbox；骰子 emoji 按钮 | P2 |
| `#authUserBtn` + `#authAvatarImg` | 顶栏头像 | 圆图+昵称 | P2 |
| `#feedbackBody` textarea + 附件 | 反馈弹窗 | 原生 textarea | P2 |
| `#pvpReportReason` select / `#pvpReportDetail` | 结果页举报 | 原生 select/textarea | P2 |
| 纸/墨 `.pill`、缩放步进 | 顶栏 | 小 pill；无完整 press 体系 | P2 |
| `#announcementsBtn` + 公告弹窗按钮 | 顶栏 | 文字按钮 | P2 |
| Toast `#authToastHost` | 全局 | 色条 fade | P1 |
| 指标 checkbox / `#indicatorsToggle` | 局内 | 原生 checkbox | P2 |
| 悔棋局 `#hindsightStockInput` 等 | 悔棋 | 原生 text/date/number | P2 |
| Fill mode radio + `#fillModeConfirmBtn` | 开局模态 | radio 原生；确认钮有 `:active` | P1 |
| 结算/礼物 `.pvp-gift-send` | 结果 | emoji+文字按钮；礼物已有入场动画 | P3 |
| 座位头像 `#pvpSeat*Avatar` + 准备勾 | 房间 HUD | img + mark | P1 |
| 消息气泡 `#pvpTauntBubble*` | 房间 | 有显隐 | P1 |
| Quiz / 日挑战 / 残局结算模态按钮 | 多处 | `.jiu-coin-*` / `.quiz-*` | P2 |
| 排行榜/战绩列表行 | 列表 | 偏表格 | P3 |

### 2.2 结构性结论

1. **交互主路径（买卖/准备/离开/登录/加载）仍未手绘化或未统一 press。**  
2. **输入类 100% 原生** → 必须自定义外壳（真实 `<input>` 可隐藏在自定义 hit 下以保留无障碍与 Android WebView 输入法）。  
3. PvP 已迈出切片第一步 → 全站应收敛到同一「手绘控件设计系统」，避免「局内手绘、大厅网页」。

---

## 3. 竞品与灵感调研

> 方法：News Bot 产品清单 + 公开页核实链接。下列「可借鉴点」是设计层学习，**不是**玩法抄袭；同花顺模拟作为**刻意避开的一极**。

### 3.1 国内：模拟炒股 / 股票游戏 / 小程序

| 产品 | 链接 / 入口 | 可借鉴点 | 对本品态度 |
|---|---|---|---|
| **坐庄风云 · Pump & Dump Tycoon** | https://niushibuyanding.itch.io/pumpdumptycoon （及 2 / Plus） | 浏览器 HTML5、A 股规则玩具化、盘口/情绪叙事强；UI 是「游戏仪表」而非券商皮肤 | **强对标叙事与局内 HUD 密度**；REA 首选 |
| **最强富翁** | 微信小游戏（检索见 17yoo 等聚合页） | K 线低买高卖 +「韭菜逆袭」轻剧情；小程序控件节奏快 | 学**短决策按钮排版**与段位刺激；若可访问则 REA |
| **韭菜的逆袭** | Android 模拟经营（多镜像下载站，包名常见 `com.nchy.jcdnx`） | 炒股+经营混合、梗文化包装 | 学文案语气与成长感，UI 工业感勿照搬 |
| **A-ShareSenseTrainer（K线猜猜乐）** | https://github.com/EthanAlgoX/A-ShareSenseTrainer | 真实历史 K 线、梭哈 vs 空仓二元决策、称号梗 | 学**决策按钮极简**与结算称号仪式；视觉非纸质 |
| **252 虚拟股票人生** | https://252.sanglimsoft.com/zh/ | 证券 App 仿盘 + 人生模拟；时钟倍速、事件暂停 | 学「等待被事件打断」的节奏；**UI 偏真券商，正是我们要避开的** |
| **STONKS-9800** | https://store.steampowered.com/app/1539140/ | 复古终端/文本股感、生活资源条 | 学气质一致性（全身复古）；控件可参考 CRT 反馈密度 |
| **Pixel Trader** | https://store.steampowered.com/app/4962430/ （Coming soon） | 像素股市拟真 | 关注像素 hit 区与买卖反馈（上线后再评） |
| **同花顺模拟炒股** | http://moni.10jqka.com.cn/mnzt · App Store「同花顺模拟炒股」 | 超仿真委托/五档/大赛 | **对照负极**：越像真交易软件越摧毁「纸质小游戏」身份。可学的只有「关键操作路径短」，视觉与信息架构**禁止靠近** |

### 3.2 海外：paper trading / 股票游戏

| 产品 | 链接 | 可借鉴点 |
|---|---|---|
| **Papercuts Trading** | https://papercutstrading.com/ · Scorekeeper https://papercutstrading.com/scorekeeper/ | **纸质卡牌**把买卖/事件做成物理牌面；色盲友好（蓝涨黄跌等约定）；计分器网页可看状态机 | 
| **Paper Trader Arena** | 作品集 https://www.dennisdeng.com/works-paper-trader-arena.html | 锦标赛 + 清晰买卖票；卡片分区降认知负荷 |
| **Paper Trader: Stock Game** | App Store id6762571753 | 社交纸交易、快速下单 sheet、周榜阶梯 | 
| **PlayVest / StockUp** | （News Bot 点名；公开页多为教育/入门纸交易向） | 新手两步内完成下单；教学提示不打断主按钮 |
| **StockPe** | https://stockpe.app/ | 锦标赛选组合、排行反馈强；偏 fantasy，学竞争循环而非盘口 UI |
| **CandleCrush** | https://github.com/Nexus-SIT/CandleCrush | Buy/Sell/Hold 快节奏挑战 + 段位；导师角色可映射到本品吉祥物 |
| **Bulls & Bears**（课堂模拟） | ABSEL 文献等 | 新闻/谣言驱动供给需求；学「事件条」信息设计，非视觉 |

另：TradingView Paper / Webull paperTrade / thinkorswim paperMoney 属**专业仿真极**，与同花顺同类——只借「图表旁下单」的效率，不借皮肤。

### 3.3 非金融：手绘 / 纸质控件标本

| 来源 | 链接 | 可借鉴点 |
|---|---|---|
| **念念手帐** | App Store id1512075713 | 全界面手绘卡通、贴纸/胶带装饰、治愈不「办公」 |
| **Drawably** | https://www.drawably.dev/ · GitHub 生态 | **每次 mount 重绘笔触**；hover/press 可再 sketch；保留真实 DOM 控件做 a11y — 与我们「外壳手绘、内核原生」策略一致 |
| **Wired Elements** | https://wiredjs.com/ · https://github.com/rough-stuff/wired-elements | Rough.js 不规则描边 button/input/checkbox；可作技术原型参考（量产建议预渲染 PNG/WebP，避免 WebView 抖动性能坑） |
| **Excalidraw「手绘 DNA」** | excalidraw.com / 设计 token 讨论 | Virgil 手写感、晃线矩形、协作光标；证明「不完美线宽」可成品牌 |
| **Forest** | 专注种树 App | 开始/停止状态极端清晰；等待即「生长」隐喻 → 映射匹配读条 |
| **Duolingo 立体按钮** | 公开设计系统摘要（如底部 4px 实心阴影、按下位移消阴影） | **Press = 物理下沉**：与 WoW/本品硬阴影同构 |
| **Sketchy UI Kit**（各类 Figma sketch kit） | 设计社区常见 kit | 批量出不规则组件；注意勿直接商用未授权资源 |

### 3.4 趋势（2025–2026）

- **NN/g《Handmade Designs: The New Trust Signal》**（https://www.nngroup.com/articles/handmade-designs/）：手作视觉可增强温暖与信任，但必须与产品能力一致，且不能牺牲可用性。  
- **Naive / 不完美 UI**：刻意歪线、纸纹、错位阴影；避免「AI 光滑渐变 + 完美圆角」。  
- **Drawably 交互标本**：手绘不是贴图静止，而是 **hover/press 时笔触再响应**。

### 3.5 最值得抄的 5 点 → 写入设计原则

1. **物理按压可供性**（Duolingo / WoW）：可见的厚底阴影 + 按下位移，松手回弹。  
2. **手绘是行为不是皮肤**（Drawably / Wired）：状态切换要带动笔触/阴影变化，禁止只换 CSS 背景色。  
3. **决策三键绝对主导**（A-ShareSenseTrainer / CandleCrush / 本品 PvP）：Buy / Sell / Hold 占拇指区，次要功能收进气泡。  
4. **纸质隐喻贯彻**（Papercuts / 念念手帐 / 本品 notebook tokens）：卡片、印章、胶带、笔记线，拒绝券商玻璃拟态。  
5. **等待可玩可感**（Forest / 坐庄风云盘口节奏）：匹配/加载用读条、生长或盖章动画，禁止纯「加载中…」文字。

### 3.6 REA Bot 建议逆向清单（优先序）

| 优先级 | 目标 | URL | 学什么（截图/动效关注点） |
|---|---|---|---|
| 1 | **坐庄风云** | https://niushibuyanding.itch.io/pumpdumptycoon | 局内按钮排布、盘口旁 CTA、待机/事件反馈、移动端点按 |
| 2 | **Drawably** | https://www.drawably.dev/ | 按钮/输入/开关的 sketch 再生、press 重绘、boil 开关 |
| 3 | **Wired Elements** | https://wiredjs.com/ | 全套 sketch 控件形态；评估哪些可预渲染 |
| 4 | **Papercuts Trading** | https://papercutstrading.com/ + scorekeeper | 卡牌级买卖符号、计分状态、色盲色约定 |
| 5 | **最强富翁** | 微信小游戏（需真机） | 小程序买卖键尺寸、结算弹窗、段位亮相 |
| 备选 | 252、STONKS-9800、念念手帐、Duolingo（任意一课） | 见上表 | 反例（252 仿券商）与正例（立体键、手帐装饰） |

### 3.7 REA Bot 逆向灵感（已跑标本，精炼）

> 来源：REA Bot 对优先目标的实机/页面逆向。下列为**可迁移交互与视觉手法**，非玩法抄袭。

#### 坐庄风云（itch HTML5）

| 观察 | 迁移到本品 |
|---|---|
| **主按钮唯一高亮**：同一时刻只有一个主 CTA 拉满对比，其余降权 | 大厅「约战」、房间「准备」、局内当前可点的买/卖主键 — 同时只强调一个 |
| **倍速胶囊**：小胶囊分段，描边清晰 | 快进/`fill` 相关用分段胶囊，不要做成原生 select |
| **买卖大色块**：红绿大色域，拇指可达 | 强化 `#buyBtn/#sellBtn` 与 PvP primary 的色块面积（已有方向，补 press 态） |
| **仓位快选**：1/4、半仓等快捷 | 单人若未来加仓位；PvP 全仓规则下可映射为「确认条上的费用/扣币摘要快选信息」而非半仓 |
| **飘字事件**：成交/新闻向上飘 | 锁定成功、对手已锁定、礼物、Toast 盖章可共用飘字层 |
| **侧栏压暗**：焦点在主操作时侧栏 dim | 打开消息列表/离开确认时，图表与非相关 CTA `opacity` 压到 ~0.45 |
| **分段控件描边**：segmented control 外框手绘描边 | 纸/墨、成交方式、缩放预设 → 统一「手绘分段条」 |

#### Drawably（https://www.drawably.dev/）

| 观察 | 迁移到本品 |
|---|---|
| 抖动边框可重绘；每次 mount 可新笔触 | 量产用**预渲染多 seed 切片**轮换，避免 WebView 运行时重绘 |
| hover 重画 +1px 描边 | hover：描边略加粗或换 `*-hover` 帧，不要只变背景 |
| press 下沉 + 描边约 1.4× | 与 WoW press 叠加：位移 2px + 线宽视觉加粗 |
| **沸腾（boil）loading** | loading 用笔触微沸或砂轮帧循环；**禁止换成另一个控件类型** |
| success/error 换墨色 | 成功换青/朱印墨，失败红墨；不用系统 `alert()` |
| `prefers-reduced-motion` | boil/抖动关掉，保留 press 位移 |

#### Wired Elements（wiredjs.com）

| 观察 | 迁移到本品 |
|---|---|
| 多线叠边、线条过冲 | 切片外轮廓允许双线/毛刺过冲 1–2px |
| elevation 1–5，按下降低 | 映射硬阴影档位：default=3、hover=4、press=1、disabled=0 |
| 草图 spinner | 加载用铅笔圈/砂漏素描，不用 CSS 系统环 |
| 马克笔 Tab | auth 登录/注册 Tab 做成马克笔涂抹标签 |

#### Papercuts Trading

| 观察 | 迁移到本品 |
|---|---|
| 双线描边卡牌 | 模态壳、lane 卡、Toast 用双线墨边 |
| **虚线=预览 / 实线=成交** | 提交中/未锁定：虚线框；服务器确认锁定/成交：实线戳记 |
| 掀牌倾斜 | 结果结算卡、邀请函可 3–6° 掀入 |
| **色=方向** | 买入/涨/成功偏朱；卖出/跌偏绿（A 股习惯，与现 tokens 一致）；消息中性墨 |

#### 252 虚拟股票人生

| 观察 | 迁移到本品 |
|---|---|
| 顶栏**回合时钟**极醒目 | 强化 `#pvpClock` / 准备钟：大楷体数字 + 手绘钟框（勿做成 iOS 计时器） |
| **底 sheet 下单** + % 快选 + 费用展示 | 开局扣币确认、反悔确认、Fill mode → 统一底 sheet：摘要 + 主按钮 + 次要取消 |
| **危机打断 sheet** | 断线、资格不足、认输确认、日限额 → 高优先级 sheet 压过普通弹窗 |

### 3.8 跨站可迁移结论（一句话）

游戏化股市 UI 的手感来自：**唯一高亮的主循环键 + 120ms 内物理按下 + 虚实线区分意图/成交 + 等待时控件不变形只换态 + 危机用专用 sheet**——与券商仿真（同花顺/252 的仿盘外壳）划清界限，只借其信息架构效率。


---

## 4. 设计原则

### 4.1 跨站 10 条（硬规范，验收必测）

> REA 跨标本归纳。违反任一条 = 仍算「假/AI 味」或机械感。

| # | 规则 | 落地 |
|---|---|---|
| 1 | **草图壳与数据层分离** | 手绘 PNG/SVG 只负责外壳与状态帧；价格、倒计时、昵称、收益等由 DOM 文字层叠加（楷体/等宽），禁止把易变数字烤进位图 |
| 2 | **120ms 内物理按下** | `pointerdown` 后 ≤120ms 出现 press 位移/压暗（目标 70ms）；不等网络返回 |
| 3 | **loading 不换控件** | busy 时保留同一按钮尺寸与壳，只叠加读条/沸腾/砂轮；禁止换成 Progress 组件或变身另一形态 |
| 4 | **成败换色，不系统 Alert** | success/error 用换墨、戳记、shake、Toast 墨印；禁用 `window.alert/confirm` |
| 5 | **买卖色系写死** | 买/涨/阳性 = `--gain-color` 朱；卖/跌/阴性 = `--loss-color` 绿；中性操作（观望/消息）= 纸面墨；主题切换不得反转红绿语义 |
| 6 | **主循环唯一高亮** | 任一界面同时只有一个「主循环 CTA」满高亮（约战 / 准备 / 当前可买或可卖主键）；其余 secondary |
| 7 | **底 sheet + %/摘要快选** | 涉及扣费、反悔、成交方式、认输的确认，优先底向上 sheet：费用摘要 + 主确认 + 取消 |
| 8 | **危机打断** | 断线、限额、资格、强制结算等用最高 z-index 危机 sheet，可打断普通弹窗与消息列表 |
| 9 | **虚实线语义** | 虚线 = 意图中/预览/未确认；实线 = 已成交/已锁定/已保存 |
| 10 | **`prefers-reduced-motion`** | 关闭 boil、无限旋转、掀牌循环、烟花；**保留** press 位移与状态换色（反馈不可删） |

### 4.2 品牌与造型原则

1. **纸质手绘**：所有可点击物看起来像印在牛皮纸/笔记纸上的印章或剪贴——有纸纹、毛边、轻微歪斜；禁止完美 8px 系统圆角矩形作为最终观感。  
2. **楷体优先**：按钮标签、关键 CTA、座位名用 `--kaiti`；等宽仅用于价格/时间；禁止在主 CTA 上堆系统 Sans。  
3. **硬阴影（Hard shadow）**：默认 `Npx Npx 0 var(--line)`；hover 阴影变大/错位；press 阴影收束并 `translate(1px,1px)`（或 2px）。禁止大面积软模糊阴影冒充「高级」。  
4. **禁止原生 form 观感**：用户不应看出 textbox/select/checkbox 的 OS 皮肤。技术上可保留无障碍原生控件，但必须被手绘外壳完全覆盖。  
5. **全自定义 hit 区**：热区 ≥ 视觉块；不规则 PNG 用透明像素 + 足够 padding；禁用过小的「文字链接式」点击。  
6. **（抄 #1）物理按压**：任何可点控件具备 default → hover → press → release；禁用「只有 hover 变色」。  
7. **（抄 #2）状态驱动笔触**：disabled/loading/success/error 必须换切片或叠加手绘层，不只改 opacity。  
8. **（抄 #3）三键拇指法则**：对战/单人决策区 Buy·Sell·Hold（或主操作+保持）永远最大、最低、最稳。  
9. **（抄 #4）隐喻一致**：弹窗=便签/信封；Toast=墨印；加载=盖章读条或砂漏素描；匹配=信封飞行/骰子。  
10. **（抄 #5）等待仪式感**：>300ms 的等待一律进入 loading 态（读条或循环帧），可打断规则写清。  
11. **日夜双肤**：纸/墨两套切片或 CSS 可着色遮罩；对比度达标。  
12. **减弱动效**：尊重 `prefers-reduced-motion`：保留 press 位移（可达性反馈），取消循环抖动/烟花/boil。

---

## 5. 全量重做控件规格

> 通用状态机（除非注明）：`default | hover | press | disabled | loading | success | error`。  
> 资源命名建议：`ctl-<name>-<state>@1x.png` / `@2x.webp`。  
> 尺寸按 **CSS CSS px**；@2x 出图。

### 5.0 共享原子

| 原子 | 规格 |
|---|---|
| **Press 位移** | 按下 `translate(2px, 2px)`，阴影从 `3px 3px 0` → `1px 1px 0`；时长 60–80ms linear；松开 100–120ms ease-out 回弹 |
| **Hit 最小** | 移动 ≥ 44×44；主买卖 ≥ 56×72（竖）或 160×56（横胶囊） |
| **标签区** | 居中楷体；主色 `--ink`；禁 emoji 充当唯一语义（可作装饰） |
| **图标区** | 左侧或上方 24–32px 手绘图标；与文字间距 8px |
| **Focus** | 手绘环：`0 0 0 2px var(--paper), 0 0 0 4px var(--line)`，不靠浏览器默认 outline |

### 5.1 控件逐项

#### A. 单人局交易键 `#buyBtn` / `#sellBtn` / `#holdBtn`

- **结构**：`button.ctl-trade` > `img.chrome` + `span.label`（可选 `span.icon`）  
- **尺寸**：横条模式各约 31% 宽 × 52–56px；或与 PvP 对齐 190×80 切片缩放  
- **状态**：default/hover/press/disabled；买入成功短暂 success 红印闪 200ms；非法点击 error 抖动  
- **切片**：buy/sell/hold × 至少 default+press+disabled（hover 可用 CSS 阴影模拟以减包体）  
- **文案**：「买入」「卖出」「观望」

#### B. PvP 主操作 `#pvpTradePrimary` / `#pvpHold` / `#pvpMsgOpen`

- **结构**：已有 `pvp-sketch-ctl`；扩展状态帧（locked / cooling / submitting）  
- **尺寸**：主 190×80；消息 80×80  
- **状态**：增加 `loading`（提交中砂轮或墨点旋转）、`locked`（已锁定灰化+小锁图标）  
- **切片**：在现有 4 PNG 上补 press/disabled/locked；买卖切换时 crossfade ≤150ms

#### C. 准备 / 取消 `#pvpReadyBtn` `#pvpCancelReadyBtn`

- **结构**：印章形大按钮；准备=朱文印，取消=白文/虚线印  
- **尺寸**：140×56  
- **状态**：default/press/disabled；准备成功后按钮区切「已准备」success 戳记  
- **资源**：`ctl-ready-*.png`、`ctl-unready-*.png`

#### D. 匹配 / 约战行（大厅列表）

- **结构**：对手行 = 头像框（手绘）+ 昵称楷体 + CTA「约战」小印章  
- **尺寸**：行高 64–72；CTA 96×40  
- **状态**：CTA：default/press/loading（发出约战）/disabled（不可约）  
- **等待**：出战邀請後行内微型读条

#### E. 离开与退出确认

- **触发**：`#pvpRoomLeave`  
- **弹窗**：便签纸对话框（非系统 alert）  
- **三键**：留下（主）、回大厅（次）、认输（危险描边）  
- **尺寸**：主按钮 120×48；危险键需长按 400ms 或二次确认微动效防误触（产品可选）  
- **状态**：完整 press；打开/关闭 180ms 纸片滑入

#### F. 登录主 CTA / Tab / 关闭

- **结构**：自定义面板；Tab 为撕纸标签；主 CTA 大手绘键  
- **输入**：见 G  
- **状态**：CTA loading=读条盖在按钮上（保留宽度防抖）

#### G. 自定义输入框（登录、昵称、签名、反馈、悔棋、举报）

- **结构**：外框 PNG（笔记线/墨边）+ 内部透明 `input`/`textarea`（opacity/caret 可见）  
- **尺寸**：高 44–48；多行 min 120  
- **状态**：default/focus（墨线加粗）/error（红墨抖动）/disabled  
- **禁止**：暴露 OS 白底圆角；Android WebView 需测 caret 与 scroll

#### H. 开关 / Checkbox / 纸墨切换

- **纸/墨**：双印章互斥；按下切换带 120ms 翻面或墨扩散  
- **指标 checkbox**：手绘方框 + 勾叉笔画动画（120ms）  
- **Fill mode radio**：手绘圆点印泥

#### I. 头像与座位

- **框**：手绘圆/方框；准备勾为朱笔勾  
- **尺寸**：座位 36–44；结果 44；邀请 64  
- **状态**：ready 勾 pop（已有 `pvp-check-pop` 可保留并统一）

#### J. 底栏消息 / 气泡

- **打开键**：80×80  
- **列表项**：手绘对话框条；press 下沉  
- **发出**：气泡从座位弹出（已有 taunt bubble）+ 纸片声（可选）

#### K. 加载 / 匹配等待

- **开局**：`fillModeLoadingPane` → 手绘砂漏或「开盘铃」读条 0–100%（不确定时用不确定循环点）  
- **大厅**：骨架屏用铅笔线，不用灰色 CSS pulse  
- **匹配**：信封飞行循环 / 对坐剪影呼吸

#### L. Toast

- **结构**：墨印长条或裱纸；success 绿印、error 朱印  
- **动效**：盖章下落 200ms + 停留 2.2s + 揭起 180ms  
- **禁止**：仅改背景色的系统 snackbar 感

#### M. 模态壳（auth / feedback / announcements / jiu-coin / rewind / invite / win）

- **统一**：毛边纸对话框 + 手绘 × 关闭 + 遮罩为半透墨而非纯黑  
- **按钮**：主/次/危险三式样复用原子

#### N. 其它 CTA

- 反悔、快进、结束结算、分享、举報、礼物：全部纳入同一原子按钮族（primary/secondary/ghost/danger），仅换图标切片。

---

## 6. 交互动画规范（魔兽世界参考 + REA 跨站规则）

> 与 §4.1 同时生效：WoW 提供「技能键手感」隐喻；REA 提供「草图控件状态机」细则。

### 6.0 全局状态机（所有可点控件）

```
default → hover → press ──► release → default
                 └──────► loading → success → default
                                 └→ error → default
disabled（任意时刻可进入，忽略指针）
```

- **press 必须在 120ms 内**（§4.1-2），即使随后立即 loading。  
- loading **不得更换控件类型**（§4.1-3）；用伪元素/子层 cast bar 或 boil 帧。  
- success/error 用换墨或短闪，**禁止**系统 Alert（§4.1-4）。  
- 意图未确认时外壳描边用**虚线**，服务器确认后改**实线**（§4.1-9）。

### 6.1 WoW 机制 → 可迁移语义

| WoW | 语义 | 本品映射 |
|---|---|---|
| 技能键按下变暗/内缩 | 确认「已吃到输入」 | 一切可点控件 press |
| 松开回弹 | 未进入 CD 则恢复 | release；若进入 loading 则停在 press 暗态 |
| 施法条 Cast bar | 引导中、可打断 | 匹配等待、开局加载、提交锁定 |
| 冷却转圈 / 灰化 | 暂时不可用 | 已锁定回合、约战 CD、busy |
| 错误抖动 / 红闪 | 非法操作 | 无仓卖出、资格不足、表单校验失败 |
| 成功高亮 / 闪光 | 生效 | 准备完成、成交、登录成功、领韭币 |
| 进战/脱战音画 | 场景切换 | 进入房间 / 回大厅 |

参考生态（理解反馈密度，非要嵌入插件）：BetterButtonAssistant 的 press pop + cooldown swipe；NugKeyFeedback 的 expanding-ring；Blizzard CastingBar 的 interrupt shake。

### 6.2 映射表（产品具体）

| 交互 | 动画 | 时序 (ms) | 缓动 | 可打断 |
|---|---|---|---|---|
| 任意控件 press | 位移+阴影收+亮度 -12% | down 70 / up 110 | linear / ease-out | 是（pointercancel 立刻回） |
| 买卖/保持提交 | press 后进入 loading 砂轮；成功 success 闪；失败 error 抖 | load 至响应；flash 200；shake 320 | ease | 否（防双击）；超时可重试 |
| 匹配/约战等待 | 行内或全屏 cast bar | 不确定循环 900/圈 | linear | 是（取消约战） |
| 开局加载 | 模态读条 + 标签「开盘…」 | 真实进度或 1.2s 最小展示 | ease-in-out | 否（取消走取消按钮） |
| 退出确认打开 | 纸片滑入+淡入（归并 **§6.4** 模态：220–280ms） | 220–280 | cubic-bezier(.2,.8,.2,1) | 是（点遮罩=留下） |
| 消息气泡 | scale 0.85→1 + 上浮 | 200 | cubic-bezier(.2,.8,.2,1) | 是 |
| Toast 盖章 | 下落盖印 | 200 in / 2200 hold / 180 out | ease | 是（点消失） |
| 错误 | X 轴 ±4px 抖动 4 次 + 红墨闪 | 320 | ease-in-out | — |
| 成功准备勾 | pop scale | 320（已有可对齐） | ease | — |
| 侧栏/背景压暗（坐庄风云） | 非焦点区 opacity→0.45 | 160 | ease | 随弹层开关 |
| 虚线→实线确认（Papercuts） | stroke-dash → solid + 印泥闪 | 180 | ease | — |
| 沸腾 loading（Drawably） | 描边微扰动循环或 3 帧 sprite | 900/圈 | linear | reduced-motion 关 |
| elevation 降档（Wired） | 硬阴影 3→1 + 下沉 2px | 70 | linear | 随 press |
| 危机 sheet（252） | 自底上推+遮罩（细则 **§6.4** sheet） | 240–280 | cubic-bezier(.2,.8,.2,1) | 仅危机解除/主按钮 |
| 飘字事件（坐庄风云） | 自锚点上飘 36px 淡出 | 700 | ease-out | — |

### 6.3 减弱动效

```css
@media (prefers-reduced-motion: reduce) {
  /* 保留 press 位移与状态色；停用 shake loop、烟花、boil、无限旋转 */
}
```

### 6.4 子屏 / 面板进出场（Silky Screen Transitions）

> Bill 要求：点击控件打开子屏/子 UI 时，也要有魔兽世界式丝滑过渡。本节与 §5.0 Press、§6.2 映射表、§4.1-10 reduced-motion **同时生效**。  
> 范围：**模态叠层**、**底 sheet / 抽屉**、**全视图切换**（若已在本控件体系内）。**本 PR 仍只改文档，不实现前端。**

#### 6.4.1 适用面

| 类型 | 本品实例（非穷尽） | 壳隐喻 |
|---|---|---|
| **模态叠层（Modal overlay）** | 设置、对手资料、反馈、签名/昵称编辑、公告、登录/注册、约战邀请、离开确认、举報、韭币/Quiz 结算弹层 | 便签/信封浮在半透墨上 |
| **底 sheet / 抽屉** | 开局扣币确认、反悔确认、Fill mode、危机打断（断线/限额/资格）、消息列表（若做成上推条） | 纸卷自底掀起 |
| **全视图切换** | 大厅 → 房间、房间 → 结算、结算 → 大厅；单人局进出 | 整页纸翻面/淡墨擦拭（轻量，勿剧场过重） |

#### 6.4.2 时序与缓动（验收硬数）

| 阶段 | 时长 | 缓动 | 说明 |
|---|---|---|---|
| **控件 press** | ≤120ms（目标 70ms down） | linear / ease-out | 必须先吃到输入（§4.1-2）；**不得**被面板动画吞掉 |
| **press → 面板开始进场** | 0–80ms 衔接 | — | 推荐：**press 完成（或 pointerup）后再开面板**；若需更连：press 与面板重叠，但**总感知 ≤200–280ms**（按下到面板可读） |
| **模态 Enter** | **220–280ms** | `cubic-bezier(.2,.8,.2,1)`（WoW 式出弹后稳） | fade + scale：`opacity 0→1`，`scale(0.94→1)`；可选轻微 `translateY(8→0)` |
| **模态 Exit** | **180–220ms** | ease-in | 反向：`opacity 1→0`，`scale(1→0.96)`；勿拖泥带水 |
| **Sheet Enter** | **240–280ms** | `cubic-bezier(.2,.8,.2,1)` | 自底 `translateY(100%→0)` + 淡入；顶缘可带 3–6° 掀纸感（Papercuts） |
| **Sheet Exit** | **200–240ms** | ease-in | `translateY(0→100%)` + 淡出 |
| **全视图 Enter** | **280–320ms** | ease-in-out | 旧视图 `opacity→0`（可微 `translateX(±12px)`），新视图对向滑入+淡入；**禁止**整页硬切 |
| **全视图 Exit / 回退** | 同 Enter 或略短 240ms | ease-in-out | 方向与前进相反（大厅←房间） |
| **遮罩 Dim** | 与面板同进同出，**160–220ms** | ease | 半透墨（非纯黑）；目标背景/非焦点 CTA `opacity → ~0.45`（坐庄风云侧栏压暗） |
| **错开（stagger）** | 面板壳先 0ms，主 CTA/标题 +40–60ms | — | 壳先落定，内容轻跟；单层错开即可，忌长瀑布 |

#### 6.4.3 进场 / 退场编排（Choreography）

```
pointerdown → press 视觉（≤120ms）
    → pointerup / 确认触发
    → [可选 0–80ms] 控件 release 或保持 press-暗态（若随后 loading）
    → 遮罩 fade-in 与面板 enter 同步启动
    → 面板可读（焦点落入关闭键或主 CTA；滚动锁 body）
    → 关闭：面板 exit 与遮罩 fade-out 同步；结束后卸载 DOM / aria-hidden
```

- **Fade + Scale（默认模态）**：居中便签；`transform-origin: center`；硬阴影在 enter 末帧落到 default elevation（Wired 档位 3）。  
- **Slide（Sheet）**：`transform` 只动 `translateY`；宽度满栏或 max 520px 居中纸卷；顶部圆角/毛边用 `ctl-modal-paper` 9-slice。  
- **View swap**：只用 opacity + 小位移；**禁止** 3D flip 整页（WebView 掉帧）。结算卡可用既有 3–6° 掀入（§3.7 Papercuts），属卡面而非整路由。  
- **打开源控件**：面板开着时源按钮可停在 hover/secondary，勿连续 replay press。  
- **与 cast bar / loading 关系**：若点击后先请求再开面板，控件走 §6.0 loading；面板在数据就绪后 enter，仍遵守 200–280ms 总手感（可用骨架纸先 enter）。

#### 6.4.4 遮罩、层级与手势

| 项 | 规格 |
|---|---|
| **遮罩色** | 半透墨（如 `color-mix(in srgb, var(--ink) 45%, transparent)` 或等价）；纸/墨主题各测对比 |
| **z-index 阶梯** | 基座 HUD `<` 普通模态（设置/反馈/资料/签名/公告）`<` 邀请/离开确认 `<` **危机 sheet**（§4.1-8）`<` Toast 墨印 |
| **点击遮罩** | 默认可关（=取消/留下）；**危机 sheet / 强制确认**不可点遮罩关闭 |
| **焦点** | enter 末 `focus` 关闭键或主 CTA；exit 后焦点回源控件 |
| **滚动** | 面板打开锁背景 scroll；sheet 内独立滚 |
| **多模态** | 同时只允许一层普通模态；危机可盖在其上；关闭顺序 LIFO |

#### 6.4.5 `prefers-reduced-motion`

```css
@media (prefers-reduced-motion: reduce) {
  /* 子屏：取消 scale 弹与长距离 slide；改为 ≤120ms 透明度交叉淡入淡出 */
  /* 保留遮罩 dim 与 press 位移；全视图禁止位移，仅淡入 */
}
```

- reduced-motion 下：**总时长 ≤120ms** 交叉淡化；不要 280ms 弹性。  
- 仍须有明确进场/退场（不可瞬切导致迷失），但去掉 boil、掀纸循环、视差。

#### 6.4.6 与手绘控件 press 的防抖 / 防打架

1. **串行优先**：`press 动画完成 → 再触发面板 enter`（实现简单，手感清晰）。  
2. **并行上限**：若产品要「更连」，允许 press 与面板重叠，但 **pointerdown → 面板 opacity≥0.9 可读** 的体感预算 **≤200–280ms**。  
3. **禁止**：面板 CSS 的 `transform` 继承到仍在播 press 的按钮上（含 `filter`/`scale` 祖先）；面板挂在 `body` 传送门层。  
4. **禁止**：打开动画期间重复触发同一源按钮的 press 帧。  
5. **退出确认等已有 180ms 纸片滑入**（§6.2）：归并到本小节模态规格，统一到 **220–280ms enter**，避免多套时长。

#### 6.4.7 验收抽检（文档阶段清单，实施时打勾）

- [ ] 设置 / 反馈 / 签名 / 对手资料 / 离开确认：进场 fade+scale 或等价丝滑；退场不硬切。  
- [ ] 底 sheet（扣费/危机）：自底滑入 + dim；危机层级最高。  
- [ ] 大厅↔房间↔结算：有交叉淡入或轻滑，无闪白。  
- [ ] 从按下到面板可读 ≤280ms；press 本身 ≤120ms。  
- [ ] `prefers-reduced-motion: reduce` 下仅短淡化，无 scale/长滑。  
- [ ] 遮罩为半透墨；z-index 符合阶梯；焦点与滚动锁正确。

---

## 7. 动画与资源管线

### 7.1 线上可换皮静态盘点（约 4.2M 量级）

| 目录 | 约体积 | 角色 | 重绘优先级 |
|---|---|---|---|
| `images/` | **≈3.5M** | 品牌图、吉祥物、favicon、**avatars** | 高：avatars 框可叠加手绘框；吉祥物/品牌随视觉升级 |
| `css/` | **≈244–412K**（视打包/未压缩） | 纸墨 tokens、game/pvp/auth 布局 | 高：`game.css` / `pvp.css` / `auth.css` / `feedback.css` 接 press 系统 |
| `assets/pvp/` | **≈280K** | 已有 `btn-buy/sell/hold/message.png`、结算贴图、段位图标 | **最高**：控件切片主战场 |
| 其它 | 小 | — | — |

**现状：无 sprite 表。** 控件多为单帧 PNG 或纯 CSS。本轮允许引入「每控件横拼 sprite」或「同名多状态文件」；不要上巨型全站 atlas（WebView 解码与缓存不友好）。

### 7.2 技术选型

| 议题 | 建议 |
|---|---|
| 格式 | 静态态：WebP（PNG 备份透明）；小图标可 SVG 手绘描边；**避免**运行时 Rough.js / Drawably 全量 redraw（Android WebView 掉帧）— REA 结论用于**预渲染** |
| Sprite | 同控件多状态横拼 + `background-position`；或 `<img>` 切 src（状态 ≤4 时更简单） |
| 壳与数据分离 | 切片不含动态数字（§4.1-1）；CSS 叠 `.ctl-label` |
| 动画实现 | 优先 **CSS transform/opacity**；复杂时间线 **WAAPI**；Lottie 仅一次性仪式（开局/胜利），JSON < 80KB |
| 包体预算 | 单控件全状态合计目标 < 40KB WebP；`assets/pvp` 控件包增量控制在 **+150KB** 内（可替换旧帧）；首屏 CTA 预载 |
| APK WebView | 壳加载线上静态——发网页即可；避免重 blur/filter；慎用 `will-change` |
| 音效（P4） | 点击 <40ms，与 press 同帧；总开关 |
| 现有资产 | `assets/pvp/btn-*.png` 基线；`pvp-qa/settle-art/trade-controls*` 草案；定稿写 MANIFEST |

### 7.3 换皮实施顺序（资源视角）

1. **`assets/pvp` 交易/消息/准备切片**（局内手感立刻变）  
2. **`css/game.css` + `css/pvp.css`** 接入全局 `.ctl` press / loading / 虚实线  
3. **输入壳 + auth/feedback**（去原生白框）  
4. **`images/avatars` 手绘框**与品牌图（不必阻塞 P0–P1）  
5. 评估是否把高频态打成小 sprite；仍避免全站大图集  

---

## 8. 分阶段实施路线

| 阶段 | 内容 | 出包标准 | 依赖 |
|---|---|---|---|
| **P0 全局 press 系统** | 统一 `.ctl` 原子：`:hover/:active/:disabled` + JS `data-state`；给 `.action-btn` `.pvp-btn` 补 press；Toast/错误 shake 工具函数 | 无新美术也可上；全可点物有下沉 | 无 |
| **P1 核心对战控件** | 买卖/保持/消息/准备/离开确认/座位勾/邀请三键 换手绘切片 | PvP 局内+大厅主路径手绘化 | 绘图 Bot P1 包 |
| **P2 表单/输入自定义** | auth/feedback/hindsight/report 输入外壳；纸墨开关；checkbox | 无原生白框外露 | 绘图 Bot 输入框包 |
| **P3 匹配/加载仪式感** | 开局读条、大厅骨架、约战 cast bar、匹配空态插画 | 等待不再「纯文字」 | 插画+动效 |
| **P4 抛光** | 音效、boil 微动、礼物与 CTA 统一、reduced-motion 审计、WebView 真机 | 手感短片可演示 | QA |

**明确不做（本项目文档范围）**：本 PR 不改 UI 代码；不合并；不引入 Wired Elements 运行时依赖到生产（可仅作 REA 标本）。

---

## 9. 验收标准与反例

### 9.1 通过标准

- [ ] 录屏：连续点击买卖/准备/登录，**每次**可见 press→release（或进入 loading）；press ≤120ms。  
- [ ] 主路径控件无 OS 默认 textbox/button 外观（DevTools 里可有原生节点，截图不可辨）。  
- [ ] 非法操作必有 shake/红闪或等价错误态，而非静默 disable；**无** `alert()`。  
- [ ] >300ms 请求有 loading 态且**控件外形不换类型**；成功有短时 success 换墨。  
- [ ] 未确认用虚线壳、已锁定/成交用实线（抽检买卖提交与准备）。  
- [ ] 同一屏仅一个主循环 CTA 满高亮。  
- [ ] `prefers-reduced-motion: reduce` 下无持续旋转/抖动/boil；press 位移仍在。  
- [ ] 楷体用于主 CTA；买卖红绿色义不被主题反转。  
- [ ] Android WebView：输入法、caret、点击热区无穿透。

### 9.2 反例（仍算「假 / AI 味」）

- 只改了圆角和背景色，仍是系统组件轮廓。  
- hover 有、**press 无**。  
- loading 只改按钮文字为「…」无条/无帧。  
- 完美对称、零纸纹、大渐变玻璃拟态（同花顺/券商风）。  
- 阴影全是 `box-shadow: 0 8px 24px rgba(0,0,0,.2)` 软影。  
- 主按钮用 emoji 或图标字体凑合、无手绘切片。  
- 文案腔调模板化（「开启您的智能投资之旅」）——语气应保持本品既有梗与短句。

---

## 10. 附录：给绘图 Bot 的逐控件出图 Brief

> 风格锚点：牛皮纸 `#f3ead8`、墨线 `#3a3530`、朱砂买入 `#e05252`、青綠卖出 `#3db86a`、楷体标签区留白；轻微歪斜 ≤2°；透明底；**勿**生成券商 UI。  
> 输出目录建议：`assets/controls/`（实施阶段）；先交到约定 draft 目录亦可。

| 文件名模式 | 尺寸 (1x CSS px) | 必出状态帧 | 备注 |
|---|---|---|---|
| `ctl-buy-{default,press,disabled,locked}.png` | 190×80 | 4 | 可与现 `btn-buy.png` 迭代；标签区中央留空或绘「买入」楷体 |
| `ctl-sell-*.png` | 190×80 | 4 | 同上 |
| `ctl-hold-*.png` | 190×80 | 4 | 「观望/保持」 |
| `ctl-msg-*.png` | 80×80 | default/press/disabled | 气泡图标 |
| `ctl-ready-*.png` | 140×56 | default/press/success | 朱文印 |
| `ctl-cancel-ready-*.png` | 140×56 | default/press | 虚线印 |
| `ctl-challenge-*.png` | 96×40 | default/press/loading | 大厅「约战」 |
| `ctl-primary-*.png` | 160×48 | default/press/loading/disabled | 通用主 CTA（登录/开始/接受） |
| `ctl-secondary-*.png` | 160×48 | default/press | 次要 |
| `ctl-danger-*.png` | 160×48 | default/press | 认输/退出 |
| `ctl-input-shell-{default,focus,error}.png` | 280×48（可 9-slice） | 3 | 单行输入外壳 |
| `ctl-textarea-shell-*.png` | 280×120 | 3 | 反馈/举報 |
| `ctl-checkbox-{off,on}.png` | 28×28 | 2 | 含勾笔动画可出 3 帧 sprite |
| `ctl-radio-{off,on}.png` | 28×28 | 2 | |
| `ctl-close-x.png` | 40×40 | default/press | 毛边 × |
| `ctl-toast-{success,error,info}.png` | 280×48 | 3 | 墨印条 |
| `ctl-castbar-track.png` + `ctl-castbar-fill.png` | 240×16 | track+fill | 匹配/加载 |
| `ctl-modal-paper.png` | 360×480 可 9-slice | 1 | 对话框底 |
| `ctl-avatar-frame.png` | 48×48 / 72×72 | 1–2 | 座位与资料 |
| `ctl-lane-frame.png` | 320×96 9-slice | default/press | 首页卡片边框（可选 P2） |
| `ctl-switch-paper.png` / `ctl-switch-ink.png` | 64×36 | 各 2 态 | 纸墨切换 |

**交付物清单**：PNG @2x + 同名 WebP；每组附 `MANIFEST.md`（帧名、锚点、安全边距 4px、是否含文字）。含文字版本需提供**无字空白框**以便 CSS 叠楷体（Android 字体回退）。

### 10.1 绘图 Bot 开工清单（按优先级勾选）

**P1 包（先做，阻塞手感）**

- [ ] `ctl-buy` / `ctl-sell` / `ctl-hold`：default · press · disabled · locked（虚线意图 / 实线锁定可各一帧）  
- [ ] `ctl-msg`：default · press · disabled  
- [ ] `ctl-ready` / `ctl-cancel-ready`：default · press · success(ready)  
- [ ] `ctl-challenge`（约战）：default · press · loading（沸腾或砂轮叠加说明）  
- [ ] `ctl-danger` + `ctl-primary` + `ctl-secondary`（离开确认三键可复用）  
- [ ] `ctl-castbar-track` + `fill`（匹配/开局）  
- [ ] `ctl-toast-success/error/info`

**P2 包**

- [ ] `ctl-input-shell` / `ctl-textarea-shell`：default · focus · error  
- [ ] `ctl-checkbox` / `ctl-radio` · `ctl-close-x`  
- [ ] `ctl-modal-paper` 9-slice · `ctl-avatar-frame`  
- [ ] 纸/墨 switch 印章

**约束（REA）**

- 切片**不要写死动态数字**；双线描边 OK；press 帧视觉上 elevation 更低、线可略粗；提供至少一套「虚线壳」用于未确认态。

---

## 11. 附录 B：控件 ID 速查（实施用）

单人：`buyBtn` `sellBtn` `holdBtn` `fastForwardBtn` `finishBtn` `rewindBtn` `indicatorsToggle`  
PvP：`pvpTradePrimary` `pvpHold` `pvpMsgOpen` `pvpReadyBtn` `pvpCancelReadyBtn` `pvpRoomLeave` `pvpLeaveStay` `pvpLeaveLobby` `pvpLeaveForfeit` `pvpInviteAccept` `pvpInviteDecline` `pvpInviteIgnore` `pvpLobbyLogin` `pvpShareBtn` …  
Auth/反馈：`authLoginBtn` `authModal` inputs `feedbackSubmit` `feedbackBody`  
等待：`pvpLobbyLoading` `fillModeLoadingPane` `authToastHost`

---

## 12. 文档修订记录

| 日期 | 版本 | 说明 |
|---|---|---|
| 2026-10-12 | v1.0 | 首版：代码盘点 + News Bot 竞品精炼 + WoW 映射 + 绘图 brief；仅文档 PR |
| 2026-10-12 | v1.1 | 并入 REA 逆向（坐庄风云/Drawably/Wired/Papercuts/252）；跨站 10 条硬规范；静态 ≈4.2M 换皮预算与无 sprite 现状写入 §7 |
| 2026-10-12 | v1.2 | 新增 §6.4 子屏/面板进出场：模态·sheet·全视图时序/缓动/遮罩 z-index、与 press≤120ms 衔接（总感 ≤200–280ms）、reduced-motion；仅文档 |


## P3 · Batch 1 落地记录（2026-10-12）

| 控件 | 位置 | 实现 |
|---|---|---|
| `ctl-rank-card` | 大厅 `#pvpLobbyMe` / 对战档案 `#pvpStats`（`fillDossier`） | 9-slice `24/24/24/104` border-image；段位图标叠在 Ø72 槽（按每张图标的实际画面做居中+等大）；进度条填充落在手绘凹槽里；头像（更换头像）移到右上角 44px 点击区 |
| `ctl-seat-panel-{self,opponent}-{default,active,leading}` | 对局顶栏 `#pvpSeatMe/#pvpSeatOpp` | 9-slice（头像侧 56px、另一侧 36px）；头像放在 Ø32 透明孔；`data-seat-state`：准备阶段已准备 / 对局中本手已出手 = active，收益领先 = leading |
| `ctl-timer-ring-*` | `#pvpReadyClock`（分段环）/ `#pvpClock` | track + 用 `conic-gradient` 遮罩的 fill（`--ctl-timer-p` = 剩余比例，`@property` 250ms 线性过渡）；≤5 秒换朱砂 urgent 环并轻微脉动；减弱动效下不做过渡和脉动 |
| `ctl-share-save-*` | PvP 结算页「再次约战」旁 `#pvpResultShareImage` | 只有图标，`aria-label="保存分享图"`；press/loading/disabled 各有一帧；调用 `js/share-image.js` |

`js/share-image.js`：用本地 `js/vendor/html2canvas.esm.js` 把 1080×1440 的战报卡渲染成 PNG（内容：行情区间/对局日期、结果、双方头像/昵称/收益、段位分变化+段位、收益曲线静态图、股票、大厅链接+二维码 `js/vendor/qrcode.js`、slogan）。交付顺序：`StockGameApp.saveImage(base64, fileName)` → `navigator.share({files})` → `<a download>`；出错就弹印章 toast。
Android（`MainActivity.kt`）：`saveImage` 在 API 29 及以上写入 MediaStore `Pictures/早知道当初不炒了/`，API 29 以下改走系统分享；`shareImage(base64, fileName, title)` 通过 FileProvider 放到 `cache/share`。这次只改代码，不发版。
