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
].join(', ');

const BACK_TEXT = /^(?:[←‹<]\s*)?返回/;
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
    .filter((b) => BACK_TEXT.test((b.textContent || '').trim()))
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

export function initBackHandler() {
  window.__sgBack = sgBack;
}
