// Render real ECharts for PvP marker/plot regression using demonstration data.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs
// BROWSER_EXECUTABLE=/absolute/path/to/chromium node scripts/pvp-chart-preview.mjs
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = process.env.PVP_SCREENSHOT_DIR || '/tmp/pvp-compact-chart/screenshots';
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
    const body = process.env.PVP_BASELINE_OPTION && url.pathname === '/js/kline-option.js'
      ? readFileSync(process.env.PVP_BASELINE_OPTION) : readFileSync(file);
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
  document.getElementById('pvpClock').hidden = false;
  document.getElementById('pvpSeatMeAvatar').src = 'assets/pvp/bot-a-256.webp';
  document.getElementById('pvpSeatOppAvatar').src = 'assets/pvp/bot-b-256.webp';
  document.getElementById('pvpSeatMeName').textContent = '看准再出手';
  document.getElementById('pvpSeatOppName').textContent = '耐心等风来';
  document.getElementById('pvpMeNav').textContent = '+3.25%';
  document.getElementById('pvpOppNav').textContent = '+1.86%';
  document.getElementById('pvpChart').hidden = false;

});
await page.evaluate(() => document.fonts.ready);

await page.addScriptTag({ url: 'http://pvp-preview.local/js/vendor/echarts.min.js' });
await page.evaluate(async () => {
  const { buildKlineOption, relaxPvpMarkers } = await import('/js/kline-option.js');
  const closes = [101,103,109,114,112,108,106,105,107,104,105,103,106,107,104,105,104,103,104,102,101,102,100,101,99,100,103,108,111,109,108,110,109,108];
  const bars = closes.map((close,i) => {
    const open = i ? closes[i-1] : 100;
    return { label: i < 4 ? `h${i+1}` : `d${i-3}`, open, close,
      low: Math.min(open,close)-0.8, high: Math.max(open,close)+1.2,
      volume: 1.2+(i%7)*0.3, date: `演示${i+1}` };
  });
  const marks = [
    { label:'d21',side:'me',kind:'buy' },
    { label:'d23',side:'opponent',kind:'buy' },
    { label:'d25',side:'opponent',kind:'sell' },
    { label:'d28',side:'opponent',kind:'buy' },
    { label:'d30',side:'opponent',kind:'sell' },
  ];
  const node = document.getElementById('pvpChart');
  window.previewChart = echarts.init(node);
  window.previewRebuild = bottom => {
    const option = buildKlineOption({ mode:'pvp',bars,historyLength:4,pvpMarks:marks,
      showLegend:false,showDataZoomSlider:false,pvpBottom:bottom,resetDataZoom:true });
    previewChart.clear(); previewChart.setOption(option);
    relaxPvpMarkers(previewChart,option.series[0].markPoint.data);
  };
  previewRebuild('volume');
});
const results = [];
for (const [width,height] of [[320,740],[375,812],[390,844],[430,932],[768,1024],[844,390],[1100,900]]) {
  await page.setViewportSize({width,height});
  for (const theme of ['light','dark']) {
    await page.evaluate(t => document.documentElement.setAttribute('data-theme',t),theme);
    for (const bottom of ['volume','macd']) {
      await page.evaluate(b => { previewChart.resize(); previewRebuild(b); },bottom);
      await page.waitForTimeout(120);
      const metrics = await page.evaluate(() => {
        const c = previewChart; const opt = c.getOption();
        const grid = c.getModel().getComponent('grid',0).coordinateSystem.getRect();
        const points = opt.series[0].markPoint.data;
        const pins = points.filter(p => p.pvpOpponent);
        const checks = {
          noAxisTitle: !opt.yAxis[0].name,
          compactPins: pins.length === 4 && pins.every(p => p.symbol==='triangle' && p.symbolSize[0]===12 && p.label.show===false && p.itemStyle.color==='transparent'),
          pinDates: pins.every(p => p.symbolOffset[0]===0),
          directions: pins.every(p => p.name==='对手卖' ? p.symbolRotate===180 && p.symbolOffset[1]<0 : p.symbolRotate===0 && p.symbolOffset[1]>0),
          pinsInsidePricePane: pins.every(p => {
            const [x,y] = c.convertToPixel({xAxisIndex:0,yAxisIndex:0},p.coord);
            const cy = y+p.symbolOffset[1];
            return x-6>=2 && x+6<=c.getWidth()-2 && cy-6>=grid.y && cy+6<=grid.y+grid.height;
          }),
          mainPlotLarger: grid.width > c.getWidth()-80 && grid.height > c.getHeight()*0.66-12,
          candleVolumeAligned: opt.grid[0].left===opt.grid[1].left && opt.grid[0].right===opt.grid[1].right,
        };
        return { checks, grid:{x:grid.x,y:grid.y,width:grid.width,height:grid.height}, chart:{width:c.getWidth(),height:c.getHeight()}, points };
      });
      results.push({width,height,theme,bottom,...metrics});
      if ([390,1100].includes(width) && bottom==='volume') {
        await page.locator('#pvpRoomScreen .pvp-wrap').screenshot({path:path.join(output,`${width===390?'mobile':'desktop'}-${theme}.png`)});
        await page.locator('#pvpChart').screenshot({path:path.join(output,`${width===390?'mobile':'desktop'}-chart-${theme}.png`)});
      }
    }
  }
}
// Tap a candle to verify the existing tooltip exposes the opponent's action.
await page.setViewportSize({width:390,height:844});
await page.evaluate(() => { previewChart.resize(); previewRebuild('volume'); });
await page.waitForTimeout(120);
const target = await page.evaluate(() => previewChart.convertToPixel({xAxisIndex:0,yAxisIndex:0},['d30',108]));
await page.locator('#pvpChart').scrollIntoViewIfNeeded();
const visible = await page.locator('#pvpChart').boundingBox();
await page.mouse.click(visible.x+target[0],visible.y+target[1]);
await page.waitForTimeout(150);
const tip = await page.locator('[data-pvp-tip="1"]').textContent().catch(()=>'');
const tooltipPassed = tip.includes('第30天') && tip.includes('对手 · 卖出');
const pinTarget = await page.evaluate(() => {
  const p = previewChart.getOption().series[0].markPoint.data.find(p => p.name==='对手卖' && p.coord[0]==='d30');
  if (!p) return null;
  const [x,y] = previewChart.convertToPixel({xAxisIndex:0,yAxisIndex:0},p.coord);
  return [x,y+p.symbolOffset[1]];
});
let markerTipPassed = false;
if (pinTarget) {
  await page.evaluate(() => previewChart.dispatchAction({type:'hideTip'}));
  await page.mouse.click(visible.x+pinTarget[0],visible.y+pinTarget[1]);
  await page.waitForTimeout(150);
  markerTipPassed = await page.evaluate(() => document.body.innerText.includes('第30天 · 对手卖'));
}
writeFileSync(path.join(output,'results.json'),JSON.stringify({results,tooltipPassed,markerTipPassed,tip},null,2));
await browser.close();
const failures = results.flatMap(r=>Object.entries(r.checks).filter(([,ok])=>!ok).map(([key])=>`${r.width}/${r.theme}/${r.bottom}: ${key}`));
if (!tooltipPassed) failures.push('day tooltip missing opponent action');
if (!markerTipPassed) failures.push('marker tap missing day/action');
console.log(`${results.length} viewport/theme/indicator combinations; ${results.length*7+2} checks; ${failures.length} failures`);
if (failures.length) { console.log(failures.join('\n')); process.exitCode=1; }
