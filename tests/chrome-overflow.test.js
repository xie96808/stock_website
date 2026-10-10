import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldCollapseChrome } from '../js/chrome-overflow.js';

test('shouldCollapseChrome: desktop never collapses', () => {
  assert.equal(
    shouldCollapseChrome({
      viewportWidth: 900,
      leftRight: 400,
      rightLeft: 410,
      currentlyCollapsed: false,
    }),
    false,
  );
  assert.equal(
    shouldCollapseChrome({
      viewportWidth: 1200,
      leftRight: 500,
      rightLeft: 505,
      currentlyCollapsed: true,
    }),
    false,
  );
});

test('shouldCollapseChrome: ≤480 always collapses', () => {
  assert.equal(
    shouldCollapseChrome({
      viewportWidth: 480,
      leftRight: 100,
      rightLeft: 400,
      currentlyCollapsed: false,
    }),
    true,
  );
  assert.equal(
    shouldCollapseChrome({
      viewportWidth: 360,
      leftRight: 80,
      rightLeft: 300,
      currentlyCollapsed: false,
    }),
    true,
  );
});

test('shouldCollapseChrome: mid-width uses gap + hysteresis', () => {
  assert.equal(
    shouldCollapseChrome({
      viewportWidth: 700,
      leftRight: 200,
      rightLeft: 210, // gap 10 < 16
      currentlyCollapsed: false,
    }),
    true,
  );
  assert.equal(
    shouldCollapseChrome({
      viewportWidth: 700,
      leftRight: 200,
      rightLeft: 280, // gap 80
      currentlyCollapsed: false,
    }),
    false,
  );
  // Collapsed: need expandGap (48) to reopen
  assert.equal(
    shouldCollapseChrome({
      viewportWidth: 700,
      leftRight: 200,
      rightLeft: 230, // gap 30 < 48
      currentlyCollapsed: true,
    }),
    true,
  );
  assert.equal(
    shouldCollapseChrome({
      viewportWidth: 700,
      leftRight: 200,
      rightLeft: 260, // gap 60 ≥ 48
      currentlyCollapsed: true,
    }),
    false,
  );
});
