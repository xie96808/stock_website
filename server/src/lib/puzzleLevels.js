/**
 * F02 chapter-1 authored level catalog (synthetic OHLC windows).
 * Prefer validated synthetic configs for tests + skeleton publishability.
 * Real-pack substitution is optional follow-up (see docs/puzzle-chapter-f02.md).
 */
import crypto from "node:crypto";
import { PUZZLE_RULE_VERSION, PUZZLE_FILL_MODE } from "../../../shared/puzzleEngine.js";

export const PUZZLE_CHAPTER_ID = "ch1";
export const PUZZLE_FIRST_CLEAR_REWARD = 20;
export const PUZZLE_CHAPTER_MAX_REWARD = 120;
export const PUZZLE_CREATE_FEE = 0;

function bar(open, high, low, close, date) {
  return { date: date || "", open, high, low, close, volume: 1000 };
}

function sha256Text(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Six minimal workable chapter-1 levels.
 * Each includes a documented 3★ route (actions) for validation tests.
 */
export const CHAPTER1_LEVEL_DEFS = [
  {
    levelIndex: 1,
    levelKey: "ch1-01",
    rewardFamilyId: "ch1-01",
    version: 1,
    title: "第一天站岗",
    theme: "买入后已有浮亏",
    gameDays: 6,
    maxOrders: null,
    stockCode: "P0101",
    stockName: "残局·站岗",
    // Pre-bought at 12; day1 open 10 (浮亏). Hold to end → further loss.
    // Sell day1 (fill d2@10) stays flat → beats buy-hold if end dumps.
    bars: [
      bar(10, 10.5, 9.5, 10.2, "2024-06-01"),
      bar(10.0, 10.2, 9.8, 9.9, "2024-06-02"),
      bar(9.9, 10.0, 9.5, 9.6, "2024-06-03"),
      bar(9.6, 9.7, 9.0, 9.1, "2024-06-04"),
      bar(9.1, 9.2, 8.5, 8.6, "2024-06-05"),
      bar(8.6, 8.7, 8.0, 8.1, "2024-06-06"),
    ],
    initialState: {
      cash: 0,
      qty: 10000 / 12,
      cost: 12,
      buyFillDay: 0,
      firstSellableDay: 1,
    },
    goals: {
      twoStar: { beatBuyHoldPp: 5 },
      threeStar: { maxMddPct: 25, maxOrders: 1 },
    },
    // 3★: sell once on day1, stay flat (1 order, beat hold, MDD from takeover)
    validatedThreeStarActions: ["sell", "hold", "hold", "hold", "hold"],
    contentNote: "synthetic window; 3★ route validated in unit tests",
    status: "published",
  },
  {
    levelIndex: 2,
    levelKey: "ch1-02",
    rewardFamilyId: "ch1-02",
    version: 1,
    title: "到手的利润",
    theme: "初始持仓处于浮盈",
    gameDays: 6,
    maxOrders: null,
    stockCode: "P0102",
    stockName: "残局·止盈",
    // Bought at 8; day1 open 12 (浮盈). Give-back if held; bank by selling.
    bars: [
      bar(12, 12.5, 11.5, 12.0, "2024-06-01"),
      bar(12.0, 12.2, 11.0, 11.2, "2024-06-02"),
      bar(11.2, 11.3, 10.0, 10.2, "2024-06-03"),
      bar(10.2, 10.4, 9.5, 9.6, "2024-06-04"),
      bar(9.6, 9.8, 9.0, 9.1, "2024-06-05"),
      bar(9.1, 9.2, 8.5, 8.6, "2024-06-06"),
    ],
    initialState: {
      cash: 0,
      qty: 10000 / 8,
      cost: 8,
      buyFillDay: 0,
      firstSellableDay: 1,
    },
    goals: {
      twoStar: { beatBuyHoldPp: 10 },
      threeStar: { maxMddPct: 15, maxOrders: 1 },
    },
    validatedThreeStarActions: ["sell", "hold", "hold", "hold", "hold"],
    contentNote: "synthetic window; 3★ route validated in unit tests",
    status: "published",
  },
  {
    levelIndex: 3,
    levelKey: "ch1-03",
    rewardFamilyId: "ch1-03",
    version: 1,
    title: "两笔机会",
    theme: "空仓、最多两笔实际成交订单",
    gameDays: 7,
    maxOrders: 2,
    stockCode: "P0103",
    stockName: "残局·两笔",
    // Flat start. Good buy early, sell before dump. 3rd order rejected.
    bars: [
      bar(10, 10.2, 9.8, 10.0, "2024-06-01"),
      bar(10.0, 10.5, 9.9, 10.4, "2024-06-02"),
      bar(10.4, 11.5, 10.3, 11.4, "2024-06-03"),
      bar(11.4, 12.5, 11.3, 12.4, "2024-06-04"),
      bar(12.4, 12.6, 11.0, 11.2, "2024-06-05"),
      bar(11.2, 11.3, 9.5, 9.6, "2024-06-06"),
      bar(9.6, 9.7, 9.0, 9.1, "2024-06-07"),
    ],
    initialState: {
      cash: 100000,
      qty: 0,
      cost: 0,
      buyFillDay: null,
      firstSellableDay: 1,
    },
    goals: {
      twoStar: { beatBuyHoldPp: 5 },
      threeStar: { maxMddPct: 20, maxOrders: 2 },
    },
    // buy d1→f2@10, sell d3→f4@11.4
    validatedThreeStarActions: ["buy", "hold", "sell", "hold", "hold", "hold"],
    contentNote: "synthetic; order budget=2 enforced by engine",
    status: "published",
  },
  {
    levelIndex: 4,
    levelKey: "ch1-04",
    rewardFamilyId: "ch1-04",
    version: 1,
    title: "明天才好卖",
    theme: "刚买入的锁定持仓",
    gameDays: 6,
    maxOrders: null,
    stockCode: "P0104",
    stockName: "残局·T+1",
    // Bought fill day=1 (locked). firstSellableDay=2 (sell decision day2 → fill day3).
    // Day1 sell illegal. Price dips then recovers — wait for legal sell after bounce? or hold.
    bars: [
      bar(10, 10.2, 9.5, 9.5, "2024-06-01"), // buy filled at open 10 same morning
      bar(9.5, 9.6, 9.0, 9.1, "2024-06-02"),
      bar(9.1, 10.5, 9.0, 10.4, "2024-06-03"),
      bar(10.4, 11.0, 10.2, 10.8, "2024-06-04"),
      bar(10.8, 11.2, 10.5, 10.6, "2024-06-05"),
      bar(10.6, 10.8, 10.0, 10.2, "2024-06-06"),
    ],
    initialState: {
      cash: 0,
      qty: 10000 / 10,
      cost: 10,
      buyFillDay: 1,
      firstSellableDay: 2,
    },
    goals: {
      twoStar: { beatBuyHoldPp: 0 },
      threeStar: { maxMddPct: 12, maxOrders: 1 },
    },
    // sell on day2 → fill day3 @9.1 is worse; hold all for valuation 10.2 > buy-hold same.
    // Actually buy-hold final = 10.2/takeover. takeover mark=day1 open=10, qty=1000, nav=10000, final=10200 → +2%
    // To beat buy-hold: sell day3 fill d4@10.4 then stay flat? edge small.
    // Better: sell day3 → f4@10.4, final cash = 1000*10.4=10400 vs hold 10200.
    validatedThreeStarActions: ["hold", "hold", "sell", "hold", "hold"],
    contentNote: "T+1 lock: day1 sell rejected; synthetic window",
    status: "published",
  },
  {
    levelIndex: 5,
    levelKey: "ch1-05",
    rewardFamilyId: "ch1-05",
    version: 1,
    title: "震荡磨人",
    theme: "已有持仓、窄幅行情",
    gameDays: 8,
    maxOrders: 2,
    stockCode: "P0105",
    stockName: "残局·震荡",
    bars: [
      bar(10, 10.3, 9.8, 10.1, "2024-06-01"),
      bar(10.1, 10.4, 9.9, 10.0, "2024-06-02"),
      bar(10.0, 10.2, 9.7, 9.9, "2024-06-03"),
      bar(9.9, 10.1, 9.6, 9.8, "2024-06-04"),
      bar(9.8, 10.5, 9.7, 10.4, "2024-06-05"),
      bar(10.4, 10.6, 10.0, 10.1, "2024-06-06"),
      bar(10.1, 10.2, 9.5, 9.6, "2024-06-07"),
      bar(9.6, 9.8, 9.4, 9.5, "2024-06-08"),
    ],
    initialState: {
      cash: 0,
      qty: 1000,
      cost: 10,
      buyFillDay: 0,
      firstSellableDay: 1,
    },
    goals: {
      twoStar: { beatBuyHoldPp: 3 },
      threeStar: { maxMddPct: 10, maxOrders: 2 },
    },
    // sell early-ish before late dump: sell d1 → f2@10.1, stay flat
    validatedThreeStarActions: ["sell", "hold", "hold", "hold", "hold", "hold", "hold"],
    contentNote: "synthetic chop; order budget 2",
    status: "published",
  },
  {
    levelIndex: 6,
    levelKey: "ch1-06",
    rewardFamilyId: "ch1-06",
    version: 1,
    title: "最后几个交易日",
    theme: "带持仓进入短窗口",
    gameDays: 6,
    maxOrders: null,
    stockCode: "P0106",
    stockName: "残局·到期",
    // Teach: last day = valuation only. Selling before end can differ from hold valuation.
    bars: [
      bar(10, 10.2, 9.9, 10.0, "2024-06-01"),
      bar(10.0, 10.5, 9.9, 10.4, "2024-06-02"),
      bar(10.4, 11.0, 10.3, 10.9, "2024-06-03"),
      bar(10.9, 11.5, 10.8, 11.4, "2024-06-04"),
      bar(11.4, 11.6, 10.5, 10.6, "2024-06-05"),
      bar(10.6, 10.8, 10.4, 10.5, "2024-06-06"),
    ],
    initialState: {
      cash: 0,
      qty: 1000,
      cost: 9.5,
      buyFillDay: 0,
      firstSellableDay: 1,
    },
    goals: {
      twoStar: { beatBuyHoldPp: 3 },
      threeStar: { maxMddPct: 8, maxOrders: 1 },
    },
    // sell day3 → fill d4@10.9 before giveback; beats hold to 10.5
    validatedThreeStarActions: ["hold", "hold", "sell", "hold", "hold"],
    contentNote: "illustrates terminal valuation vs selling; synthetic",
    status: "published",
  },
];

export function buildLevelSnapshot(def) {
  const history = [];
  const snapshot = {
    ruleVersion: PUZZLE_RULE_VERSION,
    fillMode: PUZZLE_FILL_MODE,
    gameDays: def.gameDays,
    historyLength: history.length,
    history,
    bars: def.bars,
    initialState: def.initialState,
    maxOrders: def.maxOrders,
    goals: def.goals,
    levelKey: def.levelKey,
    rewardFamilyId: def.rewardFamilyId,
  };
  const snapshotJson = JSON.stringify(snapshot);
  return {
    snapshot,
    snapshotJson,
    snapshotSha256: sha256Text(snapshotJson),
  };
}

export function puzzleVersionId(def) {
  return `puzzle:${def.levelKey}:v${def.version}`;
}

export function firstClearRewardKey(rewardFamilyId) {
  return `puzzle:first-clear:${rewardFamilyId}`;
}
