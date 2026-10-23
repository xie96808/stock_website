/** wheel-polish batch: cold-open warm-up, go-button alignment, odds sheet removed, rename + backdrop close, unit icons, CTA bounce. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { unitIconsHtml, hasUnitIcons, coinAmountHtml, ticketAmountHtml, escapeHtml } from '../js/unit-icons.js';
import { ticketIconHtml, ticketVariantFor } from '../js/icon-art.js';
import { backdropCloseAllowed, LW_BACKDROP_GUARD_MS } from '../js/lucky-wheel-pure.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const rd = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, "\n");

test('unitIconsHtml: number-adjacent 韭币 / 后悔券 become icons, the word stays as hidden text', () => {
  const h = unitIconsHtml('后悔券已用完，可改用 50 韭币反悔');
  assert.match(h, /^后悔券已用完，可改用 <span class="jiu-coin-amt u-amt"><span class="jiu-price-num">50<\/span><span class="jiu-coin-icon"/);
  assert.match(h, /<span class="u-sr">韭币<\/span><\/span>反悔$/);
  assert.ok(!/50 韭币/.test(h));
  const t = unitIconsHtml('道具：后悔券 ×4');
  assert.match(t, /^道具：<span class="u-amt u-ticket-amt"><span class="ticket-icon"/);
  assert.match(t, /<span class="u-sr">后悔券<\/span><span class="u-ticket-n">×4<\/span><\/span>$/);
  assert.match(unitIconsHtml('使用 1 张后悔券（剩 2 张）'), /^使用 <span class="u-amt u-ticket-amt">.*×1<\/span><\/span>（剩 2 张）$/);
  assert.match(unitIconsHtml('已回到上一决策日（后悔券 −1）'), /<span class="u-ticket-n">−1<\/span><\/span>）$/);
  assert.match(unitIconsHtml('首通二星 +20 韭币'), /<span class="jiu-price-num">\+20<\/span>/);
});

test('unitIconsHtml: prose without a number is untouched, and text is escaped', () => {
  for (const s of ['韭币不足，无法反悔', '今日后悔券已达上限，已折算为韭币', '纯净榜含使用后悔券的对局']) {
    assert.equal(unitIconsHtml(s), s);
    assert.equal(hasUnitIcons(s), false);
  }
  assert.equal(unitIconsHtml('<b>&"'), '&lt;b&gt;&amp;&quot;');
  assert.equal(escapeHtml("<'>"), '&lt;&#39;&gt;');
  assert.ok(hasUnitIcons('消耗 20 韭币'));
  assert.ok(hasUnitIcons('后悔券×2'));
  assert.ok(unitIconsHtml('<img onerror=x> 5 韭币').startsWith('&lt;img onerror=x&gt; '));
});

test('ticket icon contract: 1.15em box, aria-hidden, day + lazy night art that exists on disk', () => {
  for (const size of [12, 14, 20]) {
    const h = ticketIconHtml({ size });
    assert.match(h, /^<span class="ticket-icon" data-ticket-art="(12|15x17)" aria-hidden="true">/);
    assert.match(h, /ticket-pic--day/);
    assert.match(h, /ticket-pic--night/);
    assert.match(h, /ticket-img--night" [^>]*loading="lazy"/);
    for (const m of h.matchAll(/assets\/icon-unify\/([\w@.-]+?)\?v=/g)) assert.ok(existsSync(join(ROOT, 'assets', 'icon-unify', m[1])), m[1]);
  }
  assert.equal(ticketVariantFor(10), '12');
  assert.equal(ticketVariantFor(14), '15x17');
  const css = rd('css/jiu-coin.css');
  assert.match(css, /\.ticket-icon \{[^}]*width: 1\.15em;[^}]*height: 1\.15em;[^}]*margin: -0\.1em 0;/s);
  assert.match(css, /\.u-sr \{[^}]*position: absolute !important;/s);
  assert.match(css, /\.ticket-pic--night \{ display: none !important; \}/);
  // amounts keep the existing .jiu-coin-amt wrapper (same box rules as amountWithCoinHtml)
  assert.match(coinAmountHtml(50), /^<span class="jiu-coin-amt u-amt"><span class="jiu-price-num">50<\/span>/);
  assert.match(ticketAmountHtml(null), /^<span class="u-amt u-ticket-amt"><span class="ticket-icon"[^]*<span class="u-sr">后悔券<\/span><\/span>$/);
});

test('backdrop close guard: never during a spin / request, not in the pop-up\'s first 400 ms', () => {
  assert.equal(LW_BACKDROP_GUARD_MS, 400);
  assert.equal(backdropCloseAllowed({ phase: 'idle' }), true);
  assert.equal(backdropCloseAllowed({ phase: 'loading' }), false);
  assert.equal(backdropCloseAllowed({ phase: 'spinning' }), false);
  assert.equal(backdropCloseAllowed({ phase: 'idle', inflight: 1 }), false);
  assert.equal(backdropCloseAllowed({ phase: 'popup', popAgeMs: 120 }), false);
  assert.equal(backdropCloseAllowed({ phase: 'popup', popAgeMs: 399 }), false);
  assert.equal(backdropCloseAllowed({ phase: 'popup', popAgeMs: 400 }), true);
  assert.equal(backdropCloseAllowed({ phase: 'popup', popAgeMs: NaN }), false);
});

test('wheel modal: 签到转盘 title, no 概率说明 link / sheet, backdrop wired through the guard', () => {
  const js = rd('js/lucky-wheel.js');
  assert.match(js, /<h2 class="lw-title" id="lwTitle">签到转盘<\/h2>/);
  assert.ok(!/概率说明|lwOdds|toggleOdds|renderOdds/.test(js));
  assert.match(js, /const isBackdrop = \(t\) => t === S\.root \|\| t === S\.els\.dialog \|\| t === S\.els\.fit;/);
  assert.match(js, /if \(ok && backdropMayClose\(\)\) requestClose\(\);/);
  assert.match(js, /S\.popAt = performance\.now\(\);\n  S\.phase = "popup";/);
  assert.match(js, /S\.inflight \+= 1;/);
  assert.match(js, /finally \{\n    S\.inflight -= 1;/);
  const css = rd('css/lucky-wheel.css');
  assert.ok(!/lw-odds/.test(css), 'odds css removed');
  assert.ok(!/alert\(/.test(js + rd('js/jiu-coin.js') + rd('js/unit-icons.js')));
});

test('go button: label spans the art body, both states share box + size, body centre on the wheel axis', () => {
  const css = rd('css/lucky-wheel.css');
  const go = css.match(/\n\.lw-go \{[^}]*\}/)[0];
  assert.match(go, /left: 2px;/);
  const lab = css.match(/\n\.lw-go-label \{[^}]*\}/)[0];
  assert.match(lab, /left: 1\.43%;/);
  assert.match(lab, /right: 2\.86%;/);
  assert.match(lab, /top: 6\.25%;/);
  assert.match(lab, /bottom: 9\.38%;/);
  assert.match(lab, /font-size: 24px;/);
  assert.match(css, /\.lw-go\[data-state="disabled"\] \.lw-go-label \{ color: #ddd2bc; \}/, 'disabled keeps the same font size');
  // art geometry (MANIFEST): body (4,4)–(272,58) of 280×64 → centre x 138; left 2px moves it onto the box centre 140
  assert.equal((4 + 272) / 2 + 2, 280 / 2);
});

test('entry: 签到幸运转盘 (two short lines ≤640px in the old 43px content box), warm-up + parallel state fetch', () => {
  const jc = rd('js/jiu-coin.js');
  assert.match(jc, /const WHEEL_ENTRY_LABEL = "签到幸运转盘";/);
  assert.match(jc, /<span class="lw-entry-l1">签到<\/span><span class="lw-entry-l2">幸运转盘<\/span>/);
  for (const ev of ['pointerenter', 'pointerdown', 'touchstart']) assert.ok(jc.includes(`btn.addEventListener("${ev}", now, { passive: true });`), ev);
  assert.match(jc, /requestIdleCallback\(run, \{ timeout: 2000 \}\)/);
  assert.match(jc, /const prefetched = prefetchWheelState\(\);\n    const mod = await loadWheelModule\(\);\n    const r = await mod\.openLuckyWheel\(\{ onChange: onWheelChange, prefetched \}\);/);
  assert.match(jc, /import\("\.\/lucky-wheel\.js"\)/, 'literal import kept for the fingerprinter');
  const lw = rd('js/lucky-wheel.js');
  assert.match(lw, /export function warmLuckyWheel\(state\)/);
  assert.match(lw, /export function primeLuckyWheel\(state\)/);
  assert.match(lw, /await \(prefetched \|\| api\("\/me\/lucky-wheel"\)\)/);
  const css = rd('css/lucky-wheel.css');
  assert.match(css, /\.jiu-coin-daily-btn\.is-wheel \.jiu-daily-short \{[^}]*width: 43px;[^}]*height: 16px;/s);
});

test('index.html modulepreloads the wheel + helper, and the fingerprinter rewrites those hrefs', () => {
  const html = rd('index.html');
  assert.match(html, /<link rel="modulepreload" href="js\/lucky-wheel\.js">/);
  assert.match(html, /<link rel="modulepreload" href="js\/lucky-wheel-pure\.js">/);
  const dir = mkdtempSync(join(tmpdir(), 'wp-fp-'));
  try {
    mkdirSync(join(dir, 'js'));
    for (const f of ['lucky-wheel.js', 'lucky-wheel-pure.js', 'icon-art.js', 'unit-icons.js']) writeFileSync(join(dir, 'js', f), rd('js/' + f));
    writeFileSync(join(dir, 'js', 'auth.js'), 'export const api=1,getAuthState=1,showToast=1;\n');
    writeFileSync(join(dir, 'js', 'controls.js'), 'export const openCtlOverlay=1,closeCtlOverlay=1;\n');
    writeFileSync(join(dir, 'js', 'rewind-tickets.js'), 'export const getRewindTickets=1,refreshRewindTickets=1;\n');
    writeFileSync(join(dir, 'index.html'), '<!doctype html>\n<link rel="modulepreload" href="js/lucky-wheel.js">\n<link rel="modulepreload" href="js/lucky-wheel-pure.js">\n');
    const r = spawnSync(process.execPath, [join(ROOT, 'deploy', 'fingerprint-assets.mjs'), dir], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const names = readdirSync(join(dir, 'js'));
    const lw = names.find((n) => /^lucky-wheel\.[a-f0-9]{10}\.js$/.test(n));
    const pure = names.find((n) => /^lucky-wheel-pure\.[a-f0-9]{10}\.js$/.test(n));
    const out = readFileSync(join(dir, 'index.html'), 'utf8');
    assert.ok(out.includes(`href="js/${lw}"`), out);
    assert.ok(out.includes(`href="js/${pure}"`), out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('进入模拟盘 bounce: transform/opacity only, paused on press + hidden tab, off for reduced motion, no texture', () => {
  const html = rd('index.html');
  assert.match(html, /<span class="cta cta-fill cta-bounce">进入模拟盘<\/span>/);
  assert.equal((html.match(/cta-bounce/g) || []).length, 1);
  const css = rd('css/start.css');
  const block = css.slice(css.indexOf('.start-screen .cta-bounce {'), css.indexOf('@media (prefers-reduced-motion: reduce) {\n    .start-screen .cta-bounce'));
  assert.ok(block.length > 200);
  for (const kf of ['cta-bounce', 'cta-shine']) {
    const body = css.match(new RegExp(`@keyframes ${kf} \\{([\\s\\S]*?)\\n\\}`))[1];
    const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
    assert.ok(props.every((p) => p === 'transform' || p === 'opacity'), `${kf}: ${props}`);
  }
  assert.match(css, /animation: cta-bounce 1\.4s /);
  assert.ok(!/url\(|feTurbulence|noise/i.test(block), 'no texture in the bounce');
  assert.match(css, /\.start-screen \.lane:active \.cta-bounce,[\s\S]*?html\.is-doc-hidden \.start-screen \.cta-bounce::before \{\n    animation-play-state: paused;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\n    \.start-screen \.cta-bounce,\n    \.start-screen \.cta-bounce::before \{\n        animation: none;/);
  assert.match(rd('js/home-ia.js'), /classList\.toggle\("is-doc-hidden", !!document\.hidden\)/);
});

test('icon sites: toasts / confirm sheet / rewind / account / result chip / wheel pop-up go through the icon helpers', () => {
  const ctl = rd('js/controls.js');
  assert.match(ctl, /if \(hasUnitIcons\(msg\)\) toast\.innerHTML = unitIconsHtml\(msg, \{ size: 14 \}\);\n  else toast\.textContent = msg;/);
  assert.match(ctl, /if \(hasUnitIcons\(msg\)\) body\.innerHTML = unitIconsHtml\(msg, \{ size: 16 \}\);/);
  const game = rd('js/game.js');
  assert.match(game, /label\.innerHTML = `反悔 · \$\{ticketAmountHtml\(getRewindTickets\(\)\.tickets, \{ size: 12 \}\)\}`;/);
  assert.match(game, /改用 \$\{coinAmountHtml\(50, \{ size: 14 \}\)\}/);
  assert.match(game, /改用 \$\{ticketAmountHtml\(null, \{ size: 14 \}\)\}（剩 \$\{ctx\.tickets\} 张）/);
  assert.match(rd('js/rewind-tickets.js'), /unitIconsHtml\(`道具：\$\{inventoryLine\(st\.tickets\)\}`/);
  assert.match(rd('js/result.js'), /replace\('后悔券', ticketAmountHtml\(null, \{ size: 12 \}\)\)/);
  const lw = rd('js/lucky-wheel.js');
  assert.match(lw, /当前余额 \$\{coinAmountHtml\(bal, \{ size: 13 \}\)\}/);
  assert.match(lw, /<span class="lw-free-sep">·<\/span>\$\{ticketIconHtml\(\{ size: 15 \}\)\}<span class="u-sr">后悔券<\/span>×/);
  assert.ok(!/当前余额 \$\{bal\} 韭币/.test(lw));
});
