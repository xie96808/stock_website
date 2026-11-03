// 开一局紧凑首屏：K 线 + 成交量不用下滑；价格纵轴只在开一局隐藏；其余模式不变。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildKlineOption } from "../js/kline-option.js";
import { stakeChartHeight, STAKE_CHART_MIN_PX, STAKE_CHART_MAX_PX } from "../js/stake-chart-fit.js";
import { makeAnalysisKline, HIST_LEN } from "./fixtures/analysis-sample.js";

const css = readFileSync(new URL("../css/stake-play.css", import.meta.url), "utf8");
const game = readFileSync(new URL("../js/game.js", import.meta.url), "utf8");
const bars = makeAnalysisKline().slice(0, HIST_LEN + 30);

test("hideYAxis drops the price labels and the left gutter in game mode only", () => {
  const normal = buildKlineOption({ bars, historyLength: HIST_LEN, mode: "game" });
  const hidden = buildKlineOption({ bars, historyLength: HIST_LEN, mode: "game", hideYAxis: true });
  assert.notEqual(normal.yAxis[0].axisLabel.show, false);
  assert.equal(hidden.yAxis[0].axisLabel.show, false);
  assert.ok(hidden.grid[0].left < normal.grid[0].left, "grid reclaims the label gutter");
  assert.equal(hidden.grid[0].left, hidden.grid[1].left, "price + volume grids stay aligned");
  // volume band + MA legend are still there
  assert.ok(hidden.series.some((s) => s.name === "成交量"));
  assert.deepEqual(hidden.legend.data, normal.legend.data);
});

test("hideYAxis never changes the result / pvp charts", () => {
  const a = buildKlineOption({ bars, historyLength: HIST_LEN, mode: "result" });
  const b = buildKlineOption({ bars, historyLength: HIST_LEN, mode: "result", hideYAxis: true });
  assert.deepEqual(b.yAxis, a.yAxis);
  assert.deepEqual(b.grid, a.grid);
});

test("game.js asks for the hidden axis only for stake sessions", () => {
  assert.match(game, /hideYAxis:\s*session\.gameKind === 'stake'/);
});

test("stakeChartHeight fits above the fixed action bar and is clamped", () => {
  assert.equal(stakeChartHeight({ viewportH: 844, top: 295, actionH: 141 }), 400);
  assert.equal(stakeChartHeight({ viewportH: 667, top: 291, actionH: 141 }), 227);
  assert.equal(stakeChartHeight({ viewportH: 300, top: 295, actionH: 141 }), STAKE_CHART_MIN_PX);
  assert.equal(stakeChartHeight({ viewportH: 3000, top: 100, actionH: 0 }), STAKE_CHART_MAX_PX);
  assert.equal(stakeChartHeight({ viewportH: NaN, top: 0, actionH: 0 }), STAKE_CHART_MIN_PX);
});

test("compact stake layout: outer chart card removed, title visually hidden, chart height from the fit var", () => {
  assert.match(css, /game-screen--stake > \.sg-backbar \{ margin-bottom: -\d+px; \}/);
  assert.match(css, /game-screen--stake \.market-stage \{[^}]*box-shadow: none;/);
  assert.match(css, /game-screen--stake \.market-stage-header \{[^}]*clip-path: inset\(50%\)/);
  assert.doesNotMatch(css, /game-screen--stake \.market-stage \{[^}]*inset 0 0 0 5px/, "no gold inset on the chart card any more");
  assert.match(css, /height: var\(--sp-chart-h/);
  assert.match(game, /initStakeChartFit\(\)/);
});
