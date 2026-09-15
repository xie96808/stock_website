import assert from "node:assert/strict";

const OHLCV_KEYS = ["date", "open", "high", "low", "close", "volume"];

/**
 * Shared GameWindowDTO shape assertions for classic + daily integration tests.
 * @param {object} win
 * @param {{ historyLength?: number, gameDays?: number, label?: string }} [opts]
 */
export function assertGameWindowDtoShape(win, opts = {}) {
  const label = opts.label || "window";
  assert.ok(win, `${label} must be present`);
  assert.equal(win.v, 1, `${label}.v`);
  if (opts.historyLength != null) {
    assert.equal(win.historyLength, opts.historyLength, `${label}.historyLength`);
  }
  if (opts.gameDays != null) {
    assert.equal(win.gameDays, opts.gameDays, `${label}.gameDays`);
  }
  assert.ok(Array.isArray(win.history), `${label}.history array`);
  assert.ok(Array.isArray(win.bars), `${label}.bars array`);
  assert.equal(win.history.length, win.historyLength, `${label}.history.length`);
  assert.equal(win.bars.length, win.gameDays, `${label}.bars.length`);
  assert.ok(win.bars.length > 0, `${label}.bars non-empty`);
  assert.ok(Number.isFinite(win.bars[0].volume), `${label}.bars[0].volume`);
  if (win.history.length > 0) {
    assert.ok(Number.isFinite(win.history[0].volume), `${label}.history[0].volume`);
  }
  for (const k of OHLCV_KEYS) {
    assert.ok(k in win.bars[0], `${label}.bars[0] missing ${k}`);
    if (win.history.length > 0) {
      assert.ok(k in win.history[0], `${label}.history[0] missing ${k}`);
    }
  }
}

/**
 * Assert two window DTOs describe the same playable series (lengths + first close).
 */
export function assertGameWindowDtoMatch(actual, expected, label = "window") {
  assertGameWindowDtoShape(actual, {
    historyLength: expected.historyLength,
    gameDays: expected.gameDays,
    label,
  });
  assert.equal(actual.bars[0].close, expected.bars[0].close, `${label}.bars[0].close`);
  if (actual.history.length && expected.history.length) {
    assert.equal(
      actual.history[0].close,
      expected.history[0].close,
      `${label}.history[0].close`
    );
  }
}
