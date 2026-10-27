import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { countOpenOverlays } from '../js/controls.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

/** Minimal DOM stand-in: elements matched by the selector, each with a render state. */
function fakeRoot(elements) {
  return { querySelectorAll: () => elements.map((rendered) => ({ getClientRects: () => (rendered ? [{}] : []) })) };
}

test('only rendered overlays keep the page locked', () => {
  assert.equal(countOpenOverlays(fakeRoot([])), 0);
  assert.equal(countOpenOverlays(fakeRoot([false])), 0, 'a stray .is-open inside a closed sheet does not count');
  assert.equal(countOpenOverlays(fakeRoot([false, true])), 1);
  assert.equal(countOpenOverlays(fakeRoot([true, true])), 2);
});

test('scroll-lock recounts go through countOpenOverlays (unlock + the hidden-attribute observer)', () => {
  const src = read('../js/controls.js');
  assert.ok(!/querySelectorAll\("\.is-open:not\(\[hidden\]\):not\(\.is-leaving\)"\)\.length/.test(src));
  assert.equal((src.match(/countOpenOverlays\(\)/g) || []).length >= 2, true);
});

test('non-overlay widgets do not use the overlay marker class', () => {
  // `.is-open` is counted by the scroll lock: an accordion that keeps it after its sheet closes froze the page.
  assert.ok(!/is-open/.test(read('../js/achievements.js')));
  assert.ok(!/is-open/.test(read('../css/achievements.css')));
});
