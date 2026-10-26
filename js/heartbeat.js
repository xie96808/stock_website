/**
 * 使用时长心跳：登录用户在页面「可见且最近有操作」时，每 30 秒向 /me/heartbeat 报一次到。
 * 服务端据此累计在线人数 / 使用时长（后台「数据」页）。失败静默，不影响游戏。
 * 纯逻辑（shouldBeat）单独导出，便于单测。
 */
export const BEAT_MS = 30000;
/** 超过这么久没有任何操作就视为挂机，暂停上报。 */
export const IDLE_MS = 5 * 60 * 1000;

/** Pure: should a heartbeat be sent right now? */
export function shouldBeat({ authed, hidden, now, lastInput, lastBeat }) {
  if (!authed || hidden) return false;
  if (now - lastInput > IDLE_MS) return false;
  if (lastBeat != null && now - lastBeat < BEAT_MS - 2000) return false;
  return true;
}

export function createHeartbeat({ isAuthed, send, doc = typeof document !== "undefined" ? document : null, win = typeof window !== "undefined" ? window : null, now = () => Date.now(), setIntervalFn = setInterval, clearIntervalFn = clearInterval }) {
  let timer = null;
  let lastInput = now();
  let lastBeat = null;
  let inflight = false;

  const tick = async () => {
    if (inflight) return;
    const t = now();
    if (!shouldBeat({ authed: isAuthed(), hidden: !!doc?.hidden, now: t, lastInput, lastBeat })) return;
    inflight = true;
    lastBeat = t;
    try { await send(); } catch { /* best effort */ } finally { inflight = false; }
  };
  const onInput = () => {
    const wasIdle = now() - lastInput > IDLE_MS;
    lastInput = now();
    if (wasIdle) tick();
  };
  const onVisible = () => { if (!doc?.hidden) { lastInput = Math.max(lastInput, now() - 1000); tick(); } };

  return {
    start() {
      if (timer) return;
      timer = setIntervalFn(tick, BEAT_MS);
      for (const ev of ["pointerdown", "keydown", "touchstart", "scroll", "wheel"]) win?.addEventListener?.(ev, onInput, { passive: true, capture: true });
      doc?.addEventListener?.("visibilitychange", onVisible);
      tick();
    },
    stop() {
      if (timer) clearIntervalFn(timer);
      timer = null;
      for (const ev of ["pointerdown", "keydown", "touchstart", "scroll", "wheel"]) win?.removeEventListener?.(ev, onInput, { capture: true });
      doc?.removeEventListener?.("visibilitychange", onVisible);
    },
    tick,
    _state: () => ({ lastInput, lastBeat, running: !!timer }),
  };
}
