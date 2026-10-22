// Real HTML/CSS layout regression. Preview data only; no account/API required.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs
// BROWSER_EXECUTABLE=/absolute/path/to/chromium node scripts/pvp-message-input.browser.mjs
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = process.env.PVP_SCREENSHOT_DIR || '/tmp/pvp-chat-input-polish/screenshots';
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
  document.getElementById('pvpTauntBubbleOpp').hidden = true;
  document.getElementById('pvpMsgInput').value = '我再观察一下，稳住';
  document.getElementById('pvpMsgCount').textContent = '9/32';
  document.getElementById('pvpMsgSend').disabled = false;
  document.getElementById('pvpChart').hidden = true;
  document.querySelectorAll('.pvp-mark-legend,.pvp-chart-pan').forEach(n => n.hidden = true);
});
await page.evaluate(() => document.fonts.ready);

const roomSource = readFileSync(process.env.PVP_BASELINE_ROOM || path.join(root,'js/pvp/room.js'),'utf8');
const behaviors = roomSource.slice(roomSource.indexOf('const PRESET_TAUNT_MS'),roomSource.indexOf('export async function showPvpRoom'));
await page.evaluate(code => {
  const harness = `
    let wired=false, matchId='preview-room', view={status:'playing'};
    let failSends=false;
    const openLeave=()=>{}, closeLeave=()=>{}, onLeaveKey=()=>{}, hidePvpTip=()=>{}, refresh=async()=>{};
    const pvpFetch=async()=>{if(failSends)throw new Error('演示发送失败');return {}};
    const setText=(id,text)=>{const n=document.getElementById(id);if(n)n.textContent=text;};
    ${code}
    wireRoom();
    const input=document.getElementById('pvpMsgInput');
    const nativeFocus=input.focus.bind(input);
    window.chatFocusCalls=0;
    input.focus=(...args)=>{window.chatFocusCalls++;nativeFocus(...args);};
    window.chatHarness={
      fail:()=>{failSends=true;},
      reset:()=>{
        failSends=false;customTauntSending=false;closeMsgPicker();input.blur();input.value='';
        setText('pvpMsgStatus','');setText('pvpActionError','');window.chatFocusCalls=0;updateCustomTauntControls();
      },
    };
  `;
  (0,eval)(harness);
},behaviors);
const results=[];
for(const width of [320,390,1100]) {
  await page.setViewportSize({width,height:900});
  for(const theme of ['light','dark']) {
    await page.evaluate(t=>{document.documentElement.setAttribute('data-theme',t);chatHarness.reset();},theme);
    await page.locator('#pvpMsgOpen').click();
    const opening = await page.evaluate(()=>({
      noInputFocus:document.activeElement.id!=='pvpMsgInput',
      noFocusCalls:chatFocusCalls===0,
      visible:!document.getElementById('pvpMsgPicker').hidden,
    }));
    await page.locator('.pvp-msg-line').first().click();
    await page.waitForFunction(()=>document.getElementById('pvpMsgSend').textContent==='发送');
    const preset=await page.evaluate(()=>({
      noFocus:document.activeElement.id!=='pvpMsgInput' && chatFocusCalls===0,
      statusEmpty:document.getElementById('pvpMsgStatus').textContent==='' && getComputedStyle(document.getElementById('pvpMsgStatus')).display==='none',
    }));
    const input=page.locator('#pvpMsgInput');
    const before=await input.boundingBox();
    await input.click();
    const after=await input.boundingBox();
    await input.fill('手动点输入框才开始打字');
    const focus=await page.evaluate(()=>{
      const n=document.getElementById('pvpMsgInput');const s=getComputedStyle(n);
      return {manuallyFocused:document.activeElement===n,noOutline:s.outlineStyle==='none' && s.boxShadow==='none',
        originalHandDrawnFocus:s.borderImageSource.includes('ctl-input-shell-focus')};
    });
    await page.locator('#pvpMsgSend').click();
    await page.waitForFunction(()=>document.getElementById('pvpMsgInput').value==='');
    const success=await page.evaluate(()=>({
      statusEmpty:document.getElementById('pvpMsgStatus').textContent==='' && getComputedStyle(document.getElementById('pvpMsgStatus')).display==='none',
      noRefocus:chatFocusCalls===0,
      staysOpen:!document.getElementById('pvpMsgPicker').hidden,
    }));
    await input.click();await input.fill('失败时保留草稿');await page.evaluate(()=>chatHarness.fail());
    await page.locator('#pvpMsgSend').click();
    await page.waitForFunction(()=>document.getElementById('pvpMsgStatus').textContent==='演示发送失败');
    const failure=await page.evaluate(()=>document.getElementById('pvpMsgInput').value==='失败时保留草稿' && chatFocusCalls===0);
    const checks={openNoKeyboardFocus:opening.noInputFocus&&opening.noFocusCalls&&opening.visible,
      presetNoKeyboardFocus:preset.noFocus,presetNoSuccessBanner:preset.statusEmpty,
      manualInputFocus:focus.manuallyFocused,noExtraFocusRectangle:focus.noOutline,
      originalFocusArt:focus.originalHandDrawnFocus,stableInputSize:Math.abs(before.width-after.width)<1&&Math.abs(before.height-after.height)<1,
      noSuccessBanner:success.statusEmpty,noSuccessRefocus:success.noRefocus,panelStaysOpen:success.staysOpen,
      errorsAndDraftRetained:failure};
    results.push({width,theme,checks});
    if(width===390) {
      await page.evaluate(()=>{chatHarness.reset();document.getElementById('pvpMsgPicker').hidden=false;});
      await input.click();await input.fill('只保留原来的手绘边框');
      await page.locator('#pvpMsgPicker').screenshot({path:path.join(output,`focused-input-${theme}.png`)});
    }
  }
}
writeFileSync(path.join(output,'input-results.json'),JSON.stringify(results,null,2));
await browser.close();
const failures=results.flatMap(r=>Object.entries(r.checks).filter(([,ok])=>!ok).map(([k])=>`${r.width}/${r.theme}: ${k}`));
console.log(`${results.length} viewport/theme combinations; ${results.length*11} input interaction checks; ${failures.length} failures`);
if(failures.length){console.log(failures.join('\n'));process.exitCode=1;}
