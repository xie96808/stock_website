import { PVP_FILL_MODE, actionAvailability, roundView, visibleMtmPpm } from "../../../../shared/pvpMetrics.js";

function parseActions(raw) {
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function display(value, base) {
  return Math.round((value * 100 / base) * 10000) / 10000;
}

/** Fixed scale from history plus the first game bar. Later bars must not move it. */
export function volumeScale(history, firstGameBar) {
  const sample = [...history, firstGameBar];
  const positives = sample
    .map((bar) => Number(bar.volume) || 0)
    .filter((volume) => volume > 0);
  if (!positives.length) return 1;
  return positives.reduce((sum, volume) => sum + volume, 0) / positives.length;
}

function publicBar(bar, label, base, scale) {
  return {
    label,
    open: display(bar.open, base),
    high: display(bar.high, base),
    low: display(bar.low, base),
    close: display(bar.close, base),
    volume: Math.round((Number(bar.volume) || 0) / scale * 10000) / 10000,
  };
}

/**
 * The only client view of a match. `terminalType` is completed, forfeited, or aborted.
 * A pending lock is shown only to its owner and does not change NAV.
 */
export function pvpMatchView({ match, players, viewerId, serverNow, pendingLocks = {}, terminalType = null, nicknames = {} }) {
  const me = players.find((player) => player.user_id === viewerId);
  const opponent = players.find((player) => player.user_id !== viewerId);
  if (!me || !opponent) return null;

  const k = match.resolved_rounds ?? 0;
  const clock = roundView(k);
  const myActions = parseActions(me.actions_json).slice(0, k);
  const theirActions = parseActions(opponent.actions_json).slice(0, k);
  const snapshot = match.snapshot_json ? JSON.parse(match.snapshot_json) : null;
  const revealAll = terminalType === "completed" && snapshot?.bars?.length === 30;
  const revealedGameBars = revealAll ? 30 : (clock.ok ? clock.revealedBars : 1);

  let market = null;
  if (snapshot?.bars?.length >= revealedGameBars && Array.isArray(snapshot.history)) {
    const base = snapshot.bars[0].close;
    const scale = volumeScale(snapshot.history, snapshot.bars[0]);
    market = {
      historyLength: snapshot.history.length,
      revealedDay: revealedGameBars,
      history: snapshot.history.map((bar, index) => publicBar(bar, `h${index + 1}`, base, scale)),
      bars: snapshot.bars.slice(0, revealedGameBars).map((bar, index) => publicBar(bar, `d${index + 1}`, base, scale)),
    };
  }

  const mineNav = visibleMtmPpm({ bars: snapshot?.bars, actions: myActions });
  const theirNav = visibleMtmPpm({ bars: snapshot?.bars, actions: theirActions });
  const legal = snapshot ? actionAvailability({ bars: snapshot.bars, actions: myActions }) : { canBuy: false, canSell: false, canHold: false };
  const open = clock.ok
    && clock.decisionOpen
    && match.status === "playing"
    && serverNow >= match.round_opens_at
    && serverNow < match.round_deadline_at;
  const myLock = pendingLocks[viewerId] || null;

  const view = {
    matchId: match.id,
    status: match.status,
    revision: match.revision ?? 0,
    serverNow,
    resolvedRounds: k,
    round: clock.ok ? clock.round : null,
    opensAt: match.round_opens_at ?? null,
    deadlineAt: match.round_deadline_at ?? null,
    market,
    me: {
      lockedToday: myLock != null,
      lockedAction: myLock,
      mtmPpm: mineNav.ok ? mineNav.visibleMtmPpm : null,
      canBuy: open && legal.canBuy,
      canSell: open && legal.canSell,
      canHold: open && legal.canHold,
    },
    opponent: {
      nickname: nicknames[opponent.user_id] || "对手",
      lockedToday: pendingLocks[opponent.user_id] != null,
      mtmPpm: theirNav.ok ? theirNav.visibleMtmPpm : null,
    },
    resolvedActions: myActions.map((action, index) => ({
      round: index + 1,
      me: action,
      opponent: theirActions[index] || null,
    })),
  };

  if (revealAll) {
    view.identity = {
      stockCode: snapshot.stockCode,
      stockName: snapshot.stockName,
    };
  }
  return view;
}

export { PVP_FILL_MODE };
