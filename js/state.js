// ========== GAME STATE ==========
// In-game session lifecycle (start / settle / share meta) goes through
// js/game-session.js. This object remains the shared blackboard for
// Phase-1 export / window compat — do not big-bang rename fields here.
export const gameState = {
    stocksData: [],
    currentStock: null,
    gameKline: [],
    historyLength: 0,
    currentDay: 1,
    position: "empty",
    costBasis: 0,
    totalReturn: 1,
    tradeHistory: [],
    valuation: null,
    actions: [],
    pendingAction: null,
    holdingDays: 0,
    tradeGains: [],
    bsScore: null,
    bestPoints: null,
    fillMode: "next_open",
    lastBuyFillDay: null,
    ruleVersion: "sim30-mtm-v1",
    returnPpm: null,
    returnPct: null,
    // Stage 3 cloud
    cloudMode: false,
    cloudGameId: null,
    datasetVersion: null,
    saveStatus: null, // null | saving | saved | retry | fail
    saveError: null,
    practiceOnly: false,
    // Settlement share / leaderboard meta (filled after cloud finish when available)
    shareRank: null,
    shareBoardTotal: null,
    shareBeatPct: null,
};

export const chartRefs = {
    klineChart: null,
    resultChart: null
};

export const quizState = {
    questions: [], currentIndex: 0, score: 0,
    answers: [], answered: false, charts: []
};
