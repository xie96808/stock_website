// Real HTML/CSS layout regression. Preview data only; no account/API required.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs
// BROWSER_EXECUTABLE=/absolute/path/to/chromium node scripts/pvp-message-responsive.mjs
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = process.env.PVP_SCREENSHOT_DIR || '/tmp/pvp-compact-chat/screenshots';
mkdirSync(output, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2 });
const html = readFileSync(process.env.PVP_BASELINE_HTML || path.join(root, 'index.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const mime = { '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.hostname !== 'pvp-preview.local') return route.abort();
  if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
  const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
  if (!file.startsWith(root)) return route.abort();
  try {
    const body = process.env.PVP_BASELINE_CSS && url.pathname === '/css/pvp.css'
      ? readFileSync(process.env.PVP_BASELINE_CSS) : readFileSync(file);
    return route.fulfill({ contentType: mime[path.extname(file)] || 'application/octet-stream', body });
  } catch { return route.fulfill({ status: 404, body: '' }); }
});
await page.goto('http://pvp-preview.local/', { waitUntil: 'networkidle' });
await page.evaluate(() => {
  const room = document.getElementById('pvpRoomScreen');
  [...room.parentElement.children].filter(n => n !== room).forEach(n => n.style.display = 'none');
  document.querySelectorAll('.top-left-chrome,.auth-entry').forEach(n => n.style.display = 'none');
  room.classList.add('active');
  document.getElementById('pvpPlayPanel').hidden = false;
  document.getElementById('pvpMsgPicker').hidden = false;
  document.getElementById('pvpMsgOpen').setAttribute('aria-expanded', 'true');
  document.getElementById('pvpClock').hidden = false;
  document.getElementById('pvpSeatMeAvatar').src = 'assets/pvp/bot-a-256.webp';
  document.getElementById('pvpSeatOppAvatar').src = 'assets/pvp/bot-b-256.webp';
  document.getElementById('pvpSeatMeName').textContent = '看准再出手';
  document.getElementById('pvpSeatOppName').textContent = '耐心等风来';
  document.getElementById('pvpMeNav').textContent = '+3.25%';
  document.getElementById('pvpOppNav').textContent = '+1.86%';
  const bubble = document.getElementById('pvpTauntBubbleOpp');
  bubble.hidden = false; bubble.textContent = '这一手，你怎么看？';
  document.getElementById('pvpMsgInput').value = '我再观察一下，稳住';
  document.getElementById('pvpMsgCount').textContent = '9/32';
  document.getElementById('pvpMsgSend').disabled = false;
  document.getElementById('pvpChart').hidden = true;
  document.querySelectorAll('.pvp-mark-legend,.pvp-chart-pan').forEach(n => n.hidden = true);
});
await page.evaluate(() => document.fonts.ready);
const results = [];
for (const [width, height] of [[320,740],[375,812],[390,844],[430,932],[640,900],[768,1024],[844,390],[1100,900],[1440,1000]]) {
  await page.setViewportSize({ width, height });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
    await page.waitForTimeout(180);
    await page.evaluate(() => window.scrollTo(0, 0));
    const checks = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect();
      const panel = rect('#pvpMsgPicker');
      const presets = [...document.querySelectorAll('.pvp-msg-line')].map(n => n.getBoundingClientRect());
      const input = rect('#pvpMsgInput'); const count = rect('#pvpMsgCount'); const send = rect('#pvpMsgSend');
      const near = (a,b) => Math.abs(a-b) < 1;
      const sendNode = document.querySelector('#pvpMsgSend .ctl-label');
      sendNode.textContent = '发送中';
      const sendingFits = sendNode.getBoundingClientRect().width <= send.width;
      sendNode.textContent = '发送';
      return {
        panelInsideViewport: panel.left >= 0 && panel.right <= innerWidth,
        compactPresets: innerWidth >= 900
          ? presets.every(r => near(r.top,presets[0].top) && near(r.width,presets[0].width))
          : near(presets[0].top,presets[1].top) && near(presets[2].top,presets[3].top)
            && presets[2].top >= presets[0].bottom && presets.every(r => near(r.width,presets[0].width)),
        presetTextFits: [...document.querySelectorAll('.pvp-msg-line .ctl-label')].every(n => n.scrollWidth <= n.clientWidth),
        originalInputShell: getComputedStyle(document.getElementById('pvpMsgInput')).borderImageSource.includes('ctl-input-shell-default'),

        originalOrder: !!(document.querySelector('.pvp-msg-line').compareDocumentPosition(document.querySelector('#pvpMsgForm')) & Node.DOCUMENT_POSITION_FOLLOWING),
        presetTargets: presets.every(r => r.height >= 44),
        sendTarget: send.height >= 44 && near(send.width,72),
        composerNoOverlap: input.right <= count.left && count.right <= send.left && input.width >= 100,
        sendingLabelFits: sendingFits,
        artLabelsRetained: !!document.querySelector('#pvpMsgSend .ctl-label')
          && [...document.querySelectorAll('.pvp-msg-line')].every(n => n.classList.contains('ctl-secondary') && n.querySelector('.ctl-label')),
        noRedesignElements: !document.querySelector('.pvp-msg-heading,.pvp-msg-presets'),
      };
    });

    const surrounding = await page.evaluate(() => {
      const selectors = ['#pvpBattleTop','#pvpSeatMe','#pvpSeatOpp','#pvpSeatMeAvatar','#pvpSeatMeName',
        '#pvpClock','#pvpPlayPanel .pvp-score-row','#pvpPlayPanel .pvp-score','#pvpTradeSegment',
        '#pvpTradePrimary','#pvpHold','#pvpMsgOpen','#pvpTradePrimary .pvp-sketch-label','#pvpChart'];
      const properties = ['display','position','width','height','padding','margin','gap','grid-template-columns',
        'border','border-radius','border-image','background','color','font','transform'];
      const originalArtSelectors = ['#pvpMsgPicker','.pvp-msg-line','#pvpMsgSend','#pvpMsgInput'];
      const artProperties = ['border-image-source','background-image','background-color','color','border-radius','font-family','font-size'];
      return {
        otherComponents: Object.fromEntries(selectors.map(selector => {
          const style = getComputedStyle(document.querySelector(selector));
          return [selector,Object.fromEntries(properties.map(key => [key,style.getPropertyValue(key)]))];
        })),
        originalChatArt: Object.fromEntries(originalArtSelectors.map(selector => {
          const style = getComputedStyle(document.querySelector(selector));
          return [selector,Object.fromEntries(artProperties.map(key => [key,style.getPropertyValue(key)]))];
        })),
      };

    });

    results.push({ width, height, theme, checks, surrounding });
    if ([390, 1100].includes(width)) {
      await page.locator('#pvpRoomScreen .pvp-wrap').screenshot({ path: path.join(output, `${width === 390 ? 'mobile' : 'desktop'}-${theme}.png`) });
    }
  }
}
writeFileSync(path.join(output, 'layout-results.json'), JSON.stringify(results, null, 2));
await browser.close();
if (process.env.PVP_COMPARE_SURROUNDINGS) {
  const baseline = JSON.parse(readFileSync(process.env.PVP_COMPARE_SURROUNDINGS, 'utf8'));
  for (const result of results) {
    const old = baseline.find(r => r.width === result.width && r.height === result.height && r.theme === result.theme);
    result.checks.surroundingsUnchanged = JSON.stringify(result.surrounding.otherComponents) === JSON.stringify(old?.surrounding.otherComponents);
    const withoutInput = styles => Object.fromEntries(Object.entries(styles || {}).filter(([key]) => key !== '#pvpMsgInput'));
    result.checks.originalChatArtUnchanged = JSON.stringify(withoutInput(result.surrounding.originalChatArt)) === JSON.stringify(withoutInput(old?.surrounding.originalChatArt));
  }
  writeFileSync(path.join(output, 'layout-results.json'), JSON.stringify(results, null, 2));
}
const failures = results.flatMap(r => Object.entries(r.checks).filter(([,ok]) => !ok).map(([name]) => `${r.width}x${r.height}/${r.theme}: ${name}`));
console.log(`${results.length} viewport/theme combinations, ${results.reduce((n,r) => n+Object.keys(r.checks).length,0)} layout checks; ${failures.length} failures`);
if (failures.length) console.log(failures.join('\n'));
if (failures.length) process.exitCode = 1;
