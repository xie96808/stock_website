/**
 * Publishes the fixed phone action bar's real height as --action-zone-h on <html> so the game screen can
 * reserve exactly that much bottom padding (the bar grows/shrinks with hints, 快进, 反悔, 结算).
 * Padding change never feeds back into the bar's own size (position: fixed) → no ResizeObserver loop,
 * and it only affects space *below* the K-line, so the chart itself never moves.
 */
let observer = null;
let observed = null;

export function syncActionZoneHeight() {
  const z = document.querySelector('.action-zone');
  if (!z) return;
  const fixed = getComputedStyle(z).position === 'fixed';
  const h = fixed ? Math.ceil(z.getBoundingClientRect().height) : 0;
  const root = document.documentElement;
  const next = h + 'px';
  if (root.style.getPropertyValue('--action-zone-h') !== next) {
    root.style.setProperty('--action-zone-h', next);
  }
}

export function initActionZoneSync() {
  const z = document.querySelector('.action-zone');
  if (!z) return;
  if (typeof ResizeObserver === 'function' && observed !== z) {
    if (observer) observer.disconnect();
    observer = new ResizeObserver(() => syncActionZoneHeight());
    observer.observe(z);
    observed = z;
    window.addEventListener('resize', syncActionZoneHeight, { passive: true });
  }
  syncActionZoneHeight();
}
