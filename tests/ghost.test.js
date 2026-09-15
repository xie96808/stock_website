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
});
