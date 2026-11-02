// 韭币到账弹窗 — real-browser regression (phone sizes). Needs a running local server (static + API):
//   cd server && PORT=8788 ORIGIN_ALLOWLIST=http://localhost:8788 STOCKGAME_DB_PATH=/tmp/x.sqlite node src/index.js
//   BASE=http://localhost:8788 PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/coin-gain.browser.mjs
// Checks, at 320 / 360 / 375 / 390 / 414 portrait and 667x375 landscape: ribbon + button inside the viewport, no overlap
// between the card parts, one card at a time (queue), balance line, vibrate tick, coins fly to the balance chip after
// dismiss, the second card follows the first, nothing is left behind.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8788';
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
let failed = 0;
const check = (name, ok, info = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, info); };

for (const [w, h] of [[320, 568], [360, 740], [375, 667], [390, 844], [414, 896], [667, 375]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, baseURL: BASE });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => { window.__vib = 0; navigator.vibrate = () => { window.__vib++; return true; }; });
  await page.goto('/'); await page.waitForTimeout(1500);
  const u = 'cgq' + Math.floor(Math.random() * 1e7);
  await page.evaluate(async (u) => { await fetch('/api/v1/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, password: 'pass1234', nickname: '测试员', termsVersion: 'v1' }) }); }, u);
  await page.goto('/'); await page.waitForTimeout(2500);
  for (const sel of ['#announcementsDismissToday', '#streakCloseX']) {
    const l = page.locator(sel);
    if (await l.isVisible().catch(() => false)) { await l.click({ force: true }).catch(() => {}); await page.waitForTimeout(300); }
  }
  await page.evaluate(async () => {
    const j = await import('/js/jiu-coin.js');
    j.announceCoinGains([{ amount: 20, source: 'puzzleFirst', key: 'b1-' + Date.now() }, { amount: 15, source: 'puzzleThree', key: 'b2-' + Date.now() }]);
  });
  await page.waitForTimeout(900);
  const g = await page.evaluate(() => {
    const ov = document.querySelector('.cg-overlay');
    if (!ov) return null;
    const q = (s) => { const e = ov.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
    return { title: q('.cg-title'), disc: q('.cg-disc'), num: q('.cg-amount'), sub: q('.cg-sub'), ok: q('.cg-ok'), cards: document.querySelectorAll('.cg-overlay').length, subText: ov.querySelector('.cg-sub').textContent, bal: (ov.querySelector('.cg-bal') || {}).textContent || '', vib: window.__vib };
  });
  check(`${w}x${h} card shown`, !!g);
  if (g) {
    const inV = (r) => r && r.l >= -0.5 && r.r <= w + 0.5 && r.t >= -0.5 && r.b <= h + 0.5;
    check(`${w}x${h} ribbon and button inside the viewport`, inV(g.title) && inV(g.ok), JSON.stringify({ t: g.title, ok: g.ok }));
    check(`${w}x${h} parts do not overlap`, g.disc.b <= g.num.t + 2 && g.num.b <= g.sub.t + 2 && g.sub.b <= g.ok.t + 2);
    check(`${w}x${h} first card = 残局首通二星 with balance`, /首通/.test(g.subText) && /当前余额/.test(g.bal), g.subText + ' ' + g.bal);
    check(`${w}x${h} one card at a time`, g.cards === 1, String(g.cards));
    check(`${w}x${h} vibrate tick`, g.vib >= 1, String(g.vib));
  }
  await page.locator('#cgOk').click();
  await page.waitForTimeout(260);
  check(`${w}x${h} coins fly after dismiss`, (await page.evaluate(() => document.querySelectorAll('.cg-fly-coin').length)) > 0);
  await page.waitForTimeout(900);
  const second = await page.evaluate(() => document.querySelector('.cg-overlay')?.querySelector('.cg-sub')?.textContent || '');
  check(`${w}x${h} second card follows`, /三星/.test(second), second);
  await page.waitForTimeout(400);
  await page.locator('#cgOk').click();
  await page.waitForTimeout(1300);
  check(`${w}x${h} cleaned up`, await page.evaluate(() => !document.querySelector('.cg-overlay') && !document.querySelector('.cg-fly-layer') && !document.querySelector('.cg-bump')));
  check(`${w}x${h} no page errors`, errs.length === 0, errs.join(' | '));
  await ctx.close();
}
await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
