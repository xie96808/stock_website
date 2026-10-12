# 手绘控件全量重做：产品调研与开发规格

> 版本：v1.0 · 2026-10-12（Asia/Shanghai）  
> 状态：**仅文档 / 未实现 UI**。本文件指导绘图 Bot 出图与后续前端实施；**禁止**在本 PR 内改控件实现。  
> 产品：`stockgame.xieyw.top`（股市模拟盘小游戏）· 仓库 `/workspace/stock_website`  
> 依据：`index.html` + `css/*` + `js/auth.js` / `feedback.js` / `pvp/*` 实盘点；既有 `docs/pvp-battle-design.md`、纸墨 tokens（`css/base.css`）；News Bot 竞品素材（精炼并入 §3）；公开网页检索（真实链接，不编造评测）。

---

## 0. 执行摘要（给 Bill / 父代理）

| 项 | 结论 |
|---|---|
| 病根 | 多数控件是「纸墨皮肤的原生 button/input」：系统字体区过大、缺统一 press→release、无读条/冷却/错误抖动仪式感；布局仍像表单/后台。PvP 底栏已有手绘切片雏形（`assets/pvp/btn-*.png`），但全局未成体系。 |
| 方向 | **全控件手绘定制**（禁止默认 textbox/button 观感）+ **WoW 式点击反馈系统** + 楷体/硬阴影/不规则 hit 区。 |
| Top 10 优先重绘 | ①买卖主按钮 ②观望/保持 ③消息气泡键 ④准备/取消准备 ⑤匹配/约战行按钮 ⑥离开/退出确认三键 ⑦登录主 CTA ⑧自定义输入框 ⑨加载/开局读条 ⑩Toast |
| REA 优先逆向 | 坐庄风云(itch) → Drawably → Wired Elements → Papercuts Trading → 最强富翁(若可访问) |
| 下一步 | 绘图 Bot 按附录 brief 出状态帧 → P0 全局 press 系统（无新美术也可先做位移/压暗）→ 再换切片 |

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

---

## 4. 设计原则

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

## 6. 交互动画规范（魔兽世界参考）

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
| 退出确认打开 | 纸片从顶 12px 滑入+淡入 | 180 | ease-out | 是（点遮罩=留下） |
| 消息气泡 | scale 0.85→1 + 上浮 | 200 | cubic-bezier(.2,.8,.2,1) | 是 |
| Toast 盖章 | 下落盖印 | 200 in / 2200 hold / 180 out | ease | 是（点消失） |
| 错误 | X 轴 ±4px 抖动 4 次 + 红墨闪 | 320 | ease-in-out | — |
| 成功准备勾 | pop scale | 320（已有可对齐） | ease | — |

### 6.3 减弱动效

```css
@media (prefers-reduced-motion: reduce) {
  /* 保留 press 位移与状态色；停用 shake loop、烟花、boil、无限旋转 */
}
```

---

## 7. 动画与资源管线

| 议题 | 建议 |
|---|---|
| 格式 | 静态态：WebP（PNG 备份透明）；小图标可 SVG 手绘描边；**避免**运行时 Rough.js 全量 redraw（Android WebView 掉帧） |
| Sprite | 同控件多状态横拼 sprite + `background-position`；或 `<img>` 切 src（状态少时更简单） |
| 动画实现 | 优先 **CSS transform/opacity**（合成层）；复杂时间线用 **WAAPI**；Lottie 仅用于一次性仪式（开局、胜利），控制 JSON < 80KB |
| 包体 | 单控件全状态合计目标 < 40KB WebP；首屏关键 CTA 预载；其余 lazy |
| APK WebView | 已有壳加载线上站点——发静态即可，无强更 APK；避免过大 blur/filter；`will-change: transform` 慎用 |
| 音效（可选 P3） | 点击短音 < 40ms；与 press 同帧；设总开关 |
| 现有资产 | `assets/pvp/btn-*.png` 可作基线；`/workspace/pvp-qa/settle-art/trade-controls*` 为草案，定稿后替换并写 MANIFEST |

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

- [ ] 录屏：连续点击买卖/准备/登录，**每次**可见 press→release（或进入 loading）。  
- [ ] 主路径控件无 OS 默认 textbox/button 外观（DevTools 里可有原生节点，截图不可辨）。  
- [ ] 非法操作必有 shake/红闪或等价错误态，而非静默 disable。  
- [ ] >300ms 请求有 loading 态；成功有短时 success。  
- [ ] `prefers-reduced-motion: reduce` 下无持续旋转/抖动循环。  
- [ ] 楷体用于主 CTA；纸/墨主题下对比度可辨。  
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

