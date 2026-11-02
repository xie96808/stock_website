import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const html = read('../index.html');
const css = read('../css/result.css');
const resultJs = read('../js/result.js');
const cardJs = read('../js/regret-card.js');

const pos = (needle) => {
    const i = html.indexOf(needle);
    assert.ok(i >= 0, `index.html is missing ${needle}`);
    return i;
};

test('the card sits between the stats row and the action buttons', () => {
    assert.ok(pos('class="result-stats-grid"') < pos('id="resultRegret"'));
    assert.ok(pos('id="resultRegret"') < pos('class="result-actions"'));
    assert.ok(/id="resultRegret"[^>]*\bhidden\b/.test(html), 'hidden until a model exists');
});

test('every id the painter writes exists in the markup', () => {
    const ids = [...cardJs.matchAll(/\$\('([A-Za-z]+)'\)|setText\('([A-Za-z]+)'/g)].map((m) => m[1] || m[2]);
    assert.ok(ids.length >= 12);
    for (const id of new Set(ids)) assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
});

test('the 再来一局 button has a hint slot that setBtnLabel cannot wipe (a sibling of .ctl-label)', () => {
    assert.match(html, /<span class="ctl-label">再来一局<\/span><span class="result-act__hint" id="resultAgainHint" hidden><\/span>/);
});

test('返回首页 at the bottom is gone; the top bar is sticky under the fixed page band', () => {
    assert.ok(!/onclick="resetGame\(\)"/.test(html.slice(pos('class="result-actions"'), pos('result-share-hint'))));
    assert.match(css, /#resultScreen > \.sg-backbar \{[^}]*position: sticky;/);
    assert.match(css, /top: var\(--result-backbar-top\)/);
    // 58px band on desktop, 62px on phones (css/base.css body::after)
    assert.match(css, /#resultScreen \{ --result-backbar-top: 58px; \}/);
    assert.match(css, /@media \(max-width: 640px\) \{\s*#resultScreen \{ --result-backbar-top: 62px; \}/);
    // the old sibling rule would now hit 保存图片
    assert.ok(!css.includes('.result-act--primary + .result-act'));
});

test('the primary button is centered and narrower than the full row', () => {
    const m = css.match(/#resultScreen \.result-actions \.result-act--primary \{([^}]*)\}/);
    assert.ok(m, 'rule exists');
    assert.match(m[1], /justify-self: center/);
    assert.match(m[1], /width: min\(100%, 300px\) !important/);
});

test('persona name is big and centered like the return rate; the bar animates from 0 and respects reduced motion', () => {
    assert.match(css, /\.rg-persona__name \{[^}]*font-size: 2\.1rem/);
    assert.match(css, /\.result-regret \{[^}]*text-align: center/);
    assert.match(css, /@keyframes rgFill \{\s*from \{ width: 0; \}\s*to \{ width: var\(--rg-w, 0%\); \}/);
    assert.match(css, /prefers-reduced-motion: reduce\) \{\s*\.rg-bar\.is-run \.rg-bar__fill \{ animation: none/);
    // 0% must be truly empty: the end line is an inset shadow, not a border
    assert.ok(!/\.rg-bar__fill \{[^}]*border-right/.test(css));
});

test('mobile ordering: stats → card → buttons → banner → invite', () => {
    const order = (sel) => Number((css.match(new RegExp(`\\n    ${sel.replace(/[.]/g, '\\.')} \\{ order: (\\d+)`)) || [])[1]);
    assert.ok(order('.result-regret') > 7);
    assert.ok(order('.result-actions') > order('.result-regret'));
    assert.ok(order('.result-guest-banner') > order('.result-actions'));
});

test('result.js paints the card in an isolated step, and the card never throws into the screen', () => {
    assert.match(resultJs, /import \{ paintRegretCard \} from '\.\/regret-card\.js'/);
    assert.match(resultJs, /runResultStep\('regretCard', \(\) => paintRegretCard\(\)\)/);
    // never wait for visibility before the number counts: a number parked at +0.0% contradicts the line under it
    assert.match(cardJs, /window\.setTimeout\(start, 600\)/);
    assert.ok(!cardJs.includes('6000'), 'no long visibility fallback');
    assert.ok(cardJs.includes('IntersectionObserver'), 'a bar below the fold is replayed when it scrolls into view');
});
