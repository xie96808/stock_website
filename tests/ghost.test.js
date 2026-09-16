import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ghostIdentityFromModifiers,
  ghostAvatarSrc,
  ghostReturnAtDecisionCount,
  formatGhostReturnPct,
  ghostModifiersJson,
  ghostActionLabelZh,
  ghostRevealAfterPlayerDecisions,
  ghostRevealedActions,
  GHOST_LABEL,
} from '../shared/ghost.js';
import { formatPlayHudChrome } from '../js/puzzle-goals-copy.js';
import { evaluateRewindEligibility } from '../js/game-play-usecase.js';
import { INITIAL_CASH } from '../shared/rules.js';

const html = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.html'),
  'utf8'
);

test('ghost identity requires nickname + avatar fields for HUD', () => {
  const mods = {
    ghost: {
      nickname: '榜一哥',
      avatarId: 3,
      avatarUrl: null,
      returnPpm: 120000,
      actions: Array(29).fill('hold'),
      equityCurve: [
        { day: 0, equity: INITIAL_CASH },
        { day: 1, equity: INITIAL_CASH * 1.01 },
        { day: 2, equity: INITIAL_CASH * 0.99 },
      ],
      sourceDate: '2026-09-10',
    },
  };
  const id = ghostIdentityFromModifiers(mods);
  assert.equal(id.nickname, '榜一哥');
  assert.equal(id.avatarId, 3);
  assert.equal(id.label, GHOST_LABEL);
  assert.equal(ghostAvatarSrc(id), 'images/avatars/03.png');
  assert.equal(formatGhostReturnPct(120000), '+12.00%');
  const d1 = ghostReturnAtDecisionCount(mods.ghost, 1);
  assert.ok(Math.abs(d1.returnPpm - 10000) < 2);
});

test('ghostModifiersJson freezes identity for session payload', () => {
  const json = ghostModifiersJson(
    {
      userId: 9,
      gameId: 'g1',
      nickname: '影',
      avatarId: 2,
      avatarUrl: '/api/v1/avatars/x.png',
      returnPpm: 1,
      actions: ['hold'],
      equityCurve: null,
    },
    { sourceChallengeId: 'daily:2026-09-10', sourceChallengeDate: '2026-09-10' }
  );
  const parsed = JSON.parse(json);
  assert.equal(parsed.ghost.nickname, '影');
  assert.equal(parsed.ghost.avatarUrl, '/api/v1/avatars/x.png');
  assert.equal(parsed.sourceChallengeDate, '2026-09-10');
});

test('formatPlayHudChrome ghost badge shows opponent name', () => {
  const hud = formatPlayHudChrome({ gameKind: 'ghost', ghostName: '昨日第一' });
  assert.equal(hud.isGhost, true);
  assert.equal(hud.badge, '幽灵对局');
  assert.match(hud.subtitle, /昨日第一/);
  assert.equal(hud.kind, 'ghost');
});

test('ghost rewind ineligible; HUD chip markup present', () => {
  assert.deepEqual(
    evaluateRewindEligibility(
      { cloudMode: true, gameKind: 'ghost', protocolVersion: 'legacy-batch', actions: ['hold'] },
      { gameRewind: true }
    ),
    { eligible: false, reason: 'ghost' }
  );
  assert.match(html, /id="ghostHudChip"/);
  assert.match(html, /id="ghostHudAvatar"/);
  assert.match(html, /id="ghostHudName"/);
  assert.match(html, /id="ghostHudAction"/);
});

test('ghost action-index reveal only after player decision (incl. hold→观望)', () => {
  const payload = {
    nickname: '榜一哥',
    actions: ['buy', 'hold', 'sell', 'hold'],
  };
  assert.equal(ghostActionLabelZh('hold'), '观望');
  assert.equal(ghostRevealAfterPlayerDecisions(payload, 0), null);
  assert.deepEqual(ghostRevealAfterPlayerDecisions(payload, 1), {
    index: 0,
    day: 1,
    action: 'buy',
    labelZh: '买入',
  });
  assert.deepEqual(ghostRevealAfterPlayerDecisions(payload, 2), {
    index: 1,
    day: 2,
    action: 'hold',
    labelZh: '观望',
  });
  assert.deepEqual(ghostRevealAfterPlayerDecisions(payload, 3), {
    index: 2,
    day: 3,
    action: 'sell',
    labelZh: '卖出',
  });
  // Past end of trajectory → null
  assert.equal(ghostRevealAfterPlayerDecisions(payload, 99), null);

  const revealed = ghostRevealedActions(payload, 2);
  assert.equal(revealed.length, 2);
  assert.equal(revealed[1].labelZh, '观望');
  // Mid-game resume depth 4 shows last action (day 4 hold)
  assert.deepEqual(ghostRevealAfterPlayerDecisions(payload, 4), {
    index: 3,
    day: 4,
    action: 'hold',
    labelZh: '观望',
  });
});

test('ghost-duel entry supports multi picker + random CTA', () => {
  const client = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js', 'ghost-duel.js'),
    'utf8'
  );
  assert.match(client, /ghost-duel-pick-list/);
  assert.match(client, /ghostDuelRandomBtn/);
  assert.match(client, /ghostGameId/);
  assert.match(client, /随机挑战/);
  assert.match(client, /挑战所选/);
  const css = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'css', 'start.css'),
    'utf8'
  );
  assert.match(css, /\.ghost-duel-pick-list/);
  assert.match(css, /\.ghost-duel-pick\.is-selected/);
});
