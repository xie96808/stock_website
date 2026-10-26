import { PVP_FILL_MODE, actionAvailability, roundView, visibleMtmPpm } from "../../../../shared/pvpMetrics.js";
import { currentEconomy } from "./config.js";

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
function faceOf(faces, userId, fallbackName) {
  const face = faces?.[userId] || {};
  return {
    userId: face.userId ?? userId ?? null,
    nickname: face.nickname || fallbackName,
    avatarId: face.avatarId || 1,
    avatarUrl: face.avatarUrl || null,
    ...(face.avatarFrame ? { avatarFrame: face.avatarFrame } : {}),
    signature: face.signature == null ? "" : String(face.signature),
    title: face.title || null,
    titleName: face.titleName || null,
    iconPath: face.iconPath || null,
    inPlacement: !!face.inPlacement,
    wins: Number(face.wins) || 0,
    losses: Number(face.losses) || 0,
    draws: Number(face.draws) || 0,
    recent: Array.isArray(face.recent) ? face.recent : [],
  };
}

export function pvpMatchView({ match, players, viewerId, serverNow, pendingLocks = {}, terminalType = null, nicknames = {}, faces = {} }) {
  const me = players.find((player) => player.user_id === viewerId);
  const opponent = players.find((player) => player.user_id !== viewerId);
  if (!me || !opponent) return null;
  const mineFace = faceOf(faces, viewerId, "我");
  const oppFace = faceOf(faces, opponent.user_id, nicknames[opponent.user_id] || "对手");

  const k = match.resolved_rounds ?? 0;
  const clock = roundView(k);
  const myActions = parseActions(me.actions_json).slice(0, k);
  const theirActions = parseActions(opponent.actions_json).slice(0, k);
  const snapshot = match.snapshot_json ? JSON.parse(match.snapshot_json) : null;
  // Completed matches reveal the full window. Accept >= 30 in case a pack ever
  // ships a longer slice; shorter snapshots fall back to resolved-round reveal.
  const barCount = Array.isArray(snapshot?.bars) ? snapshot.bars.length : 0;
  const revealAll = terminalType === "completed" && barCount >= 30;
  const revealedGameBars = revealAll ? barCount : (clock.ok ? clock.revealedBars : 1);

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
  let economy = null;
  try {
    economy = match.economy_json ? JSON.parse(match.economy_json) : null;
  } catch {
    economy = null;
  }
  if (!economy || typeof economy !== "object") {
    economy = currentEconomy(serverNow);
  }

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
    economy: {
      entryCost: Number(economy.entryCost) || 0,
      winReward: Number(economy.winReward) || 0,
    },
    me: {
      userId: mineFace.userId,
      nickname: mineFace.nickname,
      avatarId: mineFace.avatarId,
      avatarUrl: mineFace.avatarUrl,
      ...(mineFace.avatarFrame ? { avatarFrame: mineFace.avatarFrame } : {}),
      signature: mineFace.signature,
      title: mineFace.title,
      iconPath: mineFace.iconPath,
      lockedToday: myLock != null,
      lockedAction: myLock,
      mtmPpm: mineNav.ok ? mineNav.visibleMtmPpm : null,
      holding: !!legal.canSell,
      canBuy: open && legal.canBuy,
      canSell: open && legal.canSell,
      canHold: open && legal.canHold,
    },
    opponent: {
      userId: oppFace.userId || opponent.user_id,
      nickname: oppFace.nickname,
      avatarId: oppFace.avatarId,
      avatarUrl: oppFace.avatarUrl,
      ...(oppFace.avatarFrame ? { avatarFrame: oppFace.avatarFrame } : {}),
      signature: oppFace.signature,
      title: oppFace.title,
      titleName: oppFace.titleName,
      iconPath: oppFace.iconPath,
      inPlacement: oppFace.inPlacement,
      wins: oppFace.wins,
      losses: oppFace.losses,
      draws: oppFace.draws,
      recent: oppFace.recent,
      lockedToday: pendingLocks[opponent.user_id] != null,
      mtmPpm: theirNav.ok ? theirNav.visibleMtmPpm : null,
    },
    resolvedActions: myActions.map((action, index) => ({
      round: index + 1,
      me: action,
      opponent: theirActions[index] || null,
    })),
  };

  if (match.status === "waiting_ready") {
    view.readyDeadlineAt = match.ready_deadline_at ?? null;
    view.me.ready = me.ready_at != null;
    view.opponent.ready = opponent.ready_at != null;
  }

  if (match.status === "settled" || match.status === "aborted") {
    view.terminal = {
      type: terminalType,
      reason: match.terminal_reason || null,
    };
    view.me.outcome = me.outcome || null;
    view.me.returnPpm = me.return_ppm ?? null;
    view.me.mddPpm = me.mdd_ppm ?? null;
    view.me.coinDelta = me.coin_delta ?? null;
    view.me.ratingDelta = me.actual_rating_delta ?? null;
    view.me.ratingBefore = me.rating_before ?? null;
    view.me.ratingAfter = me.rating_after ?? null;
    view.opponent.outcome = opponent.outcome || null;
    view.opponent.returnPpm = opponent.return_ppm ?? null;
    view.opponent.mddPpm = opponent.mdd_ppm ?? null;
    view.opponent.coinDelta = opponent.coin_delta ?? null;
    view.opponent.userId = opponent.user_id;
  }

  if (revealAll) {
    view.identity = {
      stockCode: snapshot.stockCode,
      stockName: snapshot.stockName,
      periodStart: snapshot.bars[0]?.date || null,
      periodEnd: snapshot.bars[snapshot.bars.length - 1]?.date || null,
    };
  }
  return view;
}

export { PVP_FILL_MODE };
