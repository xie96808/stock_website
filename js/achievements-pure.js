/**
 * 成就 — pure view helpers (no DOM) so they can be unit-tested in node.
 * `state` is GET /api/v1/me/achievements (enabled, groups[], items[], summary, unlocks[]).
 */

/** Names for the unlocks achievements can hand out (keys are shared with the avatar-frame shop). */
export const UNLOCK_NAMES = Object.freeze({
  "frame:crown": "韭王冠头像框",
  "frame:laurel": "月桂头像框",
});

export function unlockName(key) {
  return UNLOCK_NAMES[key] || "限定奖励";
}

/** Group sections in the server's order; claimable items float to the top, finished ones sink. */
export function sections(state) {
  const items = Array.isArray(state?.items) ? state.items : [];
  const groups = Array.isArray(state?.groups) ? state.groups : [];
  const rank = (i) => (i.claimable ? 0 : i.claimed ? 2 : 1);
  return groups
    .map((g) => {
      const list = items
        .map((it, idx) => ({ it, idx }))
        .filter(({ it }) => it.group === g.id)
        .sort((a, b) => rank(a.it) - rank(b.it) || a.idx - b.idx)
        .map(({ it }) => it);
      return { id: g.id, name: g.name, items: list, claimed: list.filter((i) => i.claimed).length, total: list.length };
    })
    .filter((s) => s.total > 0);
}

export function progressPct(item) {
  const t = Number(item?.target) || 0;
  if (t <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(((Number(item.progress) || 0) / t) * 100)));
}

export function progressLabel(item) {
  const u = item?.unit || "";
  return `${Number(item?.progress) || 0}${u} / ${Number(item?.target) || 0}${u}`;
}

export function rewardLabel(item) {
  const base = `+${Number(item?.coins) || 0} 韭币`;
  return item?.unlock ? `${base} · ${unlockName(item.unlock)}` : base;
}

/** Text for the home pill; claimable count turns it into a call to action. */
export function pillModel(state) {
  if (!state?.enabled || !state.summary) return null;
  const { claimed, total, claimable } = state.summary;
  return {
    text: claimable > 0 ? `成就 · ${claimable} 个可领取` : `成就 ${claimed}/${total}`,
    claimable: claimable > 0,
    count: claimable,
  };
}

export function claimAllLabel(state) {
  const s = state?.summary;
  if (!s || !s.claimable) return "暂无可领取";
  return `全部领取 +${s.claimableCoins} 韭币`;
}

export function subText(state) {
  const s = state?.summary;
  if (!s) return "";
  return `已达成 ${s.claimed}/${s.total} · 累计领取 ${s.earnedCoins} 韭币`;
}

/** Toast after POST claim / claim-all (`data` = { claimed:[{key,name,coins,unlock}], coins }). */
export function claimToast(data) {
  const list = Array.isArray(data?.claimed) ? data.claimed : [];
  if (!list.length) return "";
  const unlocks = list.filter((c) => c.unlock).map((c) => unlockName(c.unlock));
  if (list.length === 1) {
    const c = list[0];
    return `「${c.name}」+${c.coins} 韭币` + (c.unlock ? `，解锁${unlockName(c.unlock)}` : "");
  }
  return `领取 ${list.length} 个成就 +${data.coins} 韭币` + (unlocks.length ? `，解锁${unlocks.join("、")}` : "");
}
