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

test('leaving the play-modes sheet for another page releases its html scroll lock', async () => {
  const { dismissPlayModesSheet, prepareScreen, Route } = await import('../js/screen-router.js');
  const classes = new Set(['pm-sheet-open']);
  const mk = () => ({ hidden: false, style: { transform: 'x' }, classList: { remove: (...c) => c.forEach((k) => classes.delete(k)) }, setAttribute() {} });
  const sheet = mk();
  const bd = mk();
  const prev = globalThis.document;
  globalThis.document = {
    documentElement: { classList: { remove: (...c) => c.forEach((k) => classes.delete(k)) } },
    getElementById: (id) => (id === 'playModes' ? sheet : id === 'playModesBackdrop' ? bd : null),
    querySelectorAll: () => [],
  };
  try {
    dismissPlayModesSheet();
    assert.equal(classes.has('pm-sheet-open'), false);
    assert.equal(sheet.hidden, true);
    assert.equal(bd.hidden, true);
  } finally {
    globalThis.document = prev;
  }
  assert.equal(typeof prepareScreen, 'function');
  assert.ok(Route.MY_GAMES);
  assert.match(readFileSync(new URL('../js/screen-router.js', import.meta.url), 'utf8'), /route !== Route\.HOME && route !== Route\.SIM\) dismissPlayModesSheet\(\)/);
});
