// ========== GAME STATE ==========
export const gameState = {
    stocksData: [],
    currentStock: null,
    gameKline: [],        // history + 31 days of kline data
    historyLength: 0,     // number of history days before game starts
    currentDay: 1,        // 1-30
    position: 'empty',    // 'empty' | 'holding' | 'locked'
    costBasis: 0,
    totalReturn: 1,       // Multiplicative return
    tradeHistory: [],
    pendingAction: null,
    holdingDays: 0,
    tradeGains: [],
    bsScore: null,
    bestPoints: null
};

export const chartRefs = {
    klineChart: null,
    resultChart: null
};

export const quizState = {
    questions: [], currentIndex: 0, score: 0,
    answers: [], answered: false, charts: []
};
