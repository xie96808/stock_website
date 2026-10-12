import test from "node:test";
import assert from "node:assert/strict";
import { buildPvpKlineAnalysis } from "../../js/pvp/analysis-view.js";

function bars(count, slope) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const close = 10 + i * slope;
    out.push({
      label: i < 30 ? `h${i + 1}` : `d${i - 29}`,
      open: close - 0.2,
      close,
      low: close - 0.5,
      high: close + 0.4,
      volume: 1 + (i % 5),
    });
  }
  return out;
}

test("completed battle analysis includes the solo wave writeup and says it does not decide the match", () => {
  const all = bars(60, 0.08);
  const view = {
    terminal: { type: "completed" },
    me: { returnPpm: 120000 },
    market: { historyLength: 30, history: all.slice(0, 30), bars: all.slice(30) },
    resolvedActions: [
      { round: 1, me: "buy" },
      { round: 4, me: "sell" },
    ],
  };
  const built = buildPvpKlineAnalysis(view);
  assert.ok(built);
  assert.match(built.html, /波段分析/);
  assert.match(built.html, /当时信号/);
  assert.match(built.html, /操作复盘/);
  assert.match(built.html, /不决定胜负/);
  assert.match(built.html, /pvp-up/);
  assert.doesNotMatch(built.html, /下面是这段行情|技术复盘/);
  assert.doesNotMatch(built.html, /h1|h30/);
});

test("a missing market does not invent an analysis", () => {
  assert.equal(buildPvpKlineAnalysis({ market: null }), null);
});
