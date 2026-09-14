/**
 * F02 chapter-1 authored level catalog — real A-share pack windows (v3).
 * Each level pins stockIndex + windowStartIndex; bars/history embedded for
 * offline tests / mini fixtures. buildLevelSnapshot prefers live pack slice
 * when the dataset can resolve the pin.
 */
import crypto from "node:crypto";
import { PUZZLE_RULE_VERSION, PUZZLE_FILL_MODE } from "../../../shared/puzzleEngine.js";
import { pickPuzzleWindow } from "./dataset.js";

export const PUZZLE_CHAPTER_ID = "ch1";
export const PUZZLE_FIRST_CLEAR_REWARD = 20;
export const PUZZLE_CHAPTER_MAX_REWARD = 120;
export const PUZZLE_CREATE_FEE = 0;

/** Masked identity shown to players (classic ******). Real code lives in snapshot. */
export const PUZZLE_PUBLIC_STOCK_CODE = "******";

function sha256Text(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Six chapter-1 levels on real pack windows.
 * Pedagogical themes preserved; initial positions intentional for 残局.
 */
export const CHAPTER1_LEVEL_DEFS = [
  {
    levelIndex: 1,
    levelKey: "ch1-01",
    rewardFamilyId: "ch1-01",
    version: 4,
    title: "第一天站岗",
    theme: "买入后已有浮亏",
    teachingBrief: "开局已浮亏。继续死扛还是止损离场，比的是相对买入持有少亏多少。",
    openStateHint: "开局已满仓浮亏，可卖可持",
    gameDays: 6,
    maxOrders: 1,
    stockCode: PUZZLE_PUBLIC_STOCK_CODE,
    stockName: "残局·站岗",
    realStockCode: "603698",
    packRef: {
      stockIndex: 930,
      windowStartIndex: 610,
      historyLength: 30,
    },
    stockIndex: 930,
    windowStart: 610,
    // Embedded fallback for unit/integration tests on mini fixtures.
    history: [
      { date: "2026-06-01", open: 32.53, high: 33, low: 32.24, close: 32.33, volume: 124457.57 },
      { date: "2026-06-02", open: 32.6, high: 32.8, low: 31.27, close: 32.03, volume: 123254.54 },
      { date: "2026-06-03", open: 31.8, high: 33.44, low: 31.74, close: 32.52, volume: 142233.48 },
      { date: "2026-06-04", open: 32.18, high: 33.91, low: 32.05, close: 33.07, volume: 186545.18 },
      { date: "2026-06-05", open: 33.47, high: 34.08, low: 32.2, close: 33.17, volume: 211730.84 },
      { date: "2026-06-08", open: 32, high: 33.45, low: 31.35, close: 31.51, volume: 160169.56 },
      { date: "2026-06-09", open: 31.64, high: 31.8, low: 30.65, close: 31.12, volume: 145587.4 },
      { date: "2026-06-10", open: 31.03, high: 31.48, low: 29.95, close: 30.69, volume: 135561.13 },
      { date: "2026-06-11", open: 30.37, high: 30.79, low: 29.75, close: 30.24, volume: 110513.26 },
      { date: "2026-06-12", open: 30.6, high: 32, low: 29.99, close: 30.93, volume: 151609.68 },
      { date: "2026-06-15", open: 30.49, high: 30.99, low: 30.13, close: 30.56, volume: 112151.62 },
      { date: "2026-06-16", open: 32, high: 32.24, low: 30.5, close: 31.14, volume: 210210.49 },
      { date: "2026-06-17", open: 31.4, high: 32.6, low: 31.14, close: 31.72, volume: 210091.25 },
      { date: "2026-06-18", open: 31.48, high: 33.73, low: 31.21, close: 33.03, volume: 255049.08 },
      { date: "2026-06-22", open: 33.09, high: 34.7, low: 32.88, close: 34.65, volume: 307514.05 },
      { date: "2026-06-23", open: 34.07, high: 35.11, low: 33.05, close: 33.96, volume: 233454.59 },
      { date: "2026-06-24", open: 34.41, high: 37.36, low: 33.4, close: 37.36, volume: 196129.47 },
      { date: "2026-06-25", open: 40.84, high: 41.1, low: 39.11, close: 39.59, volume: 607996.33 },
      { date: "2026-06-26", open: 39.5, high: 43.55, low: 39.5, close: 43.55, volume: 326658.6 },
      { date: "2026-06-29", open: 42.73, high: 44.05, low: 39.61, close: 39.87, volume: 426929.51 },
      { date: "2026-06-30", open: 39.87, high: 40.84, low: 37.5, close: 38.56, volume: 377099.84 },
      { date: "2026-07-01", open: 38.6, high: 41.1, low: 38.6, close: 39.5, volume: 293860.07 },
      { date: "2026-07-02", open: 39.28, high: 43.45, low: 39.28, close: 41.43, volume: 357257.85 },
      { date: "2026-07-03", open: 41.2, high: 43.5, low: 40.96, close: 42.25, volume: 340155.55 },
      { date: "2026-07-06", open: 43.52, high: 44.02, low: 38.73, close: 39.37, volume: 293504.81 },
      { date: "2026-07-07", open: 39.8, high: 43.31, low: 39.8, close: 40.89, volume: 394147.55 },
      { date: "2026-07-08", open: 41, high: 41.93, low: 38.58, close: 39.61, volume: 302993.4 },
      { date: "2026-07-09", open: 39.75, high: 41, low: 38.61, close: 40.08, volume: 298511.26 },
      { date: "2026-07-10", open: 40.22, high: 44.09, low: 38.08, close: 44.09, volume: 344492.51 },
      { date: "2026-07-13", open: 43, high: 43, low: 39.68, close: 39.68, volume: 222379 },
    ],
    bars: [
      { date: "2026-07-14", open: 35.71, high: 35.71, low: 35.71, close: 35.71, volume: 22722 },
      { date: "2026-07-15", open: 32.14, high: 32.58, low: 32.14, close: 32.14, volume: 124681 },
      { date: "2026-07-16", open: 29.09, high: 29.78, low: 28.93, close: 28.93, volume: 403973.79 },
      { date: "2026-07-17", open: 27.3, high: 27.8, low: 26.04, close: 26.04, volume: 352846.51 },
      { date: "2026-07-20", open: 25.51, high: 25.78, low: 23.44, close: 23.48, volume: 404656.5 },
      { date: "2026-07-21", open: 24, high: 24.73, low: 21.86, close: 24.18, volume: 440729.21 },
    ],
    initialState: {
      cash: 0,
      qty: 2520.1612903225805,
      cost: 39.68,
      buyFillDay: 0,
      firstSellableDay: 1,
    },
    goals: {
      "twoStar": {
        "beatBuyHoldPp": 8
      },
      "threeStar": {
        "maxMddPct": 15,
        "maxOrders": 1
      }
    },
    validatedThreeStarActions: ["sell","hold","hold","hold","hold"],
    contentNote: "real pack window v4; early-cut 3★ only (beat≥8pp, MDD≤15%)",
    status: "published",
  },
  {
    levelIndex: 2,
    levelKey: "ch1-02",
    rewardFamilyId: "ch1-02",
    version: 3,
    title: "到手的利润",
    theme: "初始持仓处于浮盈",
    teachingBrief: "开局已浮盈。利润会吐回去——关键是把账面收益落袋，别贪到回吐。",
    openStateHint: "开局满仓浮盈，可卖可持",
    gameDays: 8,
    maxOrders: 1,
    stockCode: PUZZLE_PUBLIC_STOCK_CODE,
    stockName: "残局·止盈",
    realStockCode: "300896",
    packRef: {
      stockIndex: 99,
      windowStartIndex: 180,
      historyLength: 30,
    },
    stockIndex: 99,
    windowStart: 180,
    // Embedded fallback for unit/integration tests on mini fixtures.
    history: [
      { date: "2024-08-15", open: 159.02, high: 161.93, low: 158.11, close: 159.49, volume: 14796.2 },
      { date: "2024-08-16", open: 160.42, high: 162.2, low: 158.19, close: 159.66, volume: 13494.63 },
      { date: "2024-08-19", open: 158.68, high: 160.98, low: 157.56, close: 158.27, volume: 12247.07 },
      { date: "2024-08-20", open: 158.15, high: 160.27, low: 155.08, close: 155.74, volume: 14861.59 },
      { date: "2024-08-21", open: 155.93, high: 157.73, low: 155.35, close: 156.67, volume: 11047.62 },
      { date: "2024-08-22", open: 148.96, high: 149.73, low: 136.88, close: 137.38, volume: 65850.22 },
      { date: "2024-08-23", open: 135.74, high: 138.35, low: 133.05, close: 134.93, volume: 34887.57 },
      { date: "2024-08-26", open: 133.69, high: 134.72, low: 130.67, close: 131.74, volume: 28350.63 },
      { date: "2024-08-27", open: 131.77, high: 134, low: 131.4, close: 132.3, volume: 19707.83 },
      { date: "2024-08-28", open: 131.87, high: 132.73, low: 130.72, close: 131.03, volume: 16108.88 },
      { date: "2024-08-29", open: 130.06, high: 136.55, low: 129.86, close: 135.03, volume: 27405.43 },
      { date: "2024-08-30", open: 134.46, high: 140.36, low: 133.77, close: 138.42, volume: 29484.75 },
      { date: "2024-09-02", open: 136.55, high: 137.79, low: 132.39, close: 132.39, volume: 22250.15 },
      { date: "2024-09-03", open: 132.26, high: 135.11, low: 132.15, close: 133.22, volume: 15862.75 },
      { date: "2024-09-04", open: 132.52, high: 135.81, low: 132.43, close: 133.4, volume: 12552.94 },
      { date: "2024-09-05", open: 133.38, high: 135.26, low: 132.5, close: 134.26, volume: 10867.3 },
      { date: "2024-09-06", open: 134.3, high: 134.32, low: 130.02, close: 130.6, volume: 17068.19 },
      { date: "2024-09-09", open: 129.87, high: 130.87, low: 128.01, close: 129.53, volume: 15705.03 },
      { date: "2024-09-10", open: 129.56, high: 133, low: 128.8, close: 131.76, volume: 14531.29 },
      { date: "2024-09-11", open: 131.24, high: 133.3, low: 130.52, close: 132.62, volume: 13244.43 },
      { date: "2024-09-12", open: 132.62, high: 134.64, low: 131.58, close: 131.67, volume: 13002.03 },
      { date: "2024-09-13", open: 131.35, high: 131.76, low: 128.91, close: 129.01, volume: 14108.06 },
      { date: "2024-09-18", open: 129.01, high: 129.64, low: 126.82, close: 128, volume: 11393.18 },
      { date: "2024-09-19", open: 128.61, high: 135.12, low: 128.61, close: 132.44, volume: 24752.09 },
      { date: "2024-09-20", open: 131.66, high: 132.21, low: 129.88, close: 132.03, volume: 14693.9 },
      { date: "2024-09-23", open: 130.85, high: 134.04, low: 130.46, close: 132.04, volume: 12979.5 },
      { date: "2024-09-24", open: 134.54, high: 140.87, low: 132.34, close: 139.87, volume: 42572.21 },
      { date: "2024-09-25", open: 141.67, high: 146.19, low: 141.09, close: 141.21, volume: 48854.26 },
      { date: "2024-09-26", open: 140.86, high: 156.99, low: 140.37, close: 156.23, volume: 66837.32 },
      { date: "2024-09-27", open: 169.02, high: 187.47, low: 164.24, close: 187.47, volume: 116829.2 },
    ],
    bars: [
      { date: "2024-09-30", open: 219.63, high: 224.97, low: 201.01, close: 224.97, volume: 148235.86 },
      { date: "2024-10-08", open: 269.28, high: 269.97, low: 238.4, close: 269.97, volume: 171745.8 },
      { date: "2024-10-09", open: 248.27, high: 252.08, low: 219.63, close: 220.3, volume: 138188.68 },
      { date: "2024-10-10", open: 221.06, high: 231.08, low: 214.37, close: 220.39, volume: 75900.24 },
      { date: "2024-10-11", open: 214.85, high: 219.68, low: 198.24, close: 202.01, volume: 81144.28 },
      { date: "2024-10-14", open: 198.98, high: 203.07, low: 192.78, close: 202.43, volume: 69031.4 },
      { date: "2024-10-15", open: 202.63, high: 204.2, low: 193.86, close: 194.05, volume: 53803.17 },
      { date: "2024-10-16", open: 189.09, high: 195.66, low: 188.11, close: 191.82, volume: 40543.52 },
    ],
    initialState: {
      cash: 0,
      qty: 533.4186803221849,
      cost: 187.47,
      buyFillDay: 0,
      firstSellableDay: 1,
    },
    goals: {
      "twoStar": {
        "beatBuyHoldPp": 5
      },
      "threeStar": {
        "maxMddPct": 20,
        "maxOrders": 1
      }
    },
    validatedThreeStarActions: ["sell","hold","hold","hold","hold","hold","hold"],
    contentNote: "real pack window v3; take-profit theme",
    status: "published",
  },
  {
    levelIndex: 3,
    levelKey: "ch1-03",
    rewardFamilyId: "ch1-03",
    version: 3,
    title: "两笔机会",
    theme: "空仓、最多两笔实际成交订单",
    teachingBrief: "空仓起步，本关只有两笔成交预算。先想好买卖节奏，第三笔直接拒绝。",
    openStateHint: "开局空仓，订单上限 2 笔",
    gameDays: 6,
    maxOrders: 2,
    stockCode: PUZZLE_PUBLIC_STOCK_CODE,
    stockName: "残局·两笔",
    realStockCode: "300059",
    packRef: {
      stockIndex: 192,
      windowStartIndex: 178,
      historyLength: 30,
    },
    stockIndex: 192,
    windowStart: 178,
    // Embedded fallback for unit/integration tests on mini fixtures.
    history: [
      { date: "2024-08-13", open: 10.48, high: 10.65, low: 10.39, close: 10.64, volume: 1428033.5 },
      { date: "2024-08-14", open: 10.57, high: 10.67, low: 10.56, close: 10.57, volume: 1242392.16 },
      { date: "2024-08-15", open: 10.54, high: 10.74, low: 10.53, close: 10.59, volume: 2335212.48 },
      { date: "2024-08-16", open: 10.53, high: 10.57, low: 10.44, close: 10.49, volume: 1328057.95 },
      { date: "2024-08-19", open: 10.47, high: 10.63, low: 10.45, close: 10.53, volume: 1132543.53 },
      { date: "2024-08-20", open: 10.53, high: 10.58, low: 10.42, close: 10.44, volume: 1216429.33 },
      { date: "2024-08-21", open: 10.39, high: 10.48, low: 10.35, close: 10.43, volume: 782954.81 },
      { date: "2024-08-22", open: 10.47, high: 10.5, low: 10.1, close: 10.11, volume: 1691113.53 },
      { date: "2024-08-23", open: 10.12, high: 10.3, low: 10.11, close: 10.22, volume: 1355242.43 },
      { date: "2024-08-26", open: 10.22, high: 10.34, low: 10.19, close: 10.25, volume: 945200.78 },
      { date: "2024-08-27", open: 10.22, high: 10.24, low: 10.09, close: 10.13, volume: 824312.77 },
      { date: "2024-08-28", open: 10.1, high: 10.18, low: 10.03, close: 10.14, volume: 839135.47 },
      { date: "2024-08-29", open: 10.11, high: 10.36, low: 10.1, close: 10.31, volume: 1353469.1 },
      { date: "2024-08-30", open: 10.31, high: 10.87, low: 10.27, close: 10.71, volume: 3452666.31 },
      { date: "2024-09-02", open: 10.66, high: 10.7, low: 10.31, close: 10.32, volume: 2016129.9 },
      { date: "2024-09-03", open: 10.27, high: 10.45, low: 10.26, close: 10.38, volume: 1308934.74 },
      { date: "2024-09-04", open: 10.28, high: 10.49, low: 10.27, close: 10.38, volume: 1125028.52 },
      { date: "2024-09-05", open: 10.39, high: 10.62, low: 10.39, close: 10.57, volume: 1488530.63 },
      { date: "2024-09-06", open: 10.71, high: 10.79, low: 10.46, close: 10.48, volume: 2165132.22 },
      { date: "2024-09-09", open: 10.4, high: 10.57, low: 10.34, close: 10.47, volume: 1309103.52 },
      { date: "2024-09-10", open: 10.48, high: 10.52, low: 10.27, close: 10.44, volume: 1225406.88 },
      { date: "2024-09-11", open: 10.4, high: 10.49, low: 10.38, close: 10.45, volume: 940123.58 },
      { date: "2024-09-12", open: 10.45, high: 10.51, low: 10.35, close: 10.37, volume: 968415.91 },
      { date: "2024-09-13", open: 10.37, high: 10.46, low: 10.3, close: 10.3, volume: 968291.21 },
      { date: "2024-09-18", open: 10.32, high: 10.39, low: 10.23, close: 10.35, volume: 928580.43 },
      { date: "2024-09-19", open: 10.43, high: 10.97, low: 10.38, close: 10.68, volume: 3454168.95 },
      { date: "2024-09-20", open: 10.58, high: 10.7, low: 10.55, close: 10.68, volume: 1719761.33 },
      { date: "2024-09-23", open: 10.69, high: 10.74, low: 10.6, close: 10.65, volume: 1094177.14 },
      { date: "2024-09-24", open: 10.85, high: 11.88, low: 10.66, close: 11.87, volume: 8212805.67 },
      { date: "2024-09-25", open: 12.22, high: 12.7, low: 12.06, close: 12.32, volume: 9169733.99 },
    ],
    bars: [
      { date: "2024-09-26", open: 12.16, high: 14.18, low: 12.15, close: 13.99, volume: 10933872.79 },
      { date: "2024-09-27", open: 14.64, high: 16.79, low: 14.42, close: 16.79, volume: 18026541.9 },
      { date: "2024-09-30", open: 19.34, high: 20.14, low: 19.01, close: 20.14, volume: 15369515.82 },
      { date: "2024-10-08", open: 24.17, high: 24.17, low: 22.59, close: 24.17, volume: 13667677.57 },
      { date: "2024-10-09", open: 23.81, high: 28.77, low: 22.43, close: 24.7, volume: 34623505.97 },
      { date: "2024-10-10", open: 23.91, high: 24.37, low: 19.76, close: 20.39, volume: 23863266.68 },
    ],
    initialState: {
      cash: 100000,
      qty: 0,
      cost: 0,
      buyFillDay: null,
      firstSellableDay: 1,
    },
    goals: {
      "twoStar": {
        "beatBuyHoldPp": 5
      },
      "threeStar": {
        "maxMddPct": 25,
        "maxOrders": 2
      }
    },
    validatedThreeStarActions: ["buy","hold","sell","hold","hold"],
    contentNote: "real pack window v3; 2-order budget",
    status: "published",
  },
  {
    levelIndex: 4,
    levelKey: "ch1-04",
    rewardFamilyId: "ch1-04",
    version: 3,
    title: "明天才好卖",
    theme: "刚买入的锁定持仓",
    teachingBrief: "开局仓位受 T+1 锁定：首日不能卖，等到可卖日再决定持或走。",
    openStateHint: "开局满仓且 T+1 锁定，首日不可卖",
    gameDays: 8,
    maxOrders: 1,
    stockCode: PUZZLE_PUBLIC_STOCK_CODE,
    stockName: "残局·T+1",
    realStockCode: "300607",
    packRef: {
      stockIndex: 820,
      windowStartIndex: 210,
      historyLength: 30,
    },
    stockIndex: 820,
    windowStart: 210,
    // Embedded fallback for unit/integration tests on mini fixtures.
    history: [
      { date: "2024-09-30", open: 11.61, high: 12.85, low: 11.29, close: 12.48, volume: 211535.06 },
      { date: "2024-10-08", open: 14.52, high: 14.84, low: 12.89, close: 14.23, volume: 300105.26 },
      { date: "2024-10-09", open: 13.64, high: 13.64, low: 12.49, close: 12.57, volume: 179964.96 },
      { date: "2024-10-10", open: 12.64, high: 12.97, low: 12.28, close: 12.37, volume: 119057.51 },
      { date: "2024-10-11", open: 12.23, high: 12.32, low: 11.54, close: 11.73, volume: 93894.01 },
      { date: "2024-10-14", open: 11.85, high: 12.03, low: 11.44, close: 12.01, volume: 80067.44 },
      { date: "2024-10-15", open: 12, high: 12.54, low: 11.8, close: 12, volume: 109583.56 },
      { date: "2024-10-16", open: 11.73, high: 12.05, low: 11.64, close: 11.79, volume: 70216.43 },
      { date: "2024-10-17", open: 11.89, high: 12.01, low: 11.78, close: 11.79, volume: 63752.19 },
      { date: "2024-10-18", open: 11.69, high: 12.55, low: 11.67, close: 12.29, volume: 109191.81 },
      { date: "2024-10-21", open: 12.34, high: 12.81, low: 12.24, close: 12.69, volume: 135712.72 },
      { date: "2024-10-22", open: 12.74, high: 13.15, low: 12.62, close: 12.83, volume: 138111.2 },
      { date: "2024-10-23", open: 12.71, high: 12.89, low: 12.55, close: 12.6, volume: 106770.16 },
      { date: "2024-10-24", open: 12.49, high: 12.6, low: 12.32, close: 12.52, volume: 68395.25 },
      { date: "2024-10-25", open: 11.92, high: 12.45, low: 11.92, close: 12.41, volume: 146300.98 },
      { date: "2024-10-28", open: 12.31, high: 12.84, low: 12.12, close: 12.78, volume: 129415.11 },
      { date: "2024-10-29", open: 13, high: 13.23, low: 12.69, close: 12.7, volume: 152817.6 },
      { date: "2024-10-30", open: 12.71, high: 13.11, low: 12.56, close: 13.08, volume: 124570.36 },
      { date: "2024-10-31", open: 13.09, high: 13.29, low: 12.82, close: 13.03, volume: 149676.46 },
      { date: "2024-11-01", open: 12.94, high: 12.94, low: 12.19, close: 12.21, volume: 130220.68 },
      { date: "2024-11-04", open: 12.64, high: 14.64, low: 12.64, close: 14.64, volume: 226581.49 },
      { date: "2024-11-05", open: 15.57, high: 17.57, low: 15.33, close: 17.57, volume: 838639.31 },
      { date: "2024-11-06", open: 18.97, high: 21.09, low: 18.69, close: 20.44, volume: 1269928.75 },
      { date: "2024-11-07", open: 18.98, high: 19.48, low: 17.17, close: 18.15, volume: 1006046.54 },
      { date: "2024-11-08", open: 17.98, high: 19.93, low: 17.98, close: 18.23, volume: 914246.08 },
      { date: "2024-11-11", open: 17.33, high: 19.27, low: 17.15, close: 18.68, volume: 675273.56 },
      { date: "2024-11-12", open: 18.37, high: 19.09, low: 17.88, close: 18.58, volume: 614556.95 },
      { date: "2024-11-13", open: 18.48, high: 22.3, low: 18.28, close: 21.36, volume: 979678.28 },
      { date: "2024-11-14", open: 20.8, high: 22.64, low: 20.04, close: 21.33, volume: 978592.29 },
      { date: "2024-11-15", open: 20.71, high: 24.22, low: 19.97, close: 22.8, volume: 1146716.16 },
    ],
    bars: [
      { date: "2024-11-18", open: 22.97, high: 26.55, low: 20.97, close: 21.18, volume: 1130553.88 },
      { date: "2024-11-19", open: 20.29, high: 25.41, low: 20.29, close: 25.41, volume: 1451064.17 },
      { date: "2024-11-20", open: 26.12, high: 30.5, low: 24.99, close: 30.5, volume: 1504167.23 },
      { date: "2024-11-21", open: 30.5, high: 32.92, low: 28.9, close: 32.05, volume: 1582416.52 },
      { date: "2024-11-22", open: 30.47, high: 32.17, low: 29.08, close: 29.97, volume: 1107361.55 },
      { date: "2024-11-25", open: 30.3, high: 31.42, low: 27.87, close: 30.81, volume: 975154.04 },
      { date: "2024-11-26", open: 29.21, high: 29.39, low: 25.97, close: 26.77, volume: 938484.96 },
      { date: "2024-11-27", open: 25.49, high: 26.23, low: 24.76, close: 25.92, volume: 858043.82 },
    ],
    initialState: {
      cash: 0,
      qty: 4353.5045711798,
      cost: 22.97,
      buyFillDay: 1,
      firstSellableDay: 2,
    },
    goals: {
      "twoStar": {
        "beatBuyHoldPp": 1
      },
      "threeStar": {
        "maxMddPct": 18,
        "maxOrders": 1
      }
    },
    validatedThreeStarActions: ["hold","hold","sell","hold","hold","hold","hold"],
    contentNote: "real pack window v3; T+1 lock",
    status: "published",
  },
  {
    levelIndex: 5,
    levelKey: "ch1-05",
    rewardFamilyId: "ch1-05",
    version: 3,
    title: "震荡磨人",
    theme: "已有持仓、窄幅行情",
    teachingBrief: "窄幅震荡易破位。少动为上——控制次数，别在磨人区来回挨打。",
    openStateHint: "开局满仓；震荡少动，上限 2 笔",
    gameDays: 8,
    maxOrders: 2,
    stockCode: PUZZLE_PUBLIC_STOCK_CODE,
    stockName: "残局·震荡",
    realStockCode: "300779",
    packRef: {
      stockIndex: 954,
      windowStartIndex: 550,
      historyLength: 30,
    },
    stockIndex: 954,
    windowStart: 550,
    // Embedded fallback for unit/integration tests on mini fixtures.
    history: [
      { date: "2026-03-03", open: 71.45, high: 71.82, low: 69.2, close: 69.59, volume: 47405.52 },
      { date: "2026-03-04", open: 69.33, high: 72.83, low: 68.32, close: 69.9, volume: 65211.7 },
      { date: "2026-03-05", open: 69.26, high: 70.01, low: 66.42, close: 66.92, volume: 74144.86 },
      { date: "2026-03-06", open: 66.41, high: 69.35, low: 65.93, close: 68.62, volume: 53485.12 },
      { date: "2026-03-09", open: 69.98, high: 75.6, low: 69.91, close: 73.26, volume: 144204.51 },
      { date: "2026-03-10", open: 72.87, high: 73.79, low: 71.84, close: 73.4, volume: 64077.19 },
      { date: "2026-03-11", open: 72.87, high: 75.4, low: 72.63, close: 72.94, volume: 61782.48 },
      { date: "2026-03-12", open: 73.28, high: 75.33, low: 72.4, close: 72.85, volume: 52782.36 },
      { date: "2026-03-13", open: 72.85, high: 76.26, low: 72.72, close: 73.28, volume: 101960.94 },
      { date: "2026-03-16", open: 73.55, high: 74.98, low: 70.23, close: 71.42, volume: 81071.12 },
      { date: "2026-03-17", open: 71.28, high: 71.4, low: 67.55, close: 67.69, volume: 79978.02 },
      { date: "2026-03-18", open: 67.26, high: 68.08, low: 66.06, close: 68.05, volume: 46031.09 },
      { date: "2026-03-19", open: 67.48, high: 70.98, low: 66.06, close: 67.56, volume: 71183.2 },
      { date: "2026-03-20", open: 66.78, high: 66.91, low: 63.55, close: 64.43, volume: 66417.4 },
      { date: "2026-03-23", open: 63.48, high: 64.08, low: 60.69, close: 61.21, volume: 62585.02 },
      { date: "2026-03-24", open: 62.36, high: 62.59, low: 60.16, close: 62.1, volume: 43541.84 },
      { date: "2026-03-25", open: 61.79, high: 63.15, low: 61.64, close: 62.41, volume: 39308.37 },
      { date: "2026-03-26", open: 62.26, high: 62.41, low: 59.84, close: 60.26, volume: 41098 },
      { date: "2026-03-27", open: 59.27, high: 64.62, low: 58.74, close: 62.5, volume: 72130.45 },
      { date: "2026-03-30", open: 62.91, high: 67.72, low: 62.88, close: 65.63, volume: 81693.3 },
      { date: "2026-03-31", open: 66.19, high: 67.48, low: 64.88, close: 65.21, volume: 62924.54 },
      { date: "2026-04-01", open: 66, high: 69.77, low: 65.51, close: 69.08, volume: 94314.39 },
      { date: "2026-04-02", open: 68.4, high: 68.44, low: 64.98, close: 65.56, volume: 63736.01 },
      { date: "2026-04-03", open: 65.56, high: 65.83, low: 62.27, close: 62.84, volume: 50040.95 },
      { date: "2026-04-07", open: 62.34, high: 64.25, low: 61.76, close: 63.27, volume: 32118.21 },
      { date: "2026-04-08", open: 64.26, high: 66.54, low: 63.87, close: 66.54, volume: 52951.35 },
      { date: "2026-04-09", open: 65.69, high: 67.41, low: 65.23, close: 66.16, volume: 40709.21 },
      { date: "2026-04-10", open: 65.98, high: 67.61, low: 65.97, close: 66.28, volume: 39142.28 },
      { date: "2026-04-13", open: 66.08, high: 66.97, low: 64.98, close: 65.11, volume: 38342.91 },
      { date: "2026-04-14", open: 65.69, high: 66.26, low: 63.91, close: 64.62, volume: 41533.88 },
    ],
    bars: [
      { date: "2026-04-15", open: 64.61, high: 65.16, low: 63.48, close: 63.66, volume: 37576.98 },
      { date: "2026-04-16", open: 63.56, high: 65.23, low: 63.05, close: 64.7, volume: 48631.18 },
      { date: "2026-04-17", open: 64.34, high: 65.33, low: 63.65, close: 64.62, volume: 42298.08 },
      { date: "2026-04-20", open: 64.34, high: 66.18, low: 63.91, close: 65.06, volume: 47780.8 },
      { date: "2026-04-21", open: 64.98, high: 65.21, low: 63.48, close: 64.81, volume: 38959.96 },
      { date: "2026-04-22", open: 64.27, high: 64.66, low: 63.05, close: 63.1, volume: 50713.74 },
      { date: "2026-04-23", open: 63.19, high: 64.85, low: 61.53, close: 61.88, volume: 53523.5 },
      { date: "2026-04-24", open: 61.41, high: 62.05, low: 50.01, close: 50.81, volume: 200932.92 },
    ],
    initialState: {
      cash: 0,
      qty: 1547.748026621266,
      cost: 64.61,
      buyFillDay: 0,
      firstSellableDay: 1,
    },
    goals: {
      "twoStar": {
        "beatBuyHoldPp": 2
      },
      "threeStar": {
        "maxMddPct": 12,
        "maxOrders": 2
      }
    },
    validatedThreeStarActions: ["hold","hold","hold","sell","hold","hold","hold"],
    contentNote: "real pack window v3; chop theme",
    status: "published",
  },
  {
    levelIndex: 6,
    levelKey: "ch1-06",
    rewardFamilyId: "ch1-06",
    version: 3,
    title: "最后几个交易日",
    theme: "带持仓进入短窗口",
    teachingBrief: "短窗末日只估值、不能下单。中途卖出 vs 扛到末日收盘，结果可能差一截。",
    openStateHint: "开局满仓，末日仅估值",
    gameDays: 7,
    maxOrders: 1,
    stockCode: PUZZLE_PUBLIC_STOCK_CODE,
    stockName: "残局·到期",
    realStockCode: "300573",
    packRef: {
      stockIndex: 862,
      windowStartIndex: 178,
      historyLength: 30,
    },
    stockIndex: 862,
    windowStart: 178,
    // Embedded fallback for unit/integration tests on mini fixtures.
    history: [
      { date: "2024-08-13", open: 51.27, high: 51.51, low: 49.86, close: 50.67, volume: 44761.99 },
      { date: "2024-08-14", open: 50.81, high: 53.41, low: 49.73, close: 52.6, volume: 70072.02 },
      { date: "2024-08-15", open: 52.94, high: 53.17, low: 51.17, close: 51.78, volume: 59318.72 },
      { date: "2024-08-16", open: 51.78, high: 53.39, low: 51.18, close: 51.86, volume: 40277.86 },
      { date: "2024-08-19", open: 51.83, high: 51.98, low: 47.89, close: 47.91, volume: 70740 },
      { date: "2024-08-20", open: 47.77, high: 48.49, low: 46.19, close: 46.8, volume: 63694.37 },
      { date: "2024-08-21", open: 46.8, high: 47.02, low: 45.42, close: 45.97, volume: 40916 },
      { date: "2024-08-22", open: 46.49, high: 47.63, low: 45.72, close: 46.18, volume: 35692.13 },
      { date: "2024-08-23", open: 45.86, high: 46.32, low: 44.82, close: 45.43, volume: 29714.28 },
      { date: "2024-08-26", open: 45.39, high: 46.26, low: 44.67, close: 45.05, volume: 26845.58 },
      { date: "2024-08-27", open: 45.29, high: 47.72, low: 44.99, close: 47.15, volume: 58337.32 },
      { date: "2024-08-28", open: 47.1, high: 50.14, low: 46.3, close: 47.13, volume: 79159.3 },
      { date: "2024-08-29", open: 42.42, high: 43.83, low: 39.46, close: 41.28, volume: 135700.94 },
      { date: "2024-08-30", open: 41, high: 41.99, low: 39.71, close: 40.58, volume: 108157.35 },
      { date: "2024-09-02", open: 40.5, high: 41.21, low: 38.45, close: 38.48, volume: 99790.56 },
      { date: "2024-09-03", open: 38.48, high: 39.46, low: 37.94, close: 38.31, volume: 60004.32 },
      { date: "2024-09-04", open: 38.1, high: 38.85, low: 37.83, close: 37.97, volume: 44288.54 },
      { date: "2024-09-05", open: 38.32, high: 39.97, low: 38.11, close: 38.41, volume: 58711.18 },
      { date: "2024-09-06", open: 38.79, high: 38.79, low: 37.21, close: 37.22, volume: 43688.12 },
      { date: "2024-09-09", open: 36.99, high: 37.46, low: 36.22, close: 36.44, volume: 47274.49 },
      { date: "2024-09-10", open: 36.53, high: 36.61, low: 35.42, close: 36.2, volume: 47670.7 },
      { date: "2024-09-11", open: 36.2, high: 36.63, low: 35.73, close: 35.95, volume: 37871.37 },
      { date: "2024-09-12", open: 36.05, high: 36.58, low: 35.08, close: 35.12, volume: 42561.38 },
      { date: "2024-09-13", open: 34.98, high: 35.09, low: 33.84, close: 33.88, volume: 53847.68 },
      { date: "2024-09-18", open: 33.88, high: 34.04, low: 32.67, close: 32.92, volume: 52823.87 },
      { date: "2024-09-19", open: 32.92, high: 34.13, low: 32.62, close: 33.1, volume: 59390.95 },
      { date: "2024-09-20", open: 32.89, high: 32.98, low: 31.81, close: 32.08, volume: 54301.81 },
      { date: "2024-09-23", open: 32.09, high: 32.32, low: 30.82, close: 30.85, volume: 56377.57 },
      { date: "2024-09-24", open: 31.42, high: 33.39, low: 30.58, close: 33.35, volume: 117074.4 },
      { date: "2024-09-25", open: 34.03, high: 37.03, low: 34.03, close: 35.74, volume: 152594.79 },
    ],
    bars: [
      { date: "2024-09-26", open: 35.73, high: 38.88, low: 35.25, close: 38.81, volume: 142198.88 },
      { date: "2024-09-27", open: 39.83, high: 45.01, low: 39.06, close: 42.64, volume: 213658.94 },
      { date: "2024-09-30", open: 45.65, high: 50.93, low: 43.45, close: 50.51, volume: 263008.89 },
      { date: "2024-10-08", open: 60.18, high: 60.18, low: 47.7, close: 57.98, volume: 317293.08 },
      { date: "2024-10-09", open: 51.84, high: 53.39, low: 46.38, close: 46.38, volume: 233291.17 },
      { date: "2024-10-10", open: 45.56, high: 48.4, low: 43.45, close: 44.13, volume: 155153.56 },
      { date: "2024-10-11", open: 43.83, high: 44.33, low: 40.44, close: 41.17, volume: 129388.68 },
    ],
    initialState: {
      cash: 0,
      qty: 2797.985450475657,
      cost: 35.74,
      buyFillDay: 0,
      firstSellableDay: 1,
    },
    goals: {
      "twoStar": {
        "beatBuyHoldPp": 2
      },
      "threeStar": {
        "maxMddPct": 12,
        "maxOrders": 1
      }
    },
    validatedThreeStarActions: ["hold","hold","sell","hold","hold","hold"],
    contentNote: "real pack window v3; terminal valuation",
    status: "published",
  },
];

/** Synthetic pre-window context so #gameScreen / review K-line is not a bare 1-bar stub. */
export function buildContextHistory(firstBar, count = 30) {
  const out = [];
  if (!firstBar || count <= 0) return out;
  const anchor = Number(firstBar.open) || Number(firstBar.close) || 10;
  let px = anchor;
  const vols = Number(firstBar.volume) || 1000;
  for (let i = count; i >= 1; i -= 1) {
    const drift = ((i % 7) - 3) * 0.015 * anchor;
    const open = Math.max(0.5, +(px - drift * 0.3).toFixed(2));
    const close = Math.max(0.5, +(px + drift * 0.2).toFixed(2));
    const high = Math.max(open, close, +(Math.max(open, close) + 0.08 * anchor).toFixed(2));
    const low = Math.min(open, close, +(Math.min(open, close) - 0.08 * anchor).toFixed(2));
    const day = String(i).padStart(2, "0");
    out.push({
      date: `2024-04-${day}`,
      open,
      high,
      low,
      close,
      volume: vols,
    });
    px = open;
  }
  out.reverse();
  const last = out[out.length - 1];
  if (last) {
    last.close = +anchor.toFixed(2);
    last.high = Math.max(last.high, last.open, last.close);
    last.low = Math.min(last.low, last.open, last.close);
  }
  return out;
}

/**
 * Build immutable snapshot for seed / entries.
 * Pack refs → live dataset slice when resolvable; else embedded/synthetic bars.
 */
export function buildLevelSnapshot(def) {
  let history;
  let bars;
  let realStockCode = def.realStockCode || null;
  let stockIndex = Number.isInteger(def.stockIndex) ? def.stockIndex : -1;
  let windowStartIndex = Number.isInteger(def.windowStart) ? def.windowStart : -1;
  let historyLength;

  const packRef = def.packRef;
  if (packRef && Number.isInteger(packRef.stockIndex) && Number.isInteger(packRef.windowStartIndex)) {
    try {
      const picked = pickPuzzleWindow({
        stockIndex: packRef.stockIndex,
        windowStartIndex: packRef.windowStartIndex,
        gameDays: def.gameDays,
        historyLength: packRef.historyLength ?? 30,
      });
      history = picked.snapshot.history;
      bars = picked.snapshot.bars.map((b, i) => ({
        ...b,
        volume: def.bars?.[i]?.volume ?? 0,
      }));
      realStockCode = picked.stockCode;
      stockIndex = picked.stockIndex;
      windowStartIndex = picked.windowStartIndex;
      historyLength = picked.historyLength;
    } catch {
      // Mini fixture / missing pack pin — fall through to embedded bars.
    }
  }

  if (!bars) {
    bars = def.bars;
    history =
      Array.isArray(def.history) && def.history.length
        ? def.history
        : buildContextHistory(def.bars?.[0], 30);
    historyLength = history.length;
  }
  if (historyLength == null) historyLength = history.length;

  const snapshot = {
    ruleVersion: PUZZLE_RULE_VERSION,
    fillMode: PUZZLE_FILL_MODE,
    gameDays: def.gameDays,
    historyLength,
    history,
    bars,
    initialState: def.initialState,
    maxOrders: def.maxOrders,
    goals: def.goals,
    levelKey: def.levelKey,
    rewardFamilyId: def.rewardFamilyId,
    // Server-only identity; clients mask like classic ******.
    stockCode: realStockCode || def.stockCode || PUZZLE_PUBLIC_STOCK_CODE,
    stockName: def.stockName,
    stockIndex,
    windowStartIndex,
    packRef: packRef || null,
    teachingBrief: def.teachingBrief || null,
    openStateHint: def.openStateHint || null,
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

export function levelDefByKey(levelKey) {
  return CHAPTER1_LEVEL_DEFS.find((d) => d.levelKey === levelKey) || null;
}
