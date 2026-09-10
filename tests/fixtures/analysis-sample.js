/** Deterministic OHLC fixture for analysis-pure / kline-option characterization. */

function bar(day, o, h, l, c, vol = 100000) {
  const y = 2024;
  const m = String(Math.floor((day - 1) / 28) + 1).padStart(2, '0');
  const d = String(((day - 1) % 28) + 1).padStart(2, '0');
  return {
    date: `${y}-${m}-${d}`,
    open: o,
    high: h,
    low: l,
    close: c,
    volume: vol,
  };
}

/**
 * historyLength=20 + 30 game days.
 * Crafted so golden/death crosses and a few patterns appear without peeking.
 */
export const HIST_LEN = 20;
export const GAME_DAYS = 30;

export function makeAnalysisKline() {
  const bars = [];
  // History: gentle uptrend into game window
  for (let i = 0; i < HIST_LEN; i++) {
    const c = 10 + i * 0.05;
    bars.push(bar(i + 1, c - 0.02, c + 0.05, c - 0.05, c, 80000 + i * 1000));
  }
  // Game days: dip, hammer-ish bottom, rally with vol spike, then top with shooting star-ish
  const gameSpecs = [
    // 1-4 down
    [10.9, 11.0, 10.7, 10.75, 90000],
    [10.75, 10.8, 10.5, 10.55, 95000],
    [10.55, 10.6, 10.3, 10.35, 100000],
    [10.35, 10.4, 10.0, 10.05, 110000],
    // 5 hammer-ish recovery
    [10.05, 10.2, 9.7, 10.18, 150000],
    // 6-8 up
    [10.18, 10.4, 10.1, 10.35, 120000],
    [10.35, 10.6, 10.3, 10.55, 130000],
    [10.55, 10.9, 10.5, 10.85, 180000],
    // 9 big yang
    [10.85, 11.4, 10.8, 11.35, 220000],
    // 10-12 continue
    [11.35, 11.5, 11.2, 11.45, 140000],
    [11.45, 11.6, 11.3, 11.55, 135000],
    [11.55, 11.7, 11.4, 11.65, 130000],
    // 13 doji-ish after up
    [11.65, 11.72, 11.58, 11.66, 90000],
    // 14-16 chop
    [11.66, 11.8, 11.5, 11.55, 100000],
    [11.55, 11.7, 11.4, 11.6, 105000],
    [11.6, 11.75, 11.45, 11.5, 110000],
    // 17 big yin
    [11.5, 11.55, 10.9, 10.95, 200000],
    // 18-20 down
    [10.95, 11.0, 10.7, 10.75, 120000],
    [10.75, 10.8, 10.5, 10.55, 115000],
    [10.55, 10.6, 10.3, 10.4, 110000],
    // 21 engulfing up
    [10.35, 10.9, 10.3, 10.85, 160000],
    // 22-25 up
    [10.85, 11.1, 10.8, 11.05, 125000],
    [11.05, 11.3, 11.0, 11.25, 130000],
    [11.25, 11.5, 11.2, 11.45, 140000],
    [11.45, 11.7, 11.4, 11.65, 145000],
    // 26 shooting-star-ish
    [11.65, 12.2, 11.55, 11.6, 170000],
    // 27-30 settle down a bit
    [11.6, 11.7, 11.4, 11.45, 120000],
    [11.45, 11.5, 11.2, 11.25, 115000],
    [11.25, 11.35, 11.1, 11.2, 110000],
    [11.2, 11.3, 11.05, 11.15, 105000],
  ];
  gameSpecs.forEach((s, i) => {
    bars.push(bar(HIST_LEN + i + 1, s[0], s[1], s[2], s[3], s[4]));
  });
  return bars;
}

export const SAMPLE_TRADES_SAME_CLOSE = [
  { type: 'buy', day: 5, price: 10.18 },
  { type: 'sell', day: 9, price: 11.35 },
  { type: 'buy', day: 21, price: 10.85 },
  { type: 'sell', day: 25, price: 11.65 },
];

export const SAMPLE_TRADE_GAINS = [11.49, 7.37];
