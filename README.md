# 早知道当初不炒了

> 用真实 A 股数据，重走每一次错过的行情

基于 HTML/CSS/JavaScript + ECharts 构建的 A 股模拟炒股训练。随机三十日 K 线，隐去名称代码，练盘感与交易纪律。

在线体验：https://stockgame.xieyw.top

## 页面预览

### 首页
![首页](images/homepage.png)

### 当初买了该多好
![当初买了该多好](images/regret_col.png)

## 功能概览

### 模拟盘
- **真实数据** — 198 只 A 股（沪深 300 + 中证 500），2024 全年日 K
- **T+1 规则** — 当日买入，次日方可卖出；支持次日开盘 / 同日收盘两种成交模式
- **隐去身份** — 名称代码揭晓前，只看 K 线做判断
- **均线系统** — MA5 / MA10 / MA20 / MA30
- **结算评分** — 收益率、买卖点位、交易频率、止损意识等维度评分，终局揭晓标的
- **登录与云对局** — 注册登录后进度上云；本地练习仍可游客游玩
- **韭币** — 账号内货币：开局消耗、每日领取、计奖题组奖励、反悔等
- **今日挑战 + 日榜** — 每日统一窗口的挑战局与日榜
- **一把梭** — 全生命周期限 1 买 1 卖
- **生存模式** — 触及 −20% 爆仓线即结束
- **幽灵对局** — 与昨日结算池中的匿名对局回放对战
- **残局挑战** — 多章节短局关卡（星级目标 / 周榜）

### 韭菜修炼基地
- **知识区** — K 线 / 成交量 / 走势形态卡片（31 种），含示意图与信号说明
- **训练区** — 每次 10 道题：看图识形 + 真 K 线续接实操；答对/答错均给解析（练习不计奖）
- **计奖题组** — 每日 5 题；完成与首次正确奖励韭币；可看解析
- **练习榜** — 训练相关排行（与今日挑战日榜区分）

### 当初买了该多好
- **历史回溯** — 输入股票与区间、买入数量，回看理论最佳卖点与收益
- **一键分享** — 生成分享图、复制文案（含成功/失败提示），再来一只继续悔棋

### 其他
- **纸 / 墨主题** — 手绘笔记本风，浅色 / 深色一键切换
- **响应式** — 桌面与移动端；可选页面缩放
- **零构建前端** — 静态资源无需打包；API 服务单独部署

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | HTML5 + CSS3 + JavaScript ES6+ Modules |
| 图表 | [ECharts 5.4](https://echarts.apache.org/)（异步加载） |
| 字体 | 系统字体栈（`--sans` / `--kaiti` / `--mono`，无 Google Fonts） |
| 数据 | [AKShare](https://github.com/akfamily/akshare)（东方财富接口） |
| 后端 | Node.js + Express + SQLite（`server/`） |
| 部署 | 生产静态：阿里云 + GitHub Actions（https://stockgame.xieyw.top）；API 需另行部署 |

## 快速开始

```bash
# 1. 克隆项目
git clone https://github.com/xie96808/stock_website.git
cd stock_website

# 2. 静态前端（ES Modules 需 HTTP）
python -m http.server 8000
# 然后打开 http://localhost:8000

# 3. （可选）本地 API
npm run server:install
npm run server:migrate
npm run server:dev
```

项目已内置 2024 年数据。如需更新：

```bash
pip install akshare pandas
python fetch_stock_data.py   # 约 3–5 分钟
```

## 测试

```bash
npm install
npm run server:install   # better-sqlite3 等服务端依赖
npm test                 # 前端单测 + server 集成测
```

## 项目结构

```
stock_website/
├── index.html              # 页面结构 + 模块入口
├── css/                    # 主题与各屏样式（base / start / game / …）
├── js/                     # ES Module 前端（对局、修炼、悔棋、鉴权…）
├── shared/                 # 前后端共用引擎与协议
├── server/                 # API（鉴权、对局、韭币、残局、日挑战…）
├── tests/                  # 前端 / 引擎单测
├── images/                 # 吉祥物与 README 截图
├── data/                   # 行情包与 pack-meta
├── fetch_stock_data.py     # 行情抓取脚本
└── deploy/                 # 生产部署脚本
```

## License

MIT

## Special

* 我的开源项目已链接认可[LINUX DO社区](https://linux.do)
