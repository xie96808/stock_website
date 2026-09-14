import test from 'node:test';
import assert from 'node:assert/strict';
import {
  THEME_STORAGE_KEY,
  THEME_LIGHT,
  THEME_DARK,
  normalizeTheme,
  getTheme,
  setTheme,
  toggleTheme,
  onThemeChange,
  getChartColors,
  applyChartTheme,
  __setThemeDepsForTests,
  __resetThemeForTests,
} from '../js/theme.js';

function makeDoc(initial = null) {
  let attr = initial;
  return {
    documentElement: {
      getAttribute(name) {
        assert.equal(name, 'data-theme');
        return attr;
      },
      setAttribute(name, value) {
        assert.equal(name, 'data-theme');
        attr = value;
      },
    },
  };
}

function makeStore(map = {}) {
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
    },
    setItem(key, value) {
      map[key] = String(value);
    },
    _map: map,
  };
}

test.beforeEach(() => {
  __resetThemeForTests();
});

test('normalizeTheme maps only dark → dark; else light', () => {
  assert.equal(normalizeTheme('dark'), THEME_DARK);
  assert.equal(normalizeTheme('light'), THEME_LIGHT);
  assert.equal(normalizeTheme(null), THEME_LIGHT);
  assert.equal(normalizeTheme('nope'), THEME_LIGHT);
  assert.equal(normalizeTheme(undefined), THEME_LIGHT);
});

test('getTheme prefers documentElement over storage', () => {
  const store = makeStore({ [THEME_STORAGE_KEY]: 'dark' });
  __setThemeDepsForTests({ document: makeDoc('light'), localStorage: store });
  assert.equal(getTheme(), THEME_LIGHT);

  __setThemeDepsForTests({ document: makeDoc(null), localStorage: store });
  assert.equal(getTheme(), THEME_DARK);
});

test('getTheme falls back to light with no deps', () => {
  __setThemeDepsForTests({ document: null, localStorage: null });
  assert.equal(getTheme(), THEME_LIGHT);
});

test('setTheme writes DOM + storage and notifies only on change', () => {
  const store = makeStore();
  const doc = makeDoc('light');
  __setThemeDepsForTests({ document: doc, localStorage: store });

  const seen = [];
  const off = onThemeChange((next, prev) => seen.push([next, prev]));

  assert.equal(setTheme('light'), THEME_LIGHT);
  assert.deepEqual(seen, []);
  assert.equal(store._map[THEME_STORAGE_KEY], 'light');

  assert.equal(setTheme('dark'), THEME_DARK);
  assert.deepEqual(seen, [[THEME_DARK, THEME_LIGHT]]);
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'dark');
  assert.equal(store._map[THEME_STORAGE_KEY], 'dark');

  off();
  setTheme('light');
  assert.equal(seen.length, 1);
});

test('toggleTheme flips or accepts forced light/dark', () => {
  const store = makeStore();
  __setThemeDepsForTests({ document: makeDoc('light'), localStorage: store });

  assert.equal(toggleTheme(), THEME_DARK);
  assert.equal(getTheme(), THEME_DARK);
  assert.equal(toggleTheme(), THEME_LIGHT);
  assert.equal(toggleTheme('dark'), THEME_DARK);
  assert.equal(toggleTheme('light'), THEME_LIGHT);
  assert.equal(toggleTheme('nope'), THEME_DARK); // flip from light
});

test('onThemeChange rejects non-function', () => {
  assert.throws(() => onThemeChange(null), TypeError);
});

test('getChartColors differs for light vs dark', () => {
  const light = getChartColors(THEME_LIGHT);
  const dark = getChartColors(THEME_DARK);
  assert.notEqual(light.tooltipBg, dark.tooltipBg);
  assert.notEqual(light.tooltipText, dark.tooltipText);
  assert.equal(typeof light.axisLabel, 'string');
});

test('applyChartTheme no-ops on null; setOption with tokens for chart', () => {
  assert.equal(applyChartTheme(null, THEME_LIGHT), undefined);

  let option = null;
  const chart = {
    setOption(opt) {
      option = opt;
    },
  };
  applyChartTheme(chart, THEME_DARK);
  const colors = getChartColors(THEME_DARK);
  assert.equal(option.tooltip.backgroundColor, colors.tooltipBg);
  assert.equal(option.tooltip.borderColor, colors.tooltipBorder);
  assert.equal(option.tooltip.textStyle.color, colors.tooltipText);
  assert.equal(option.legend.textStyle.color, colors.axisLabel);
  assert.equal(option.xAxis[0].axisLine.lineStyle.color, colors.axisLine);
  assert.equal(option.yAxis[0].axisLabel.color, colors.axisLabel);
  assert.equal(option.yAxis[0].splitLine.lineStyle.color, colors.splitLine);
});

test('THEME_STORAGE_KEY is theme', () => {
  assert.equal(THEME_STORAGE_KEY, 'theme');
});
