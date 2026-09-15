import test from 'node:test';
import assert from 'node:assert/strict';
import { gameState } from '../js/state.js';
import { resetSession, patchSession, getSession } from '../js/game-session.js';
import { makeBars, holds } from '../shared/fixtures/golden.js';
import {
  sessionGameDays,
  isPuzzleSession,
  validatePlayAction,
  applyLocalDecision,
  settleLocalSession,
  resumeLocalActions,
  buildCloudFinishBody,
  sessionPatchFromCloudFinish,
  puzzlePositionFromState,
  detectSeedKind,
  prepareSessionSeed,
  seedLocalPractice,
  seedPuzzleSession,
  evaluateRewindEligibility,
  buildRewindPreview,
  applyRewindServerResult,
  applyServerDecisionState,
  isRevisionConflictError,
  syncEventV1Decision,
  shouldPersistCloudSettle,
  persistSettledCloudGame,
  createCloudSession,
  abandonCloudSession,
} from '../js/game-play-usecase.js';

function seedClassicWindow({ fillMode = 'next_open', actions = [] } = {}) {
  resetSession({ fillMode });
  const bars = makeBars({
    2: { open: 10, close: 10 },
    3: { open: 11, close: 11 },
  });
  patchSession({
    gameDays: 30,
    gameKind: null,
    currentDay: Math.min(actions.length + 1, 30),
    actions: actions.slice(),
    gameKline: bars,
    historyLength: 0,
    fillMode,
    position: 'empty',
    protocolVersion: null,
  });
  return bars;
}

test('sessionGameDays / isPuzzleSession defaults', () => {
  resetSession();
  assert.equal(sessionGameDays(), 30);
  assert.equal(isPuzzleSession(), false);
  patchSession({ gameKind: 'puzzle', gameDays: 8 });
  assert.equal(sessionGameDays(), 8);
  assert.equal(isPuzzleSession(), true);
});

test('validatePlayAction rejects illegal buy/sell and allows hold', () => {
  seedClassicWindow();
  assert.equal(validatePlayAction(getSession(), 'hold').ok, true);

  patchSession({ position: 'holding' });
  const buy = validatePlayAction(getSession(), 'buy');
  assert.equal(buy.ok, false);
  assert.match(buy.errorZh, /持仓/);

  patchSession({ position: 'empty' });
  const sell = validatePlayAction(getSession(), 'sell');
  assert.equal(sell.ok, false);
  assert.match(sell.errorZh, /空仓/);

  patchSession({ position: 'locked' });
  const locked = validatePlayAction(getSession(), 'sell');
  assert.equal(locked.ok, false);
  assert.match(locked.errorZh, /T\+1/);

  patchSession({ rewindBusy: true, position: 'empty' });
  assert.equal(validatePlayAction(getSession(), 'hold').ok, false);

  patchSession({ rewindBusy: false, decisionBusy: true });
  assert.equal(validatePlayAction(getSession(), 'hold').ok, false);
  assert.equal(validatePlayAction(getSession(), 'hold').errorZh, '忙碌中');
});

test('puzzle T+1 sell guard before firstSellableDay', () => {
  resetSession();
  patchSession({
    gameKind: 'puzzle',
    gameDays: 8,
    currentDay: 1,
    position: 'holding',
    firstSellableDay: 2,
    actions: [],
  });
  const r = validatePlayAction(getSession(), 'sell');
  assert.equal(r.ok, false);
  assert.match(r.errorZh, /可卖日/);
});

test('applyLocalDecision buy→sell advances day and MTM fields', () => {
  const bars = seedClassicWindow();
  const r1 = applyLocalDecision('buy', { bars });
  assert.equal(r1.ok, true);
  assert.equal(gameState.actions.length, 1);
  assert.equal(gameState.actions[0], 'buy');
  assert.equal(gameState.currentDay, 2);
  assert.ok(gameState.position === 'holding' || gameState.position === 'locked');

  const r2 = applyLocalDecision('sell', { bars });
  assert.equal(r2.ok, true);
  assert.equal(gameState.actions.length, 2);
  assert.equal(gameState.currentDay, 3);
  assert.equal(gameState.position, 'empty');
  assert.ok(gameState.tradeHistory.some((t) => t.type === 'buy'));
  assert.ok(gameState.tradeHistory.some((t) => t.type === 'sell'));
});

test('applyLocalDecision rejects second buy while holding', () => {
  const bars = seedClassicWindow();
  assert.equal(applyLocalDecision('buy', { bars }).ok, true);
  const r = applyLocalDecision('buy', { bars });
  assert.equal(r.ok, false);
  assert.ok(r.errorZh);
  assert.equal(gameState.actions.length, 1);
});

test('resumeLocalActions replays draft; invalid draft fails closed', () => {
  const bars = seedClassicWindow();
  const ok = resumeLocalActions(['buy', 'sell', 'hold'], { bars });
  assert.equal(ok.ok, true);
  assert.deepEqual(gameState.actions, ['buy', 'sell', 'hold']);
  assert.equal(gameState.currentDay, 4);

  seedClassicWindow();
  const bad = resumeLocalActions(['sell'], { bars });
  assert.equal(bad.ok, false);
  assert.deepEqual(gameState.actions, []);
  assert.equal(gameState.currentDay, 1);
});

test('settleLocalSession requires day-30 with 29 actions then sets returnPct', () => {
  const bars = seedClassicWindow();
  const actions = ['buy', 'sell', ...holds(27)];
  patchSession({
    actions,
    currentDay: 30,
  });
  const r = settleLocalSession({ bars });
  assert.equal(r.ok, true, r.engine && r.engine.message);
  assert.equal(gameState.returnPct, '10.00');
  assert.equal(gameState.returnPpm, 100000);
  assert.equal(gameState.position, 'empty');
});

test('settleLocalSession silent when not ready', () => {
  const bars = seedClassicWindow({ actions: ['hold'] });
  const r = settleLocalSession({ bars });
  assert.equal(r.ok, false);
  assert.equal(r.silent, true);
});

test('buildCloudFinishBody shapes legacy / event-v1 / puzzle', () => {
  resetSession();
  patchSession({
    actions: ['buy', 'hold'],
    protocolVersion: null,
    gameKind: null,
    revision: 0,
  });
  const legacy = buildCloudFinishBody(getSession());
  assert.equal(legacy.isPuzzle, false);
  assert.equal(legacy.isEventV1, false);
  assert.equal(legacy.body.finish, true);
  assert.deepEqual(legacy.body.actions, [
    { day: 1, action: 'buy' },
    { day: 2, action: 'hold' },
  ]);

  patchSession({ protocolVersion: 'event-v1', revision: 7 });
  const ev = buildCloudFinishBody(getSession());
  assert.equal(ev.isEventV1, true);
  assert.deepEqual(ev.body, { finish: true, expectedRevision: 7 });

  patchSession({ gameKind: 'puzzle', protocolVersion: 'event-v1' });
  const pz = buildCloudFinishBody(getSession());
  assert.equal(pz.isPuzzle, true);
  assert.equal(pz.isEventV1, false);
  assert.equal(pz.body.finish, true);
  assert.ok(Array.isArray(pz.body.actions));
});

test('sessionPatchFromCloudFinish maps classic + puzzle fields', () => {
  const classic = sessionPatchFromCloudFinish(
    { returnPpm: 1000, returnPct: '0.10', assistClass: 'clean', undoCount: 0 },
    { isPuzzle: false }
  );
  assert.equal(classic.saveStatus, 'saved');
  assert.equal(classic.returnPpm, 1000);
  assert.equal(classic.returnPct, '0.10');
  assert.equal(classic.assistClass, 'clean');
  assert.equal(classic.puzzleResult, undefined);

  const puzzle = sessionPatchFromCloudFinish(
    { stars: 3, levelKey: 'ch1-01', reward: { grantedThisTime: true } },
    { isPuzzle: true }
  );
  assert.equal(puzzle.puzzleResult.stars, 3);
  assert.equal(puzzle.puzzleLevelKey, 'ch1-01');
});

test('puzzlePositionFromState encodes T+1 lock', () => {
  assert.equal(puzzlePositionFromState(0, 1, null, 1), 'empty');
  assert.equal(puzzlePositionFromState(100, 1, 1, 2), 'locked');
  assert.equal(puzzlePositionFromState(100, 2, 1, 2), 'holding');
});


function ohlcv(n, volBase = 1000) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = 10 + i * 0.01;
    out.push({
      date: `2024-01-${String((i % 28) + 1).padStart(2, '0')}`,
      open: c,
      high: c + 0.1,
      low: c - 0.1,
      close: c,
      volume: volBase + i,
    });
  }
  return out;
}

test('detectSeedKind classifies puzzle / window / pack / local', () => {
  assert.equal(detectSeedKind(null), 'local');
  assert.equal(detectSeedKind({ gameKind: 'puzzle', bars: ohlcv(8) }), 'puzzle');
  assert.equal(
    detectSeedKind({ window: { bars: ohlcv(30), history: ohlcv(30) } }),
    'window'
  );
  assert.equal(detectSeedKind({ stockIndex: 0, gameId: 'g' }), 'pack');
});

test('prepareSessionSeed seeds local practice with injected random', () => {
  const catalog = [
    { code: 'AAA', name: '甲', kline: ohlcv(80) },
    { code: 'BBB', name: '乙', kline: ohlcv(80) },
  ];
  const { kind, session } = prepareSessionSeed({
    catalog,
    practiceOnly: true,
    fillMode: 'next_open',
    random: () => 0, // always first stock / min start
  });
  assert.equal(kind, 'local');
  assert.equal(session.practiceOnly, true);
  assert.equal(session.currentStock.code, 'AAA');
  assert.equal(session.gameDays, 30);
  assert.equal(session.gameKline.length, 60);
});

test('prepareSessionSeed seeds puzzle from cloud snapshot', () => {
  const bars = ohlcv(8);
  const history = ohlcv(5, 50);
  const { kind, session } = prepareSessionSeed({
    cloud: {
      gameId: 'pz1',
      gameKind: 'puzzle',
      bars,
      history,
      historyLength: 5,
      gameDays: 8,
      initialState: { cash: 100000, qty: 100, cost: 10, buyFillDay: 0, firstSellableDay: 2 },
      levelKey: 'ch1-01',
    },
    catalog: [],
  });
  assert.equal(kind, 'puzzle');
  assert.equal(session.gameKind, 'puzzle');
  assert.equal(session.cloudGameId, 'pz1');
  assert.equal(session.gameDays, 8);
  assert.equal(session.puzzleLevelKey, 'ch1-01');
  assert.equal(session.position, 'locked');
});

test('prepareSessionSeed daily + window prefers GameWindowDTO (empty catalog)', () => {
  const history = ohlcv(30, 400);
  const bars = ohlcv(30, 800);
  const { kind, session } = prepareSessionSeed({
    cloud: {
      gameId: 'daily-win1',
      stockCode: '600519',
      stockName: '挑战股',
      gameKind: 'daily',
      fillMode: 'next_open',
      window: { v: 1, historyLength: 30, gameDays: 30, history, bars },
    },
    catalog: [],
  });
  assert.equal(kind, 'window');
  assert.equal(session.gameKind, 'daily');
  assert.equal(session.cloudGameId, 'daily-win1');
  assert.equal(session.currentStock.code, '600519');
  assert.equal(session.gameKline.length, 60);
  assert.equal(session.gameKline[0].volume, 400);
  assert.equal(session.gameKline[30].volume, 800);
});

test('prepareSessionSeed prefers GameWindowDTO over pack', () => {
  const history = ohlcv(30, 500);
  const bars = ohlcv(30, 900);
  const { kind, session } = prepareSessionSeed({
    cloud: {
      gameId: 'win1',
      stockCode: '600000',
      stockName: '窗口股',
      window: { v: 1, historyLength: 30, gameDays: 30, history, bars },
    },
    catalog: [{ code: 'NOPE', name: 'x', kline: ohlcv(80) }],
  });
  assert.equal(kind, 'window');
  assert.equal(session.cloudGameId, 'win1');
  assert.equal(session.currentStock.code, '600000');
  assert.equal(session.gameKline.length, 60);
});

test('prepareSessionSeed daily without window needs pack (empty catalog fails)', () => {
  // Pre-R5 / no window: detectSeedKind → pack, then falls through to local practice.
  assert.throws(
    () =>
      prepareSessionSeed({
        cloud: {
          gameId: 'daily-pack1',
          gameKind: 'daily',
          stockIndex: 0,
          windowStartIndex: 30,
          historyLength: 30,
        },
        catalog: [],
      }),
    /股票资源未就绪/
  );
});

test('prepareSessionSeed daily + window preserves gameKind through seed', () => {
  const history = ohlcv(30, 11);
  const bars = ohlcv(30, 22);
  const { kind, session } = prepareSessionSeed({
    cloud: {
      gameId: 'daily-kind',
      stockCode: '000002',
      stockName: '日股',
      gameKind: 'daily',
      fillMode: 'next_open',
      window: { v: 1, historyLength: 30, gameDays: 30, history, bars },
    },
    catalog: [],
  });
  assert.equal(kind, 'window');
  assert.equal(session.gameKind, 'daily');
  assert.equal(session.fillMode, 'next_open');
  assert.equal(session.practiceOnly, false);
});

test('prepareSessionSeed pack path works for daily when catalog present (no window)', () => {
  const catalog = [{ code: 'PACK1', name: '包股', kline: ohlcv(80) }];
  const { kind, session } = prepareSessionSeed({
    cloud: {
      gameId: 'daily-pack-ok',
      gameKind: 'daily',
      stockIndex: 0,
      windowStartIndex: 30,
      historyLength: 30,
      fillMode: 'next_open',
    },
    catalog,
  });
  assert.equal(kind, 'pack');
  assert.equal(session.gameKind, 'daily');
  assert.equal(session.currentStock.code, 'PACK1');
  assert.equal(session.gameKline.length, 60);
});

test('evaluateRewindEligibility / buildRewindPreview', () => {
  resetSession();
  patchSession({
    cloudMode: true,
    protocolVersion: 'event-v1',
    gameKind: 'classic',
    undoCount: 0,
    actions: ['buy', 'hold'],
    gameDays: 30,
  });
  assert.equal(evaluateRewindEligibility(getSession(), { gameRewind: true }).eligible, true);
  assert.equal(evaluateRewindEligibility(getSession(), { gameRewind: false }).eligible, false);
  patchSession({ gameKind: 'daily' });
  assert.equal(evaluateRewindEligibility(getSession(), { gameRewind: true }).eligible, false);
  patchSession({ gameKind: 'classic', undoCount: 1 });
  assert.equal(evaluateRewindEligibility(getSession(), { gameRewind: true }).eligible, false);

  patchSession({ undoCount: 0, actions: ['buy', 'sell', 'hold'] });
  const preview = buildRewindPreview(getSession(), { balance: 80, cost: 50 });
  assert.equal(preview.targetDay, 3);
  assert.equal(preview.canAfford, true);
  assert.equal(preview.after, 30);
  assert.equal(buildRewindPreview(getSession(), { balance: 10, cost: 50 }).canAfford, false);
});

test('applyRewindServerResult patches undo + assistClass', () => {
  const bars = seedClassicWindow();
  assert.equal(applyLocalDecision('buy', { bars }).ok, true);
  assert.equal(applyLocalDecision('hold', { bars }).ok, true);
  patchSession({ protocolVersion: 'event-v1', revision: 2, undoCount: 0 });
  const r = applyRewindServerResult(
    {
      actions: ['buy'],
      revision: 3,
      undoCount: 1,
      assistClass: 'undo',
      balanceAfter: 450,
      protocolVersion: 'event-v1',
    },
    { bars }
  );
  assert.equal(r.ok, true);
  assert.equal(r.balanceAfter, 450);
  assert.deepEqual(gameState.actions, ['buy']);
  assert.equal(gameState.undoCount, 1);
  assert.equal(gameState.assistClass, 'undo');
  assert.equal(gameState.revision, 3);
});

test('shouldPersistCloudSettle + persistSettledCloudGame inject finishCloud', async () => {
  resetSession();
  assert.equal(shouldPersistCloudSettle(getSession()), false);
  patchSession({ cloudMode: true, cloudGameId: 'g1' });
  assert.equal(shouldPersistCloudSettle(getSession()), true);
  let called = 0;
  const out = await persistSettledCloudGame({
    finishCloud: async () => {
      called += 1;
      return { data: { ok: 1 }, status: 200 };
    },
  });
  assert.equal(called, 1);
  assert.equal(out.status, 200);
});

test('createCloudSession / abandonCloudSession inject HTTP', async () => {
  const created = await createCloudSession('next_open', {
    createHttp: async (fm) => ({ gameId: 'new', fillMode: fm }),
    clearDraft: () => {},
  });
  assert.equal(created.gameId, 'new');
  const cleared = [];
  const abandoned = await abandonCloudSession('old', {
    abandonHttp: async (id) => id,
    clearDraft: (id) => cleared.push(id),
  });
  assert.equal(abandoned, 'old');
  assert.deepEqual(cleared, ['old']);
});

test('seedPuzzleSession rejects bad bars', () => {
  assert.throws(() => seedPuzzleSession({ bars: [], gameDays: 8 }), /残局/);
});

test('seedPuzzleSession stores title and theme for HUD', () => {
  const bars = [];
  for (let i = 0; i < 6; i++) {
    bars.push({ open: 10, high: 11, low: 9, close: 10, volume: 1, date: `2026-01-0${i + 1}` });
  }
  seedPuzzleSession({
    bars,
    gameDays: 6,
    history: [],
    historyLength: 0,
    gameId: 'pz1',
    title: '第一天站岗',
    theme: '买入后已有浮亏',
    levelKey: 'ch1-01',
    goals: { twoStar: { beatBuyHoldPp: 3 } },
  });
  assert.equal(getSession().gameKind, 'puzzle');
  assert.equal(getSession().puzzleTitle, '第一天站岗');
  assert.equal(getSession().puzzleTheme, '买入后已有浮亏');
  assert.equal(getSession().puzzleLevelKey, 'ch1-01');
});

test('seedLocalPractice throws when catalog empty', () => {
  assert.throws(() => seedLocalPractice([]), /股票资源未就绪/);
});


test('applyServerDecisionState accepts empty actions and updates revision', () => {
  const bars = seedClassicWindow({ actions: ['buy', 'hold'] });
  patchSession({ revision: 2, protocolVersion: 'event-v1', fillMode: 'next_open' });
  const r = applyServerDecisionState(
    { actions: [], revision: 5, protocolVersion: 'event-v1', undoCount: 1, assistClass: 'undo' },
    { bars }
  );
  assert.equal(r.ok, true);
  assert.deepEqual(gameState.actions, []);
  assert.equal(gameState.currentDay, 1);
  assert.equal(gameState.revision, 5);
  assert.equal(gameState.undoCount, 1);
  assert.equal(gameState.position, 'empty');
});

test('applyServerDecisionState applies mid-game actions + revision', () => {
  const bars = seedClassicWindow();
  patchSession({ revision: 0, protocolVersion: 'event-v1', fillMode: 'next_open' });
  const r = applyServerDecisionState(
    {
      actions: ['buy', 'hold', 'sell'],
      revision: 3,
      protocolVersion: 'event-v1',
      undoCount: 0,
      assistClass: 'clean',
    },
    { bars }
  );
  assert.equal(r.ok, true);
  assert.deepEqual(gameState.actions, ['buy', 'hold', 'sell']);
  assert.equal(gameState.currentDay, 4);
  assert.equal(gameState.revision, 3);
  assert.equal(gameState.position, 'empty');
  assert.equal(gameState.tradeHistory.length, 2);
});

test('isRevisionConflictError detects API conflict variants', () => {
  assert.equal(isRevisionConflictError({ code: 'REVISION_CONFLICT', status: 409 }), true);
  assert.equal(isRevisionConflictError({ code: 'REVISION_CONFLICT' }), true);
  assert.equal(
    isRevisionConflictError({ code: 'FOO_REVISION_BAR', status: 409 }),
    true,
    '409 + code containing REVISION'
  );
  assert.equal(
    isRevisionConflictError({ code: 'REVISION_STALE', status: 409 }),
    true
  );
  assert.equal(
    isRevisionConflictError({ code: 'OTHER', status: 409 }),
    false,
    '409 alone without REVISION in code is not a conflict'
  );
  assert.equal(
    isRevisionConflictError({ code: 'REVISION_CONFLICT', status: 400 }),
    true,
    'exact REVISION_CONFLICT code wins even if status is not 409'
  );
  assert.equal(isRevisionConflictError({ code: 'OTHER', status: 400 }), false);
  assert.equal(isRevisionConflictError({ status: 500, code: 'SERVER' }), false);
  assert.equal(isRevisionConflictError(null), false);
  assert.equal(isRevisionConflictError(undefined), false);
});

test('syncEventV1Decision recovers once on REVISION_CONFLICT', async () => {
  const bars = seedClassicWindow({ actions: ['hold'] });
  patchSession({
    cloudMode: true,
    cloudGameId: 'g-rev',
    protocolVersion: 'event-v1',
    revision: 1,
    fillMode: 'next_open',
    actions: ['hold'],
    currentDay: 2,
  });

  let appendCalls = 0;
  let fetchCalls = 0;
  const conflict = new Error('revision 不匹配，请重新拉取状态');
  conflict.code = 'REVISION_CONFLICT';
  conflict.status = 409;

  const result = await syncEventV1Decision('hold', {
    expectedRevision: 1,
    bars,
    appendDecision: async () => {
      appendCalls += 1;
      throw conflict;
    },
    fetchState: async (id) => {
      fetchCalls += 1;
      assert.equal(id, 'g-rev');
      return {
        actions: ['hold', 'hold', 'buy'],
        revision: 3,
        protocolVersion: 'event-v1',
        undoCount: 0,
        assistClass: 'clean',
      };
    },
  });

  assert.equal(appendCalls, 1);
  assert.equal(fetchCalls, 1);
  assert.equal(result.ok, false);
  assert.equal(result.recovered, true);
  assert.equal(gameState.revision, 3);
  assert.deepEqual(gameState.actions, ['hold', 'hold', 'buy']);
  assert.equal(gameState.currentDay, 4);
});

test('syncEventV1Decision success path applies state without fetch', async () => {
  const bars = seedClassicWindow();
  patchSession({
    cloudMode: true,
    cloudGameId: 'g-ok',
    protocolVersion: 'event-v1',
    revision: 0,
    fillMode: 'next_open',
  });
  let fetchCalls = 0;
  const result = await syncEventV1Decision('buy', {
    expectedRevision: 0,
    bars,
    appendDecision: async (action, rev) => {
      assert.equal(action, 'buy');
      assert.equal(rev, 0);
      return {
        actions: ['buy'],
        revision: 1,
        protocolVersion: 'event-v1',
        undoCount: 0,
        assistClass: 'clean',
      };
    },
    fetchState: async () => {
      fetchCalls += 1;
      throw new Error('should not fetch');
    },
  });
  assert.equal(result.ok, true);
  assert.equal(fetchCalls, 0);
  assert.equal(gameState.revision, 1);
  assert.deepEqual(gameState.actions, ['buy']);
  assert.equal(gameState.currentDay, 2);
});

test('syncEventV1Decision recovers when append ok but local apply fails', async () => {
  const bars = seedClassicWindow();
  patchSession({
    cloudMode: true,
    cloudGameId: 'g-apply-fail',
    protocolVersion: 'event-v1',
    revision: 0,
    fillMode: 'next_open',
  });
  let fetchCalls = 0;
  const result = await syncEventV1Decision('buy', {
    expectedRevision: 0,
    bars,
    appendDecision: async () => ({
      // invalid action enum → applyServerDecisionState fails
      actions: ['nope'],
      revision: 1,
      protocolVersion: 'event-v1',
    }),
    fetchState: async () => {
      fetchCalls += 1;
      return {
        actions: ['buy'],
        revision: 1,
        protocolVersion: 'event-v1',
        undoCount: 0,
        assistClass: 'clean',
      };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.recovered, true);
  assert.equal(fetchCalls, 1);
  assert.equal(gameState.revision, 1);
  assert.deepEqual(gameState.actions, ['buy']);
});

test('validatePlayAction returns 忙碌中 when decisionBusy or rewindBusy', () => {
  seedClassicWindow();
  patchSession({ decisionBusy: true, rewindBusy: false, position: 'empty' });
  const busyDecision = validatePlayAction(getSession(), 'hold');
  assert.equal(busyDecision.ok, false);
  assert.equal(busyDecision.errorZh, '忙碌中');

  patchSession({ decisionBusy: false, rewindBusy: true });
  const busyRewind = validatePlayAction(getSession(), 'buy');
  assert.equal(busyRewind.ok, false);
  assert.equal(busyRewind.errorZh, '忙碌中');

  patchSession({ decisionBusy: true, rewindBusy: true });
  assert.equal(validatePlayAction(getSession(), 'sell').errorZh, '忙碌中');

  patchSession({ decisionBusy: false, rewindBusy: false });
  assert.equal(validatePlayAction(getSession(), 'hold').ok, true);
});

test('syncEventV1Decision conflict + fetchState fails leaves revision stale', async () => {
  const bars = seedClassicWindow({ actions: ['hold'] });
  patchSession({
    cloudMode: true,
    cloudGameId: 'g-fetch-fail',
    protocolVersion: 'event-v1',
    revision: 2,
    fillMode: 'next_open',
    actions: ['hold'],
    currentDay: 2,
  });

  const conflict = new Error('revision 不匹配，请重新拉取状态');
  conflict.code = 'REVISION_CONFLICT';
  conflict.status = 409;

  const result = await syncEventV1Decision('hold', {
    expectedRevision: 2,
    bars,
    appendDecision: async () => {
      throw conflict;
    },
    fetchState: async () => {
      throw new Error('network down');
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.recovered, false);
  assert.equal(result.error, conflict);
  assert.ok(result.fetchError);
  assert.match(String(result.fetchError.message), /network down/);
  assert.equal(gameState.revision, 2, 'stale revision must remain unchanged');
  assert.deepEqual(gameState.actions, ['hold']);
});

test('syncEventV1Decision after recover next sync uses updated revision', async () => {
  const bars = seedClassicWindow({ actions: ['hold'] });
  patchSession({
    cloudMode: true,
    cloudGameId: 'g-anti-spam',
    protocolVersion: 'event-v1',
    revision: 1,
    fillMode: 'next_open',
    actions: ['hold'],
    currentDay: 2,
  });

  const conflict = new Error('revision 不匹配，请重新拉取状态');
  conflict.code = 'REVISION_CONFLICT';
  conflict.status = 409;

  const seenRevisions = [];
  let phase = 'conflict';

  const appendDecision = async (action, rev) => {
    seenRevisions.push(rev);
    if (phase === 'conflict') {
      throw conflict;
    }
    assert.equal(rev, getSession().revision, 'anti-spam: expectedRevision === session.revision');
    return {
      actions: ['hold', 'hold', 'buy', 'hold'],
      revision: rev + 1,
      protocolVersion: 'event-v1',
      undoCount: 0,
      assistClass: 'clean',
    };
  };

  const recover = await syncEventV1Decision('buy', {
    expectedRevision: getSession().revision,
    bars,
    appendDecision,
    fetchState: async () => ({
      actions: ['hold', 'hold', 'buy'],
      revision: 3,
      protocolVersion: 'event-v1',
      undoCount: 0,
      assistClass: 'clean',
    }),
  });
  assert.equal(recover.recovered, true);
  assert.equal(gameState.revision, 3);
  assert.deepEqual(seenRevisions, [1]);

  phase = 'ok';
  const next = await syncEventV1Decision('hold', {
    expectedRevision: getSession().revision,
    bars,
    appendDecision,
    fetchState: async () => {
      throw new Error('should not fetch on success');
    },
  });
  assert.equal(next.ok, true);
  assert.deepEqual(seenRevisions, [1, 3], 'second sync must send recovered revision 3');
  assert.equal(gameState.revision, 4);
  assert.deepEqual(gameState.actions, ['hold', 'hold', 'buy', 'hold']);
});

test('applyRewindServerResult accepts empty actions and bumps revision', () => {
  const bars = seedClassicWindow({ actions: ['buy', 'hold'] });
  patchSession({
    protocolVersion: 'event-v1',
    revision: 2,
    undoCount: 0,
    assistClass: 'clean',
    fillMode: 'next_open',
  });
  const r = applyRewindServerResult(
    {
      actions: [],
      revision: 4,
      undoCount: 1,
      assistClass: 'undo',
      balanceAfter: 450,
      protocolVersion: 'event-v1',
    },
    { bars }
  );
  assert.equal(r.ok, true);
  assert.equal(r.balanceAfter, 450);
  assert.deepEqual(gameState.actions, []);
  assert.equal(gameState.currentDay, 1);
  assert.equal(gameState.revision, 4);
  assert.equal(gameState.undoCount, 1);
  assert.equal(gameState.assistClass, 'undo');
  assert.equal(gameState.position, 'empty');
});
