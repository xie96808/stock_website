/** Page zoom aid: optional CSS zoom with localStorage persistence (sketchbook control). */
const STORAGE_KEY = 'pageZoom';
const PRESETS = [0.8, 0.9, 1, 1.1, 1.25];
const MIN = 0.8;
const MAX = 1.25;

function clampZoom(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 1;
  return Math.min(MAX, Math.max(MIN, Math.round(x * 100) / 100));
}

function readStoredZoom() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null || raw === '') return 1;
    return clampZoom(parseFloat(raw));
  } catch {
    return 1;
  }
}

function formatPct(z) {
  return `${Math.round(clampZoom(z) * 100)}%`;
}

/** Apply zoom via CSS zoom on <html> (WebKit/Blink/iOS Safari friendly). */
export function applyPageZoom(level, { persist = true } = {}) {
  const z = clampZoom(level);
  const html = document.documentElement;
  html.style.zoom = String(z);
  html.style.setProperty('--page-zoom', String(z));
  html.dataset.pageZoom = String(z);
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, String(z));
    } catch {
      /* ignore quota / private mode */
    }
  }
  syncZoomUi(z);
  // Charts may need a resize after layout scale changes
  try {
    window.dispatchEvent(new Event('resize'));
  } catch {
    /* ignore */
  }
  return z;
}

export function getPageZoom() {
  const fromData = Number(document.documentElement.dataset.pageZoom);
  if (Number.isFinite(fromData) && fromData > 0) return clampZoom(fromData);
  return readStoredZoom();
}

function syncZoomUi(z) {
  const label = document.getElementById('pageZoomLabel');
  if (label) label.textContent = formatPct(z);
  document.querySelectorAll('[data-zoom-preset]').forEach((btn) => {
    const v = clampZoom(btn.getAttribute('data-zoom-preset'));
    const on = Math.abs(v - z) < 0.001;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-checked', on ? 'true' : 'false');
  });
}

function closestPreset(z, dir) {
  const cur = clampZoom(z);
  if (dir < 0) {
    const lower = PRESETS.filter((p) => p < cur - 0.001);
    return lower.length ? lower[lower.length - 1] : MIN;
  }
  const higher = PRESETS.filter((p) => p > cur + 0.001);
  return higher.length ? higher[0] : MAX;
}

function setMenuOpen(open) {
  const menu = document.getElementById('pageZoomMenu');
  const toggle = document.getElementById('pageZoomToggle');
  if (!menu || !toggle) return;
  menu.hidden = !open;
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
}

export function initPageZoom() {
  const root = document.getElementById('pageZoom');
  if (!root || root.dataset.ready === '1') {
    applyPageZoom(readStoredZoom(), { persist: false });
    return;
  }
  root.dataset.ready = '1';

  const z0 = readStoredZoom();
  applyPageZoom(z0, { persist: false });

  const toggle = document.getElementById('pageZoomToggle');
  const menu = document.getElementById('pageZoomMenu');
  const minus = document.getElementById('pageZoomMinus');
  const plus = document.getElementById('pageZoomPlus');

  if (toggle && menu) {
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      setMenuOpen(menu.hidden);
    });
    menu.addEventListener('click', (e) => e.stopPropagation());
  }

  document.querySelectorAll('[data-zoom-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      applyPageZoom(btn.getAttribute('data-zoom-preset'));
      setMenuOpen(false);
    });
  });

  if (minus) {
    minus.addEventListener('click', (e) => {
      e.stopPropagation();
      applyPageZoom(closestPreset(getPageZoom(), -1));
    });
  }
  if (plus) {
    plus.addEventListener('click', (e) => {
      e.stopPropagation();
      applyPageZoom(closestPreset(getPageZoom(), 1));
    });
  }

  document.addEventListener('click', () => setMenuOpen(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setMenuOpen(false);
  });
}
