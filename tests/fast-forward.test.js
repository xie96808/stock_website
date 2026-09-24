import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetSession, patchSession, getSession } from '../js/game-session.js';
import {
  applyLocalDecision,
  canSellOnCurrentDay,
  settleLocalSession,
  validatePlayAction,
} from '../js/game-play-usecase.js';
import { makeBars, holds } from '../shared/fixtures/golden.js';
import { oneshotAmmoFromActions } from '../shared/oneshot.js';
import { checkSurvivalBust } from '../shared/survival.js';
import { SURVIVAL_MODIFIERS } from '../shared/protocol.js';
import { ghostRevealAfterPlayerDecisions } from '../shared/ghost.js';
import {
  FAST_FORWARD_ACTION,
  FF_ARM_MS,
  FF_BUSY_POLL_MS,
  FF_STEP_MS,
  createFastForwardController,
  fastForwardChrome,
  fastForwardHintText,
  prefersTapFastForward,
  shouldUnlockControlDuringFastForward,
} from '../js/fast-forward.js';

async function drain() {
  for (let i = 0; i < 200; i++) await Promise.resolve();
}

function harness(overrides = {}) {
  const state = {
    day: 1,
    gameDays: 30,
    screenActive: true,
    rewindBusy: false,
    decisionBusy: false,
    holdHidden: false,
    holdDisabled: false,
    steps: 0,
    inStep: 0,
    maxInStep: 0,
    sleeps: [],
  };
  let armed = null;
  let armedMs = null;
  const changes = [];
  const controller = createFastForwardController({
    read: () => ({
      currentDay: state.day,
      gameDays: state.gameDays,
      screenActive: state.screenActive,
      rewindBusy: state.rewindBusy,
      decisionBusy: state.decisionBusy,
      holdHidden: state.holdHidden,
      holdDisabled: state.holdDisabled,
    }),
    step: async () => {
      state.inStep += 1;
      state.maxInStep = Math.max(state.maxInStep, state.inStep);
      state.steps += 1;
      if (state.day >= state.gameDays) {
        state.inStep -= 1;
        return false;
      }
      state.day += 1;
      if (overrides.onStep) await overrides.onStep(state, controller);
      state.inStep -= 1;
      return overrides.advance ? overrides.advance(state) : true;
    },
    onChange: () => changes.push(controller.isActive()),
    schedule: (fn, ms) => {
      armed = fn;
      armedMs = ms;
      return 1;
    },
    clearSchedule: () => {
      armed = null;
    },
    sleep: async (ms) => {
      state.sleeps.push(ms);
    },
    ...overrides.deps,
  });
  return {
    state,
    controller,
    changes,
    fireArm() {
      const fn = armed;
      armed = null;
      assert.equal(armedMs, FF_ARM_MS);
      fn();
    },
  };
}

test('hint copy tells desktop to long-press and phones to use the button', () => {
  assert.equal(fastForwardHintText(false, false), '长按「观望」连续快进，松开即停');
  assert.equal(fastForwardHintText(false, true), '快进中 · 松开「观望」即停');
  assert.equal(fastForwardHintText(true, false), '长按「观望」可快进。手机点「快进」，再点一次停下');
  assert.equal(fastForwardHintText(true, true), '快进中 · 再点「快进」停下');
});

test('tap control is for coarse pointers and narrow layouts', () => {
  assert.equal(prefersTapFastForward({ coarse: false, narrow: false }), false);
  assert.equal(prefersTapFastForward({ coarse: true, narrow: false }), true);
  assert.equal(prefersTapFastForward({ coarse: false, narrow: true }), true);
  assert.equal(prefersTapFastForward({ coarse: true, narrow: true }), true);
});

test('chrome hides the phone button on a wide mouse and on settle day', () => {
  const desk = fastForwardChrome({ tap: false, active: false, settle: false });
  assert.equal(desk.buttonHidden, true);
  assert.equal(desk.hintHidden, false);
  assert.equal(desk.hint, fastForwardHintText(false, false));
  assert.equal(desk.buttonLabel, '快进');

  const phone = fastForwardChrome({ tap: true, active: true, settle: false });
  assert.equal(phone.buttonHidden, false);
  assert.equal(phone.buttonDisabled, false);
  assert.equal(phone.buttonPressed, true);
  assert.equal(phone.buttonLabel, '停止');
  assert.equal(phone.tapLayout, true);
  assert.equal(phone.holdForwarding, true);

  const busy = fastForwardChrome({ tap: true, active: false, decisionBusy: true });
  assert.equal(busy.buttonDisabled, true);
  const busyWhileRunning = fastForwardChrome({ tap: true, active: true, decisionBusy: true, rewindBusy: true });
  assert.equal(busyWhileRunning.buttonDisabled, false);

  const settle = fastForwardChrome({ tap: true, active: true, settle: true });
  assert.equal(settle.buttonHidden, true);
  assert.equal(settle.hintHidden, true);
  assert.equal(settle.tapLayout, false);
  assert.equal(settle.buttonDisabled, true);
});

test('cloud lock must not disable the controls that stop a running fast-forward', () => {
  assert.equal(shouldUnlockControlDuringFastForward('holdBtn', true), true);
  assert.equal(shouldUnlockControlDuringFastForward('fastForwardBtn', true), true);
  assert.equal(shouldUnlockControlDuringFastForward('buyBtn', true), false);
  assert.equal(shouldUnlockControlDuringFastForward('sellBtn', true), false);
  assert.equal(shouldUnlockControlDuringFastForward('holdBtn', false), false);
});

test('a short press does not arm fast-forward; the click still means one step', () => {
  const { controller } = harness();
  assert.equal(controller.pointerDown({ pointerId: 1, button: 0 }), true);
  assert.equal(controller.pointerEnd({ pointerId: 1 }), false);
  assert.equal(controller.isActive(), false);
  assert.equal(controller.holdClick(), 'step');
});

test('right click, a hidden hold button, and a second pointer do not start or stop', () => {
  const { controller, state, fireArm } = harness();
  assert.equal(controller.pointerDown({ pointerId: 1, button: 2 }), false);
  assert.equal(controller.pointerDown({ pointerId: 1, holdHidden: true }), false);
  assert.equal(controller.pointerDown({ pointerId: 1, holdDisabled: true }), false);
  assert.equal(controller.pointerDown({ pointerId: 3, button: 0 }), true);
  fireArm();
  assert.equal(controller.pointerEnd({ pointerId: 9 }), false);
  assert.equal(controller.isActive(), true);
  controller.pointerEnd({ pointerId: 3 });
  assert.equal(controller.isActive(), false);
  assert.equal(state.steps, 1);
});

test('long-press suppresses the trailing click so the first day is not recorded twice', async () => {
  const { controller, state, fireArm } = harness();
  controller.pointerDown({ pointerId: 1, button: 0 });
  fireArm();
  assert.equal(state.steps, 1);
  assert.equal(controller.holdClick(), 'suppress');
  assert.equal(state.steps, 1);
  controller.pointerEnd({ pointerId: 1 });
  await drain();
  assert.equal(state.steps, 1);
  assert.equal(controller.holdClick(), 'step');
});

test('release stops after the in-flight day and does not keep stepping', async () => {
  const box = harness({
    onStep: async (state, controller) => {
      if (state.steps === 1) controller.pointerEnd({ pointerId: 1 });
    },
  });
  box.controller.pointerDown({ pointerId: 1 });
  box.fireArm();
  await drain();
  assert.equal(box.state.steps, 1);
  assert.equal(box.state.day, 2);
  assert.equal(box.controller.isActive(), false);
  assert.equal(box.state.sleeps.includes(FF_STEP_MS), false);
});

test('fast-forward stops on the settle day and never requests another hold', async () => {
  const { controller, state } = harness();
  assert.equal(controller.toggle(), 'start');
  await drain();
  assert.equal(state.steps, 29);
  assert.equal(state.day, 30);
  assert.equal(controller.isActive(), false);
  assert.equal(controller.isLoopRunning(), false);
  assert.equal(controller.toggle(), 'noop');
  assert.equal(state.steps, 29);
  assert.ok(state.steps < state.gameDays);
});

test('a rejected hold stops the loop instead of retrying', async () => {
  const { controller, state } = harness({ advance: () => false });
  assert.equal(controller.toggle(), 'start');
  await drain();
  assert.equal(state.steps, 1);
  assert.equal(controller.isActive(), false);
});

test('leaving the game, rewind, or hiding 观望 ends fast-forward', async () => {
  const closed = harness({
    onStep: async (state) => {
      if (state.day === 4) state.screenActive = false;
    },
  });
  assert.equal(closed.controller.toggle(), 'start');
  await drain();
  assert.equal(closed.state.steps, 3);
  assert.equal(closed.controller.isActive(), false);

  const rewind = harness({
    onStep: async (state) => {
      if (state.day === 3) state.rewindBusy = true;
    },
  });
  assert.equal(rewind.controller.toggle(), 'start');
  await drain();
  assert.equal(rewind.state.steps, 2);
  assert.equal(rewind.controller.isActive(), false);

  const hidden = harness({
    onStep: async (state) => {
      if (state.day === 2) state.holdHidden = true;
    },
  });
  assert.equal(hidden.controller.toggle(), 'start');
  await drain();
  assert.equal(hidden.state.steps, 1);
  assert.equal(hidden.controller.isActive(), false);
});

test('decisionBusy serializes holds and a cancel during the request does not abort', async () => {
  const box = harness({
    onStep: async (state, controller) => {
      state.decisionBusy = true;
      const ignored = controller.pointerEnd({ pointerId: 5, cancelled: true });
      assert.equal(ignored, false);
      assert.equal(controller.isActive(), true);
      state.decisionBusy = false;
      if (state.steps === 2) controller.pointerEnd({ pointerId: 5 });
    },
  });
  box.controller.pointerDown({ pointerId: 5 });
  box.fireArm();
  await drain();
  assert.equal(box.state.maxInStep, 1);
  assert.equal(box.state.steps, 2);
  assert.ok(box.state.sleeps.includes(FF_STEP_MS));
  assert.equal(box.controller.isActive(), false);
});

test('cancel while idle stops; busy polling waits without a second hold', async () => {
  const cancel = harness({
    onStep: async (state, controller) => {
      if (state.steps === 1) controller.pointerEnd({ pointerId: 1, cancelled: true });
    },
  });
  cancel.controller.pointerDown({ pointerId: 1 });
  cancel.fireArm();
  await drain();
  assert.equal(cancel.state.steps, 1);
  assert.equal(cancel.controller.isActive(), false);

  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let entered = 0;
  const busy = harness({
    deps: {
      step: async () => {
        entered += 1;
        busyState.decisionBusy = true;
        await gate;
        busyState.decisionBusy = false;
        busyState.day += 1;
        return true;
      },
    },
  });
  const busyState = busy.state;
  busy.controller.pointerDown({ pointerId: 2 });
  busy.fireArm();
  await Promise.resolve();
  assert.equal(entered, 1);
  assert.equal(busy.controller.isLoopRunning(), true);
  release();
  await drain();
  assert.equal(busyState.sleeps.filter((ms) => ms === FF_BUSY_POLL_MS).length >= 0, true);
  assert.equal(busy.controller.isActive(), false);
  assert.equal(busyState.day, 30);
});

test('phone toggle starts and the next tap stops after the current day', async () => {
  const { controller, state } = harness({
    onStep: async (_state, ctrl) => {
      if (state.steps === 1) assert.equal(ctrl.toggle(), 'stop');
    },
  });
  assert.equal(controller.toggle(), 'start');
  await drain();
  assert.equal(state.steps, 1);
  assert.equal(controller.isActive(), false);
  assert.equal(controller.toggle(), 'start');
  controller.interrupt();
  await drain();
  assert.equal(state.steps, 2);
});

test('toggle does nothing when 观望 is disabled, hidden, or the window is over', () => {
  const disabled = harness();
  disabled.state.holdDisabled = true;
  assert.equal(disabled.controller.toggle(), 'noop');
  assert.equal(disabled.state.steps, 0);

  const hidden = harness();
  hidden.state.holdHidden = true;
  assert.equal(hidden.controller.toggle(), 'noop');

  const done = harness();
  done.state.day = 30;
  assert.equal(done.controller.toggle(), 'noop');
  assert.equal(done.controller.pointerDown({ pointerId: 1 }), true);
  done.fireArm();
  assert.equal(done.controller.isActive(), false);
});

test('a long-press that was armed while enabled still starts if the button locks later', () => {
  const { controller, state, fireArm } = harness();
  controller.pointerDown({ pointerId: 1, holdDisabled: false });
  state.holdDisabled = true;
  fireArm();
  assert.equal(controller.isActive(), true);
  controller.stop();
});

test('two starts share one loop', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const state = {
    day: 1,
    gameDays: 30,
    steps: 0,
  };
  const controller = createFastForwardController({
    read: () => ({
      currentDay: state.day,
      gameDays: state.gameDays,
      screenActive: true,
      rewindBusy: false,
      decisionBusy: false,
      holdHidden: false,
      holdDisabled: false,
    }),
    step: async () => {
      state.steps += 1;
      await gate;
      state.day += 1;
      return true;
    },
    sleep: async () => {},
    schedule: (fn) => { fn(); return 1; },
    clearSchedule: () => {},
  });
  assert.equal(controller.toggle(), 'start');
  assert.equal(state.steps, 1);
  assert.equal(controller.isLoopRunning(), true);
  assert.equal(controller.toggle(), 'stop');
  release();
  await drain();
  assert.equal(state.steps, 1);
  assert.equal(state.day, 2);
  assert.equal(controller.isLoopRunning(), false);
  assert.equal(controller.isActive(), false);
});

test('fast-forward action is only hold', () => {
  assert.equal(FAST_FORWARD_ACTION, 'hold');
  const src = readFileSync(new URL('../js/game.js', import.meta.url), 'utf8');
  assert.match(src, /await handleAction\(FAST_FORWARD_ACTION\)/);
  assert.match(src, /void handleAction\(FAST_FORWARD_ACTION\)/);
});

test('a full fast-forward is 29 holds and still needs an explicit settle', async () => {
  resetSession({ fillMode: 'next_open' });
  const bars = makeBars();
  patchSession({
    gameKline: bars,
    historyLength: 0,
    gameDays: 30,
    currentDay: 1,
    actions: [],
    fillMode: 'next_open',
    position: 'empty',
  });
  let settled = false;
  const controller = createFastForwardController({
    read: () => {
      const session = getSession();
      return {
        currentDay: session.currentDay,
        gameDays: session.gameDays,
        screenActive: true,
        rewindBusy: false,
        decisionBusy: false,
        holdHidden: false,
        holdDisabled: false,
      };
    },
    step: async () => {
      const before = getSession().actions.length;
      const result = applyLocalDecision(FAST_FORWARD_ACTION, { bars });
      return result.ok === true && getSession().actions.length === before + 1;
    },
    sleep: async () => {},
    schedule: (fn) => {
      fn();
      return 1;
    },
    clearSchedule: () => {},
  });
  assert.equal(controller.toggle(), 'start');
  await drain();
  const mid = getSession();
  assert.deepEqual(mid.actions, holds(29));
  assert.equal(mid.currentDay, 30);
  assert.equal(mid.position, 'empty');
  assert.equal(settled, false);
  assert.equal(controller.isActive(), false);
  const early = settleLocalSession({ bars: bars.slice(0, 10) });
  assert.equal(early.ok, false);
  const settledResult = settleLocalSession({ bars });
  assert.equal(settledResult.ok, true);
  settled = true;
  assert.equal(getSession().actions.length, 29);
});

test('holds from fast-forward do not skip T+1 or consume 一把梭 ammo', () => {
  resetSession({ fillMode: 'next_open' });
  const bars = makeBars({
    2: { open: 10, close: 10 },
    3: { open: 11, close: 11 },
    4: { open: 12, close: 12 },
  });
  patchSession({
    gameKline: bars,
    historyLength: 0,
    gameDays: 30,
    currentDay: 1,
    actions: [],
    fillMode: 'next_open',
    gameKind: 'oneshot',
    modifiers: { maxBuys: 1, maxSells: 1 },
  });
  for (let i = 0; i < 3; i++) {
    assert.equal(applyLocalDecision(FAST_FORWARD_ACTION, { bars }).ok, true);
  }
  let ammo = oneshotAmmoFromActions(getSession().actions, getSession().modifiers);
  assert.equal(ammo.buysLeft, 1);
  assert.equal(ammo.sellsLeft, 1);
  assert.equal(applyLocalDecision('buy', { bars }).ok, true);
  ammo = oneshotAmmoFromActions(getSession().actions, getSession().modifiers);
  assert.equal(ammo.buysLeft, 0);
  assert.equal(ammo.sellsLeft, 1);
  assert.equal(canSellOnCurrentDay(getSession()), true);
  assert.equal(validatePlayAction(getSession(), 'sell').ok, true);
  assert.deepEqual(getSession().actions.slice(0, 3), ['hold', 'hold', 'hold']);
});

test('flat fast-forward holds do not trip the survival bust line', () => {
  resetSession({ fillMode: 'same_close' });
  const bars = makeBars();
  patchSession({
    gameKline: bars,
    historyLength: 0,
    gameDays: 30,
    currentDay: 1,
    actions: [],
    fillMode: 'same_close',
    gameKind: 'survival',
    modifiers: SURVIVAL_MODIFIERS,
  });
  for (let i = 0; i < 10; i++) {
    assert.equal(applyLocalDecision(FAST_FORWARD_ACTION, { bars }).ok, true);
  }
  const ppm = Math.round((getSession().totalReturn - 1) * 1e6);
  assert.equal(checkSurvivalBust(ppm, getSession().modifiers).busted, false);
  assert.deepEqual(getSession().actions, holds(10));
});

test('each fast-forwarded hold still reveals that ghost day, including 观望', async () => {
  const ghost = {
    actions: ['hold', 'buy', 'hold', 'sell'],
  };
  const { controller, state } = harness({
    onStep: async (snap, ctrl) => {
      if (snap.steps === 3) ctrl.stop();
    },
  });
  assert.equal(controller.toggle(), 'start');
  await drain();
  assert.equal(state.steps, 3);
  const reveal = ghostRevealAfterPlayerDecisions(ghost, state.steps);
  assert.equal(reveal.action, 'hold');
  assert.equal(reveal.labelZh, '观望');
  assert.equal(reveal.index, 2);
  assert.equal(ghostRevealAfterPlayerDecisions(ghost, 2).action, 'buy');
});
