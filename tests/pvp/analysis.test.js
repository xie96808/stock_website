import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { makeBars, holds } from "../../shared/fixtures/golden.js";
import {
  PVP_ANALYSIS_VERSION,
  buildPvpAnalysis,
  divergenceText,
  pickDivergences,
  projectReplay,
} from "../../shared/pvpAnalysis.js";

function sha(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

test("divergences keep the three largest gap changes and do not claim a cause", () => {
  const picked = pickDivergences({
    actionsA: ["buy", "sell", "hold", "buy"],
    actionsB: ["sell", "hold", "buy", "sell"],
    // round N is paired with the NEXT day's change: ppm[N+1] - ppm[N]
    ppmA: [0, 1, 51, 54, 104, 110],
    ppmB: [0, 0, 0, 0, 0, 0],
  });
  assert.deepEqual(picked.map((row) => row.round), [1, 3, 4]);
  assert.deepEqual(picked.map((row) => row.gapChangePpm), [50, 50, 6]);
  // a round whose next day is not revealed yet is skipped (no ppm[N+1])
  const early = pickDivergences({
    actionsA: ["buy", "sell"], actionsB: ["hold", "hold"],
    ppmA: [0, 0, 10], ppmB: [0, 0, 0],
  });
  assert.deepEqual(early.map((row) => [row.round, row.gapChangePpm]), [[1, 10]]);
  const text = divergenceText({ round: 2, me: "sell", opponent: "hold", gapChangePpm: 82000 });
  assert.match(text, /不能据此断定是这次操作造成的/);
  assert.equal(text.includes("因为"), false);
  assert.match(text, /\+8\.20 个百分点/);
  assert.match(text, /第 2 回合/);
  assert.match(text, /第 3 个交易日开盘成交/);
  assert.match(divergenceText({ round: 29, me: "buy", opponent: "hold", gapChangePpm: -1000 }), /第 30 个交易日（终局估值）开盘成交.*-0\.10 个百分点/);
});

test("replay is deterministic, seat 2 flips the gap, and the module stays off the browser analysis", () => {
  const shared = readFileSync(new URL("../../shared/pvpAnalysis.js", import.meta.url), "utf8");
  const server = readFileSync(new URL("../../server/src/lib/pvp/analysis.js", import.meta.url), "utf8");
  assert.equal(shared.includes("analysis-pure"), false);
  assert.equal(server.includes("analysis-pure"), false);
  assert.equal(shared.includes("computeBSReport"), false);
  assert.equal(server.includes("computeBSReport"), false);

  const bars = makeBars({ 2: { open: 10, close: 12 }, 30: { open: 12, close: 13 } });
  const input = {
    bars,
    seat1Actions: ["buy", ...holds(28)],
    seat2Actions: holds(29),
    revealedBars: 30,
    completed: true,
  };
  const first = buildPvpAnalysis(input);
  const second = buildPvpAnalysis(input);
  assert.equal(first.version, PVP_ANALYSIS_VERSION);
  assert.deepEqual(second, first);
  assert.equal(sha(JSON.stringify(first)), sha(JSON.stringify(second)));
  assert.equal(typeof first.buyHoldPpm, "number");

  const mine = projectReplay(first, 1);
  const theirs = projectReplay(first, 2);
  assert.equal(mine.status, "ready");
  assert.ok(mine.divergences.length >= 1);
  assert.equal(mine.divergences.length <= 3, true);
  assert.equal(theirs.divergences[0].gapChangePpm, -mine.divergences[0].gapChangePpm);
  assert.equal(theirs.divergences[0].me, mine.divergences[0].opponent);
  assert.equal(mine.divergences[0].text.includes("因为"), false);
  const projected = JSON.stringify(mine);
  assert.equal(projected.includes("2024-01"), false);
  assert.equal(projected.includes("stockCode"), false);
  assert.equal(projected.includes("hash"), false);

  assert.throws(
    () => buildPvpAnalysis({ ...input, seat1Actions: holds(28), seat2Actions: holds(28) }),
    /full action tail/
  );
  const partial = buildPvpAnalysis({
    bars,
    seat1Actions: [],
    seat2Actions: [],
    revealedBars: 1,
    completed: false,
  });
  assert.equal(partial.buyHoldPpm, null);
  assert.equal(partial.revealedBars, 1);
  assert.deepEqual(projectReplay(partial, 2).divergences, []);
});
