import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);

test("ready window is 15 seconds on server and in the room clock placeholder", async () => {
  const { READY_MS } = await import("../../server/src/lib/pvp/config.js");
  assert.equal(READY_MS, 15_000);
  const html = readFileSync(new URL("index.html", root), "utf8");
  assert.match(html, /id="pvpReadyClockNum">15</);
  const cfg = readFileSync(new URL("server/src/lib/pvp/config.js", root), "utf8");
  assert.match(cfg, /READY_MS = 15_000/);
  assert.doesNotMatch(cfg, /READY_MS = 30_000/);
});

test("result screen imports formatCoin so rating paint cannot throw ReferenceError", () => {
  const resultJs = readFileSync(new URL("js/pvp/result.js", root), "utf8");
  assert.match(resultJs, /formatCoin/);
  assert.match(
    resultJs,
    /import \{[^}]*formatCoin[^}]*\} from "\.\/copy\.js"/,
  );
  assert.match(resultJs, /paintRating\(view\)/);
  assert.match(resultJs, /try \{ paintRating\(view\); \}/);
  // Atomic rating paint: hide first when unscored; only unhide after text is set.
  assert.match(resultJs, /box\.hidden = false/);
  assert.match(resultJs, /pvpResultRatingRange/);
  assert.match(resultJs, /marketMissing/);
  assert.match(resultJs, /paintResultBody/);
  const html = readFileSync(new URL("index.html", root), "utf8");
  assert.match(html, /id="pvpBattleTop"/);
  assert.match(html, /id="pvpTradeSegment"/);
  // Per-hand timer stays 30s (design); only READY_MS is 15s.
  assert.match(html, /id="pvpClockNum">30</);
});
