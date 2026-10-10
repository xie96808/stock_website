/** Top-left chrome overflow: collapse theme (+ page zoom when visible) into 「⋯」
 * when horizontal space is tight, without burying 公告 / 登录.
 *
 * Desktop (≥900) never collapses. ≤480 always collapses. Mid widths use
 * measured overlap between left chrome and right auth chip.
 */

const FORCE_COLLAPSE_MQ = '(max-width: 480px)';
const NEVER_COLLAPSE_MQ = '(min-width: 900px)';
const GAP_PX = 16;
/** Hysteresis: once collapsed mid-width, require more slack before expanding. */
const EXPAND_GAP_PX = 48;

let collapsed = false;
let menuOpen = false;
let ready = false;
/** Last measured width of expanded inline chrome (theme + zoom). */
let cachedExpandedWidth = 0;

/** Pure: decide collapse from viewport + rects (testable). */
export function shouldCollapseChrome({
  viewportWidth,
  leftRight,
  rightLeft,
  currentlyCollapsed = false,
  forceMax = 480,
  neverMin = 900,
  tightGap = GAP_PX,
  expandGap = EXPAND_GAP_PX,
} = {}) {
  const w = Number(viewportWidth);
  if (!Number.isFinite(w)) return currentlyCollapsed;
  if (w >= neverMin) return false;
  if (w <= forceMax) return true;
  const gap = Number(rightLeft) - Number(leftRight);
  if (!Number.isFinite(gap)) return w <= forceMax;
  if (currentlyCollapsed) return gap < expandGap;
  return gap < tightGap;
}

function els() {
  return {
    root: document.getElementById('topLeftChrome'),
    btn: document.getElementById('chromeOverflowBtn'),
    menu: document.getElementById('chromeOverflowMenu'),
    inline: document.getElementById('chromeOverflowInline'),
    theme: document.querySelector('#topLeftChrome .theme-toggle'),
    zoom: document.getElementById('pageZoom'),
    chip: document.getElementById('authChip'),
  };
}

function setMenuOpen(open) {
  const { btn, menu } = els();
  if (!btn || !menu) return;
  menuOpen = !!open;
  menu.hidden = !menuOpen;
  btn.setAttribute('aria-expanded', menuOpen ? 'true' : 'false');
  document.documentElement.classList.toggle('chrome-overflow-open', menuOpen);
}

function parkControls(intoMenu) {
  const { menu, inline, theme, zoom } = els();
  if (!menu || !inline) return;
  const host = intoMenu ? menu : inline;
  if (theme && theme.parentElement !== host) host.appendChild(theme);
  if (zoom && zoom.parentElement !== host) host.appendChild(zoom);
}

function estimateLeftRight(root) {
  const rect = root.getBoundingClientRect();
  if (!collapsed) {
    cachedExpandedWidth = Math.max(cachedExpandedWidth, rect.width);
    return rect.right;
  }
  const est = cachedExpandedWidth > 0 ? cachedExpandedWidth : 168;
  return rect.left + est;
}

function measureAndApply() {
  const { root, btn, chip, inline } = els();
  if (!root || !btn || !inline) return;

  let next = false;
  try {
    if (window.matchMedia(NEVER_COLLAPSE_MQ).matches) {
      next = false;
    } else if (window.matchMedia(FORCE_COLLAPSE_MQ).matches) {
      next = true;
    } else {
      const leftRight = estimateLeftRight(root);
      const rr = chip ? chip.getBoundingClientRect() : { left: window.innerWidth };
      next = shouldCollapseChrome({
        viewportWidth: window.innerWidth,
        leftRight,
        rightLeft: rr.left,
        currentlyCollapsed: collapsed,
      });
    }
  } catch {
    next = typeof window !== 'undefined' && window.innerWidth <= 480;
  }

  applyCollapse(next);
}

function applyCollapse(next) {
  const { root, btn, inline } = els();
  if (!root || !btn) return;
  if (!collapsed && inline) {
    const w = inline.getBoundingClientRect().width;
    if (w > 0) cachedExpandedWidth = Math.max(cachedExpandedWidth, w + 8);
  }
  collapsed = next;
  root.classList.toggle('is-chrome-collapsed', collapsed);
  btn.hidden = !collapsed;
  parkControls(collapsed);
  if (!collapsed || !menuOpen) setMenuOpen(false);
}

function onDocPointer(e) {
  if (!menuOpen) return;
  const { btn, menu } = els();
  const t = e.target;
  if (btn && (btn === t || btn.contains(t))) return;
  if (menu && (menu === t || menu.contains(t))) return;
  setMenuOpen(false);
}

export function initChromeOverflow() {
  const { root, btn, menu } = els();
  if (!root || !btn || !menu) return;
  if (ready) {
    measureAndApply();
    return;
  }
  ready = true;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!collapsed) return;
    setMenuOpen(!menuOpen);
  });
  menu.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  document.addEventListener('click', onDocPointer);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setMenuOpen(false);
  });

  let raf = 0;
  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      measureAndApply();
    });
  };

  window.addEventListener('resize', schedule);
  try {
    const mqForce = window.matchMedia(FORCE_COLLAPSE_MQ);
    const mqNever = window.matchMedia(NEVER_COLLAPSE_MQ);
    const onMq = () => schedule();
    if (mqForce.addEventListener) {
      mqForce.addEventListener('change', onMq);
      mqNever.addEventListener('change', onMq);
    } else if (mqForce.addListener) {
      mqForce.addListener(onMq);
      mqNever.addListener(onMq);
    }
  } catch {
    /* ignore */
  }

  const chip = document.getElementById('authChip');
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(schedule);
    if (chip) ro.observe(chip);
    ro.observe(root);
  }

  measureAndApply();
}

/** Test-only */
export function __resetChromeOverflowForTests() {
  collapsed = false;
  menuOpen = false;
  ready = false;
  cachedExpandedWidth = 0;
}
