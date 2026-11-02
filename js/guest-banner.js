/**
 * 游客先玩 — result-page banner: "保存战绩，领 500 韭币". Visible only while the visitor holds a guest session
 * (the element lives inside #resultScreen, so it only shows on the result page). Registering turns the guest
 * into a normal user, the auth state flips, and the banner disappears on its own.
 */
import { getAuthState, selectIsGuest, openAuthModal } from './auth.js';
import { GUEST_BANNER, GUEST_AUTH_REASON } from './guest-play-pure.js';

const $ = (id) => document.getElementById(id);
let inited = false;

export function paintGuestBanner() {
  const el = $('resultGuestBanner');
  if (!el) return;
  const show = selectIsGuest(getAuthState());
  el.hidden = !show;
  if (!show) return;
  const t = $('resultGuestBannerTitle');
  const s = $('resultGuestBannerSub');
  const b = $('resultGuestBannerBtn');
  if (t) t.textContent = GUEST_BANNER.title;
  if (s) s.textContent = GUEST_BANNER.sub;
  if (b) b.textContent = GUEST_BANNER.action;
}

export function initGuestBanner() {
  if (inited) return;
  inited = true;
  const b = $('resultGuestBannerBtn');
  if (b) b.addEventListener('click', () => openAuthModal('register', { reason: GUEST_AUTH_REASON.SAVE }));
  document.addEventListener('stockgame:auth-changed', paintGuestBanner);
  paintGuestBanner();
}
