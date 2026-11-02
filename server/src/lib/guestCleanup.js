import { config } from "./config.js";
import { purgeGuestUsers } from "./users.js";

/** 游客先玩: delete guests that never registered and have been idle for the whole guest lifetime (30 days). */
export function runGuestCleanup(now = Date.now()) {
  const res = purgeGuestUsers({ maxIdleMs: config.guestSessionMs, now });
  if (res.purged || res.skipped) {
    console.log(`[guest] cleanup purged=${res.purged} skipped=${res.skipped}`);
  }
  return res;
}

const SIX_HOURS = 6 * 60 * 60 * 1000;

/** Sweep shortly after boot, then every 6 hours. The timers never keep the process alive. */
export function startGuestCleanup() {
  const first = setTimeout(() => {
    try { runGuestCleanup(); } catch (e) { console.error("guest cleanup failed:", e && e.message ? e.message : e); }
  }, 60_000);
  first.unref();
  const timer = setInterval(() => {
    try { runGuestCleanup(); } catch (e) { console.error("guest cleanup failed:", e && e.message ? e.message : e); }
  }, SIX_HOURS);
  timer.unref();
}
