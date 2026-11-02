import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const html = read('index.html');
const css = read('css/coin-gain.css');
const js = read('js/coin-gain.js');
const sfx = read('js/coin-sfx.js');

test('index.html loads the stylesheet and wires the init (audio unlock + art warm-up)', () => {
  assert.match(html, /<link rel="stylesheet" href="css\/coin-gain\.css">/);
  assert.match(html, /import \{ initCoinGain \} from '\.\/js\/coin-gain\.js';/);
  assert.match(html, /initCoinGain\(\);/);
});

test('layering: the card sits above toasts and every dialog, below only the first-game tutorial', () => {
  const z = Number(/\.cg-overlay\s*\{[^}]*z-index:\s*(\d+)/.exec(css)[1]);
  const ctl = read('css/controls.css');
  const toast = Number(/--ctl-z-toast:\s*(\d+)/.exec(ctl)[1]);
  const crisis = Number(/--ctl-z-crisis:\s*(\d+)/.exec(ctl)[1]);
  const tut = Number(/z-index:\s*(\d+)/.exec(read('css/tutorial.css'))[1]);
  assert.ok(z > toast && z > crisis, `card z ${z} must beat toast ${toast} / crisis ${crisis}`);
  assert.ok(z < tut, 'the tutorial overlay may still cover it');
  const fly = Number(/\.cg-fly-layer\s*\{[^}]*z-index:\s*(\d+)/.exec(css)[1]);
  assert.ok(fly > z, 'flying coins are drawn over the fading card');
});

test('the coin in the middle spins forever (hand-built 3D coin with a real rim and two readable faces)', () => {
  assert.match(css, /\.cg-coin3d\s*\{[^}]*transform-style:\s*preserve-3d/);
  assert.match(css, /\.cg-coin3d\s*\{[^}]*animation:\s*cg-spin[^;]*infinite/);
  assert.match(css, /@keyframes cg-spin\s*\{[\s\S]*?rotateY\(0deg\)[\s\S]*?rotateY\(360deg\)/);
  assert.match(css, /\.cg-face\s*\{[^}]*backface-visibility:\s*hidden/);
  assert.match(css, /\.cg-face--back\s*\{[^}]*rotateY\(180deg\)/, 'the back face is pre-rotated so the glyph never reads mirrored');
  assert.match(js, /RIM_LAYERS\s*=\s*7/);
  assert.equal((js.match(/cg-face--front|cg-face--back/g) || []).length, 2);
  // the glyph path is the traced drawn coin: five closed sub-paths (ring + glyph pieces)
  const d = /GLYPH_PATH =\s*'([^']+)'/.exec(js)[1];
  assert.equal((d.match(/Z/g) || []).length, 5);
});

test('reduced motion: everything holds still and the card only fades', () => {
  const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  for (const sel of ['.cg-coin3d', '.cg-halo', '.cg-stage', '.cg-star', '.jiu-coin-balance.cg-bump']) {
    assert.ok(block.includes(sel), `${sel} must be calmed`);
  }
  assert.match(block, /\.cg-coin3d\s*\{[^}]*animation:\s*none/);
  assert.match(js, /prefersReduced\(\)/);
  assert.match(js, /if \(!fromRect \|\| prefersReduced\(\)\) return;/, 'no flying coins in reduced motion');
});

test('the card reuses the wheel art that exists on disk', () => {
  for (const f of ['lw-result-card@2x.webp', 'lw-go-default@2x.webp', 'lw-go-press@2x.webp']) {
    assert.ok(existsSync(new URL('../assets/lucky-wheel/' + f, import.meta.url)), f);
    assert.ok(css.includes(f), `css references ${f}`);
    assert.ok(js.includes(f), `warm-up preloads ${f}`);
  }
  const wheelCss = read('css/lucky-wheel.css');
  const v = /lw-result-card@2x\.webp\?v=(\w+)/.exec(wheelCss)[1];
  assert.ok(css.includes('?v=' + v), 'same cache-bust version as the wheel, so one download serves both');
});

test('each card is dismissible (button, Esc / Enter, backdrop) and guards against the ghost tap that caused it', () => {
  assert.match(js, /id="cgOk"/);
  assert.match(js, /e\.key === 'Escape'/);
  assert.match(js, /performance\.now\(\) - openedAt < 350/);
  assert.match(js, /role', 'dialog'/);
  assert.match(js, /aria-modal/);
});

test('sound: synthesized, no audio files, no settings switch, never schedules on a context that is not running', () => {
  assert.doesNotMatch(sfx, /new Audio\(|\.mp3|\.wav|\.ogg|fetch\(/);
  assert.match(sfx, /state === 'running'/);
  assert.match(sfx, /navigator\.vibrate\(14\)/);
  for (const f of ['index.html', 'js/settings.js', 'js/auth.js']) {
    if (!existsSync(new URL('../' + f, import.meta.url))) continue;
    assert.doesNotMatch(read(f), /音效开关|soundToggle|sfx-toggle/i);
  }
});

test('every earning site is wired to the card; every refund path is not', () => {
  const wired = {
    'js/jiu-coin.js': /showCoinGain\(dailyGain\(data\)\)/,
    'js/login-streak.js': /announceCoinGain\(streakGain\(data\.claimed\)\)/,
    'js/achievements.js': /achievementGain\(data\)/,
    'js/invite.js': /announceCoinGain\(gain\)/,
    'js/auth.js': /showCoinGain\(guestGain\(data\.user\)\)[\s\S]*showCoinGain\(registerGain\(data\.user\)\)/,
    'js/game-sync.js': /puzzleGains\(data\)/,
    'js/coin-stake-ui.js': /stakeGain\(s\.stake, s\.cloudGameId\)/,
    'js/pvp/result.js': /pvpGain\(view\)/,
    'js/daily-quiz.js': /quizGain\(settled, flow\.attemptId\)/,
    'js/lucky-wheel.js': /playGainFeedback\(Number\(copy\.amount\)\)/,
  };
  for (const [f, re] of Object.entries(wired)) assert.match(read(f), re, `${f} must show the coin card`);
  // the wheel only chimes for coin results, not for 后悔券 / spins
  assert.match(read('js/lucky-wheel.js'), /if \(copy\.kind === "coin"\) playGainFeedback/);
  // the PvP card is only for a fresh result (celebrate), never when re-opening an old match from history
  assert.match(read('js/pvp/result.js'), /if \(celebrate\) \{\s*Promise\.all\(\[import\("\.\.\/coin-gain-pure\.js"\)/);
  // refunds / admin adjustments are not earning: the card code never mentions them
  const pure = read('js/coin-gain-pure.js');
  assert.doesNotMatch(js + pure, /pvp_refund|admin_grant|admin_adjust|refund_|backfill/);
});

test('the old toasts that announced the same coins are gone (no double message)', () => {
  assert.doesNotMatch(read('js/login-streak.js'), /claimToast/);
  assert.doesNotMatch(read('js/invite.js'), /rewardToast\(reward\)/);
  assert.doesNotMatch(read('js/achievements.js'), /claimToast\(data\)/);
  assert.doesNotMatch(read('js/jiu-coin.js'), /openSuccessModal\(data\.amount\)/);
});

test('Android: the app may vibrate (navigator.vibrate inside the WebView needs the normal permission)', () => {
  assert.match(read('android-app/app/src/main/AndroidManifest.xml'), /android\.permission\.VIBRATE/);
});
