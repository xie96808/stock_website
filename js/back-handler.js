/**
 * A-01 · System back for the Android App (and any host that wants it).
 *
 * The site routes with history.replaceState, so WebView.canGoBack() is false
 * almost everywhere and the App's back key used to finish the Activity — even
 * mid-game or with a dialog open. window.__sgBack() handles one back step:
 *   1. close the topmost open dialog / sheet (via its own close control),
 *   2. else press the current screen's own 「返回…」 button,
 *   3. else stay put on screens that must not be left by accident (对局 / 对战房间),
 *   4. else (home) return false so the host may exit.
 * It returns true when the press was handled. The App must call it first
 * (evaluateJavascript) and only finish() on "false" — that part ships with the
 * next App release.
 *
 * Web (browser back button / Android gesture in a plain browser): the same single
 * decision is wired to history. One {sgGuard:true} entry sits on top of the page's
 * base entry; popping it lands on the base entry, where we run sgBack() and, if it
 * handled the press, push the guard again. If sgBack() says "exit" (home, nothing
 * open) we step back once more so the browser really leaves — one gesture, no dead press.
 * The play-modes sheet keeps its own {pmSheet:true} entry above the guard.
 */

const CLOSE_SEL = [
  '[aria-label="关闭"]',
  '.jiu-coin-close-x',
  '.pm-sheet-close',
  '.lw-close',
  '.auth-close',
  '.announcements-close-x',
  '.feedback-close-x',
  '.pvp-rank-help-close',
  '.pvp-opp-card-close',
  '.sg-exit-continue',
].join(', ');

const BACK_TEXT = /^(?:[←‹<]\s*)?(?:返回|退出对局)/;
// Back buttons whose text starts with something else (「← 封存档案 / 返回首页」 two-line label).
const BACK_EXTRA_SEL = '.hindsight-back';
const STAY_SCREENS = ['gameScreen', 'pvpRoomScreen'];

/**
 * Pure decision. `c` lists what is on screen (topmost-first where it matters):
 *   { closers: [id|label…], fillModeOpen, backButtons: [...], activeScreens: [...] }
 */
export function chooseBackAction(c = {}) {
  if (c.closers && c.closers.length) return { kind: 'close', target: c.closers[0] };
  if (c.fillModeOpen) return { kind: 'cancel-fill-mode' };
  if (c.backButtons && c.backButtons.length) return { kind: 'back-button', target: c.backButtons[0] };
  const active = c.activeScreens || [];
  if (active.some((id) => STAY_SCREENS.includes(id))) return { kind: 'stay' };
  return { kind: 'exit' };
}

function isTopmostVisible(el) {
  if (!el || el.disabled) return false;
  const r = el.getBoundingClientRect();
  if (!(r.width > 0 && r.height > 0)) return false;
  if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) return false;
  const cs = getComputedStyle(el);
  if (cs.visibility === 'hidden' || cs.display === 'none' || cs.pointerEvents === 'none') return false;
  const x = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1);
  const y = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1);
  const hit = document.elementFromPoint(x, y);
  return !!hit && (hit === el || el.contains(hit));
}

function collect() {
  const closers = [...document.querySelectorAll(CLOSE_SEL)].filter(isTopmostVisible);
  const fill = document.getElementById('fillModeModal');
  const fillModeOpen = !!(fill && !fill.hidden && fill.getBoundingClientRect().height > 0);
  const backButtons = [...document.querySelectorAll('button, a[href], [role="button"]')]
    .filter((b) => BACK_TEXT.test((b.textContent || '').trim()) || b.matches(BACK_EXTRA_SEL))
    .filter(isTopmostVisible);
  const activeScreens = STAY_SCREENS.filter((id) => document.getElementById(id)?.classList.contains('active'));
  return { closers, fillModeOpen, backButtons, activeScreens };
}

export function sgBack() {
  try {
    const action = chooseBackAction(collect());
    switch (action.kind) {
      case 'close':
      case 'back-button':
        action.target.click();
        return true;
      case 'cancel-fill-mode':
        if (typeof window.cancelFillModeModal === 'function') window.cancelFillModeModal();
        return true;
      case 'stay':
        return true;
      default:
        return false;
    }
  } catch (err) {
    console.warn('sgBack', err);
    return true; // never let a script error turn into "exit the App"
  }
}

/**
 * Pure: what should a popstate do? `landed` = state / href of the entry we are now on,
 * `baseHref` = href of the base entry (the one under the guard).
 * Only the base entry itself counts: guard / pm-sheet entries are above it, and a
 * hand-edited hash or forward navigation lands on some other href — leave those alone.
 */
export function chooseWebBackStep({ state, href, baseHref } = {}) {
  if (state && (state.sgGuard || state.pmSheet)) return 'ignore';
  if (!baseHref || href !== baseHref) return 'ignore';
  return 'handle';
}

let webBackInstalled = false;

function initWebBack() {
  if (webBackInstalled || typeof history === 'undefined' || typeof window === 'undefined') return;
  webBackInstalled = true;
  let baseHref = location.href;
  const arm = () => {
    try {
      baseHref = location.href;
      history.pushState({ sgGuard: true }, '', location.href);
    } catch {
      /* ignore: no history API → plain browser behaviour */
    }
  };
  arm();
  window.addEventListener('popstate', () => {
    if (chooseWebBackStep({ state: history.state, href: location.href, baseHref }) !== 'handle') return;
    if (sgBack()) {
      arm();
    } else {
      try { history.back(); } catch { /* ignore */ }
    }
  });
}

export function initBackHandler() {
  window.__sgBack = sgBack;
  initWebBack();
}
