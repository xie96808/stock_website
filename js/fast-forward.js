/**
 * In-game fast-forward: append one `hold` per day, then stop.
 * Settlement length and buy/sell rules stay with the shared engine.
 */

export const FAST_FORWARD_ACTION = 'hold';
export const FF_ARM_MS = 380;
export const FF_STEP_MS = 200;
export const FF_BUSY_POLL_MS = 40;

export function fastForwardHintText(tap, active) {
  if (active) {
    return tap ? '快进中 · 再点「快进」停下' : '快进中 · 松开「观望」即停';
  }
  if (tap) {
    return '长按「观望」可快进。手机点「快进」，再点一次停下';
  }
  return '长按「观望」连续快进，松开即停';
}

export function prefersTapFastForward({ coarse = false, narrow = false } = {}) {
  return !!(coarse || narrow);
}

/** While fast-forwarding, keep these controls enabled so a cloud lock does not cancel the press. */
export function shouldUnlockControlDuringFastForward(id, active) {
  return !!active && (id === 'holdBtn' || id === 'fastForwardBtn');
}

export function fastForwardChrome({
  tap = false,
  active = false,
  settle = false,
  rewindBusy = false,
  decisionBusy = false,
} = {}) {
  const busy = !!(rewindBusy || decisionBusy);
  return {
    tapLayout: !!tap && !settle,
    buttonHidden: !tap || !!settle,
    buttonDisabled: !!settle || (!active && busy),
    buttonPressed: !!active,
    buttonLabel: active ? '停止' : '快进',
    holdForwarding: !!active,
    hintHidden: !!settle,
    hint: fastForwardHintText(!!tap, !!active),
  };
}

/**
 * @param {object} deps
 * @param {() => Promise<boolean>} deps.step commit one hold; true if the tape grew
 * @param {() => { currentDay: number, gameDays: number, screenActive: boolean, rewindBusy: boolean, decisionBusy: boolean, holdHidden: boolean, holdDisabled: boolean }} deps.read
 */
export function createFastForwardController({
  step,
  read,
  onChange = () => {},
  schedule = (fn, ms) => setTimeout(fn, ms),
  clearSchedule = (id) => clearTimeout(id),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  armMs = FF_ARM_MS,
  stepMs = FF_STEP_MS,
  busyPollMs = FF_BUSY_POLL_MS,
} = {}) {
  if (typeof step !== 'function' || typeof read !== 'function') {
    throw new TypeError('fast-forward requires step and read');
  }

  let active = false;
  let loopRunning = false;
  let pointerId = null;
  let armTimer = null;
  let suppressClick = false;

  function setActive(next) {
    if (active === next) return;
    active = next;
    onChange();
  }

  function clearArm() {
    if (armTimer != null) {
      clearSchedule(armTimer);
      armTimer = null;
    }
  }

  function canStart(fromHoldPress) {
    const snap = read();
    if (!(snap.currentDay < snap.gameDays)) return false;
    if (snap.holdHidden) return false;
    if (snap.holdDisabled && !fromHoldPress) return false;
    return true;
  }

  async function runLoop() {
    if (loopRunning) return;
    loopRunning = true;
    try {
      while (active) {
        const snap = read();
        if (!snap.screenActive) break;
        if (!(snap.currentDay < snap.gameDays)) break;
        if (snap.rewindBusy) break;
        if (snap.decisionBusy) {
          await sleep(busyPollMs);
          continue;
        }
        if (snap.holdHidden) break;
        const advanced = await step();
        if (!active) break;
        if (!advanced) {
          setActive(false);
          break;
        }
        await sleep(stepMs);
      }
    } finally {
      loopRunning = false;
      const snap = read();
      const terminal = !(snap.currentDay < snap.gameDays)
        || !snap.screenActive
        || !!snap.rewindBusy
        || !!snap.holdHidden;
      if (terminal) setActive(false);
    }
  }

  function start(fromHoldPress) {
    if (active) return false;
    if (!canStart(fromHoldPress)) return false;
    if (fromHoldPress) suppressClick = true;
    setActive(true);
    void runLoop();
    return true;
  }

  function stop() {
    clearArm();
    setActive(false);
  }

  function pointerDown({ pointerId: id, button = 0, holdDisabled = false, holdHidden = false } = {}) {
    if (button != null && button !== 0) return false;
    if (holdDisabled || holdHidden || active) return false;
    pointerId = id;
    clearArm();
    armTimer = schedule(() => {
      armTimer = null;
      start(true);
    }, armMs);
    return true;
  }

  function pointerEnd({ pointerId: id, cancelled = false } = {}) {
    if (pointerId == null || id !== pointerId) return false;
    if (cancelled && active && read().decisionBusy) return false;
    clearArm();
    const was = active;
    if (was) setActive(false);
    pointerId = null;
    return was;
  }

  function holdClick() {
    if (suppressClick) {
      suppressClick = false;
      return 'suppress';
    }
    if (active) return 'ignore';
    return 'step';
  }

  function toggle() {
    if (active) {
      stop();
      return 'stop';
    }
    return start(false) ? 'start' : 'noop';
  }

  function interrupt() {
    if (!active) return false;
    stop();
    return true;
  }

  return {
    pointerDown,
    pointerEnd,
    holdClick,
    toggle,
    interrupt,
    stop,
    isActive: () => active,
    isLoopRunning: () => loopRunning,
  };
}
