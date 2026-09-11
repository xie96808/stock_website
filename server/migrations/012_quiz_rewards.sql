-- F11 daily quiz rewards: question bank, daily sets, attempts/answers.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS quiz_questions (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 1,
  category TEXT,
  stem TEXT NOT NULL,
  options_json TEXT NOT NULL,
  correct_option_id TEXT NOT NULL,
  explanation TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quiz_daily_sets (
  set_date TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  question_ids_json TEXT NOT NULL,
  reward_complete INTEGER NOT NULL DEFAULT 10 CHECK (reward_complete > 0),
  reward_bonus INTEGER NOT NULL DEFAULT 10 CHECK (reward_bonus >= 0),
  bonus_min_correct INTEGER NOT NULL DEFAULT 4 CHECK (bonus_min_correct > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  set_date TEXT NOT NULL,
  set_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'settled')),
  first_correct_count INTEGER,
  reward_amount INTEGER,
  settled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, set_date)
);

CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user_created
  ON quiz_attempts(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS quiz_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id TEXT NOT NULL REFERENCES quiz_attempts(id),
  question_id TEXT NOT NULL,
  option_id TEXT NOT NULL,
  is_correct INTEGER NOT NULL CHECK (is_correct IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (attempt_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_quiz_answers_attempt
  ON quiz_answers(attempt_id);

INSERT INTO quiz_questions (id, version, category, stem, options_json, correct_option_id, explanation, active) VALUES ('q001', 1, 'rules', 'A股普通股票实行 T+1 交易制度，含义是？', '[{"id": "a", "text": "当天买入，当天即可卖出"}, {"id": "b", "text": "当天买入，最早下一交易日可卖出"}, {"id": "c", "text": "买入后必须持有一个月"}, {"id": "d", "text": "只能在尾盘买卖"}]', 'b', 'A股现货股票为 T+1：当日买入的股票下一交易日才能卖出。', 1);
INSERT INTO quiz_questions (id, version, category, stem, options_json, correct_option_id, explanation, active) VALUES ('q002', 1, 'rules', '主板股票常见涨跌幅限制（不含特殊情形）是？', '[{"id": "a", "text": "±5%"}, {"id": "b", "text": "±10%"}, {"id": "c", "text": "±20%"}, {"id": "d", "text": "无限制"}]', 'b', '主板多数股票日常涨跌幅限制为 ±10%；科创板/创业板等另有规定。', 1);
INSERT INTO quiz_questions (id, version, category, stem, options_json, correct_option_id, explanation, active) VALUES ('q003', 1, 'concept', '市盈率（PE）大致表示？', '[{"id": "a", "text": "公司一年能赚回股价的倍数关系（股价/每股收益）"}, {"id": "b", "text": "公司负债占总资产比例"}, {"id": "c", "text": "当天成交量排名"}, {"id": "d", "text": "股东人数"}]', 'a', 'PE = 股价 / 每股收益，常用来粗略比较估值高低，需结合成长与行业。', 1);
INSERT INTO quiz_questions (id, version, category, stem, options_json, correct_option_id, explanation, active) VALUES ('q004', 1, 'kline', 'K线图中，收盘价高于开盘价的K线通常称为？', '[{"id": "a", "text": "阴线"}, {"id": "b", "text": "阳线"}, {"id": "c", "text": "十字星"}, {"id": "d", "text": "停牌线"}]', 'b', '收盘高于开盘为阳线；收盘低于开盘为阴线（配色因软件而异）。', 1);
INSERT INTO quiz_questions (id, version, category, stem, options_json, correct_option_id, explanation, active) VALUES ('q005', 1, 'volume', '放量上涨通常更可能意味着？', '[{"id": "a", "text": "无人关注"}, {"id": "b", "text": "交投活跃，资金参与度相对较高"}, {"id": "c", "text": "一定会连续涨停"}, {"id": "d", "text": "一定是假突破"}]', 'b', '放量说明成交活跃；是否延续趋势仍需结合位置、形态与基本面，不能单看量能下定论。', 1);
INSERT INTO quiz_questions (id, version, category, stem, options_json, correct_option_id, explanation, active) VALUES ('q006', 1, 'risk', '模拟盘里更健康的做法是？', '[{"id": "a", "text": "亏损时加杠杆摊平，指望一把翻本"}, {"id": "b", "text": "事先想好可承受回撤，避免情绪化死扛"}, {"id": "c", "text": "只看别人晒单跟买"}, {"id": "d", "text": "从不看账户"}]', 'b', '有计划的风险控制比“死磕翻本”更接近长期存活；本站也是修炼基地不是玄学赌场。', 1);
INSERT INTO quiz_questions (id, version, category, stem, options_json, correct_option_id, explanation, active) VALUES ('q007', 1, 'kline', '短期均线上穿长期均线，技术派常称作？', '[{"id": "a", "text": "死叉"}, {"id": "b", "text": "金叉"}, {"id": "c", "text": "天地板"}, {"id": "d", "text": "除权"}]', 'b', '短均线上穿长均线常称金叉；反之称死叉。仅为统计描述，不是保证书。', 1);
INSERT INTO quiz_questions (id, version, category, stem, options_json, correct_option_id, explanation, active) VALUES ('q008', 1, 'concept', '市净率（PB）主要关注？', '[{"id": "a", "text": "股价相对每股净资产"}, {"id": "b", "text": "公司员工平均工资"}, {"id": "c", "text": "当日换手率"}, {"id": "d", "text": "融资余额"}]', 'a', 'PB = 股价 / 每股净资产，常用于重资产行业粗略比较，需注意资产质量。', 1);
INSERT INTO quiz_questions (id, version, category, stem, options_json, correct_option_id, explanation, active) VALUES ('q009', 1, 'volume', '换手率偏高通常说明？', '[{"id": "a", "text": "股票永远不会跌"}, {"id": "b", "text": "筹码交换较活跃"}, {"id": "c", "text": "公司一定盈利"}, {"id": "d", "text": "一定会被ST"}]', 'b', '换手高=交投活跃；过高也可能伴随分歧加大，需结合走势解读。', 1);
INSERT INTO quiz_questions (id, version, category, stem, options_json, correct_option_id, explanation, active) VALUES ('q010', 1, 'risk', '关于仓位，更接近常识的是？', '[{"id": "a", "text": "把所有韭币/资金押一只票最稳"}, {"id": "b", "text": "单笔与总仓都要能睡得着觉"}, {"id": "c", "text": "杠杆越高越安全"}, {"id": "d", "text": "听消息满仓最香"}]', 'b', '能承受波动才谈策略；满仓梭哈是修炼反面教材。', 1);
INSERT INTO quiz_questions (id, version, category, stem, options_json, correct_option_id, explanation, active) VALUES ('q011', 1, 'kline', '上下影线都较长、实体很小的K线常称？', '[{"id": "a", "text": "光头阳线"}, {"id": "b", "text": "十字星（或类十字）"}, {"id": "c", "text": "涨停板"}, {"id": "d", "text": "跌停板"}]', 'b', '开收接近、影线明显时常称十字星，多表示多空暂时平衡或分歧。', 1);
INSERT INTO quiz_questions (id, version, category, stem, options_json, correct_option_id, explanation, active) VALUES ('q012', 1, 'concept', '“前高附近压力较大”通常指？', '[{"id": "a", "text": "股价永远到不了那里"}, {"id": "b", "text": "该价位曾有大量换手，再上攻时抛压/观望可能增多"}, {"id": "c", "text": "监管强制限制上涨"}, {"id": "d", "text": "只能在前高卖出"}]', 'b', '技术分析里前高/前低是常见参考位，不是物理铁壁。', 1);
INSERT INTO quiz_questions (id, version, category, stem, options_json, correct_option_id, explanation, active) VALUES ('q013', 1, 'concept', '某日收益率 +3%，若从 100 元涨到约？', '[{"id": "a", "text": "97 元"}, {"id": "b", "text": "103 元"}, {"id": "c", "text": "130 元"}, {"id": "d", "text": "100.3 元"}]', 'b', '100 × (1+3%) = 103。简单百分比加减是入门必会。', 1);
INSERT INTO quiz_questions (id, version, category, stem, options_json, correct_option_id, explanation, active) VALUES ('q014', 1, 'risk', '最大回撤描述的是？', '[{"id": "a", "text": "从阶段高点到随后低点的最大跌幅"}, {"id": "b", "text": "今天的成交额"}, {"id": "c", "text": "公司净利润"}, {"id": "d", "text": "股东人数变化"}]', 'a', '回撤衡量净值从高点回落的幅度，是风险与体验的重要指标。', 1);
INSERT INTO quiz_questions (id, version, category, stem, options_json, correct_option_id, explanation, active) VALUES ('q015', 1, 'concept', '连续两天各跌 10%，相对起点大约亏？', '[{"id": "a", "text": "正好 20%"}, {"id": "b", "text": "约 19%"}, {"id": "c", "text": "约 21%"}, {"id": "d", "text": "0%"}]', 'b', '0.9 × 0.9 = 0.81，约亏 19%。百分比不能简单线性相加。', 1);
INSERT INTO quiz_questions (id, version, category, stem, options_json, correct_option_id, explanation, active) VALUES ('q016', 1, 'risk', '“浮盈时得意忘形、浮亏时彻夜难眠”说明？', '[{"id": "a", "text": "策略已经完美"}, {"id": "b", "text": "仓位或波动可能超出心理承受"}, {"id": "c", "text": "必须立刻满仓加仓"}, {"id": "d", "text": "应关闭行情软件一辈子"}]', 'b', '情绪是仓位的镜子；睡得着才是硬道理。', 1);
INSERT INTO quiz_questions (id, version, category, stem, options_json, correct_option_id, explanation, active) VALUES ('q017', 1, 'rules', '股票临时停牌时，通常？', '[{"id": "a", "text": "仍可自由买卖"}, {"id": "b", "text": "该时段无法正常交易，需等复牌"}, {"id": "c", "text": "强制按昨收成交"}, {"id": "d", "text": "自动换成债券"}]', 'b', '停牌期间一般不能交易，复牌后价格可能跳空。', 1);
INSERT INTO quiz_questions (id, version, category, stem, options_json, correct_option_id, explanation, active) VALUES ('q018', 1, 'rules', '开盘集合竞价主要作用是？', '[{"id": "a", "text": "决定当天唯一成交价并禁止之后交易"}, {"id": "b", "text": "在开盘前集中撮合形成开盘价"}, {"id": "c", "text": "只给机构报价"}, {"id": "d", "text": "计算年度分红"}]', 'b', '集合竞价用于形成开盘（及收盘）参考价，其后进入连续竞价。', 1);
INSERT INTO quiz_questions (id, version, category, stem, options_json, correct_option_id, explanation, active) VALUES ('q019', 1, 'concept', '“趋势交易”更强调？', '[{"id": "a", "text": "无视结构，随机买卖"}, {"id": "b", "text": "顺着已形成的方向参与，并承认判错就退出"}, {"id": "c", "text": "只做逆势抄底且不加止损"}, {"id": "d", "text": "每天必须交易十次"}]', 'b', '有方向假设 + 退出纪律，才叫趋势思路；死扛不是趋势。', 1);
INSERT INTO quiz_questions (id, version, category, stem, options_json, correct_option_id, explanation, active) VALUES ('q020', 1, 'concept', '忽略税费时，买入均价大致是？', '[{"id": "a", "text": "最高买入价"}, {"id": "b", "text": "各笔买入金额合计 / 持股数量"}, {"id": "c", "text": "昨天收盘价"}, {"id": "d", "text": "涨停价"}]', 'b', '成本常用加权平均：总支出÷数量（实盘还要计费用）。', 1);
INSERT INTO quiz_questions (id, version, category, stem, options_json, correct_option_id, explanation, active) VALUES ('q021', 1, 'kline', '放量冲过前高后迅速跌回区间，常被称作？', '[{"id": "a", "text": "突破确认"}, {"id": "b", "text": "疑似假突破/失败突破"}, {"id": "c", "text": "一定是利好落地"}, {"id": "d", "text": "强制平仓"}]', 'b', '站不稳前高且快速回落，常提示突破失败，需等重新确认。', 1);
INSERT INTO quiz_questions (id, version, category, stem, options_json, correct_option_id, explanation, active) VALUES ('q022', 1, 'risk', '成交极少、买卖价差很大的票，风险之一是？', '[{"id": "a", "text": "更好卖"}, {"id": "b", "text": "想卖时可能很难成交或滑点很大"}, {"id": "c", "text": "一定暴涨"}, {"id": "d", "text": "没有波动"}]', 'b', '流动性差会让进出成本显著上升，模拟盘也要有这份自觉。', 1);
INSERT INTO quiz_questions (id, version, category, stem, options_json, correct_option_id, explanation, active) VALUES ('q023', 1, 'concept', '把收益和沪深300等基准对比，是为了？', '[{"id": "a", "text": "证明自己永远正确"}, {"id": "b", "text": "看策略是否跑赢/跑输大盘环境"}, {"id": "c", "text": "代替风控"}, {"id": "d", "text": "决定明天涨跌停"}]', 'b', '相对基准能区分“市场抬轿”与“自身能力”，本站结果页也会涉及对照思路。', 1);
INSERT INTO quiz_questions (id, version, category, stem, options_json, correct_option_id, explanation, active) VALUES ('q024', 1, 'risk', '突发消息冲击时，更稳妥的第一反应是？', '[{"id": "a", "text": "不问逻辑先满仓"}, {"id": "b", "text": "先确认信息来源与自己仓位风险，再决定是否行动"}, {"id": "c", "text": "把手机砸了"}, {"id": "d", "text": "立刻借钱加杠杆"}]', 'b', '先活下来，再谈机会；来源不明的消息最容易收割情绪。', 1);
INSERT INTO quiz_questions (id, version, category, stem, options_json, correct_option_id, explanation, active) VALUES ('q025', 1, 'volume', '缩量阴跌常见特征是？', '[{"id": "a", "text": "交投清淡、价格阴跌绵延"}, {"id": "b", "text": "必定次日涨停"}, {"id": "c", "text": "成交量必然天量"}, {"id": "d", "text": "只能出现在周五"}]', 'a', '缩量阴跌常伴随观望，是否见底仍需更多信号，不能凭感觉抄到底。', 1);
INSERT INTO quiz_questions (id, version, category, stem, options_json, correct_option_id, explanation, active) VALUES ('q026', 1, 'rules', '本站模拟盘经典模式仓位规则更接近？', '[{"id": "a", "text": "可任意分批 0–100% 连续调仓"}, {"id": "b", "text": "扁仓或满仓（flat / 100% long）这类离散选择"}, {"id": "c", "text": "必须始终 50%"}, {"id": "d", "text": "只能空仓"}]', 'b', '经典 sim30 规则是扁仓或满仓多头，降低操作维度，聚焦方向判断。', 1);
INSERT INTO quiz_questions (id, version, category, stem, options_json, correct_option_id, explanation, active) VALUES ('q027', 1, 'rules', '知识馆「今日赚韭币」题组的奖励与每日领取的关系是？', '[{"id": "a", "text": "互相替代，领了题奖就不能每日领"}, {"id": "b", "text": "分开计算，互不影响"}, {"id": "c", "text": "题奖会自动扣回每日领取"}, {"id": "d", "text": "只有游客能领题奖"}]', 'b', '题组奖励与每日领取是独立入口；登录用户完成题组另计，游客仍可免费训练但不发奖。', 1);
INSERT INTO quiz_questions (id, version, category, stem, options_json, correct_option_id, explanation, active) VALUES ('q028', 1, 'rules', '计奖每日题组何时展示正确答案与解析？', '[{"id": "a", "text": "每答一题立刻公布，方便改答案刷分"}, {"id": "b", "text": "五题全部提交结算后统一展示"}, {"id": "c", "text": "永远不展示"}, {"id": "d", "text": "只有答错才展示，答对永久保密"}]', 'b', '为防边看边改，解析在全部提交并结算后给出；首次答案锁定。', 1);
INSERT INTO quiz_questions (id, version, category, stem, options_json, correct_option_id, explanation, active) VALUES ('q029', 1, 'rules', '结算后重看或重练，会怎样？', '[{"id": "a", "text": "每次重练都再发 20 韭币"}, {"id": "b", "text": "不覆盖首次成绩，也不重复发币"}, {"id": "c", "text": "自动清空当日领取"}, {"id": "d", "text": "强制改写排行榜"}]', 'b', '订正/重练可以学习，但不改首次计分、不二次发奖。', 1);
INSERT INTO quiz_questions (id, version, category, stem, options_json, correct_option_id, explanation, active) VALUES ('q030', 1, 'risk', '「早知道当初不炒了」更接近本站想提醒的是？', '[{"id": "a", "text": "永远别学习"}, {"id": "b", "text": "市场有回撤与后悔，先练规则与心态再谈技巧"}, {"id": "c", "text": "必须每天十倍杠杆"}, {"id": "d", "text": "只看营销口号下单"}]', 'b', '名字就写着后悔药——先把规则、风险和复盘练明白，比追涨杀跌重要。', 1);
