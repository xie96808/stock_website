/**
 * 连续登录奖励 — pure view helpers (no DOM) so they can be unit-tested in node.
 * `state` is GET /api/v1/me/streak (enabled, claimedToday, day, runDays, bestRun, broken, rewards[], next).
 */

/** Seven chips: done (already collected this cycle) / today (claimable now) / future. */
export function chipModels(state) {
  const rewards = Array.isArray(state?.rewards) ? state.rewards : [];
  const day = Number(state?.day) || 1;
  const claimed = !!state?.claimedToday;
  return rewards.map((r) => {
    let status = "future";
    if (claimed) status = r.day <= day ? "done" : "future";
    else if (r.day < day) status = "done";
    else if (r.day === day) status = "today";
    return { day: r.day, coins: r.coins, spins: r.spins || 0, status };
  });
}

export function claimLabel(state) {
  if (!state?.enabled) return "";
  if (state.claimedToday) return "今天已领取";
  const n = state.next;
  return n ? `领取 +${n.coins} 韭币` : "领取";
}

export function subText(state) {
  if (!state?.enabled) return "";
  if (state.claimedToday) {
    const run = Number(state.runDays) || 0;
    const best = Number(state.bestRun) || 0;
    return `今天已领取，明天继续。已连续 ${run} 天` + (best > run ? `（最长 ${best} 天）` : "");
  }
  return `今天是第 ${state.day} 天，点一下领取`;
}

export function noteText(state) {
  if (!state?.enabled) return "";
  if (!state.claimedToday && state.broken) return "断了一天，奖励只退一档，不会清零。今天接着领。";
  const spin = (state.rewards || []).find((r) => r.spins > 0);
  if (spin) return `第 ${spin.day} 天额外送 ${spin.spins} 次转盘，7 天内有效。`;
  return "";
}

/** Home pill text. Hidden (null) when the feature is off. */
export function pillModel(state) {
  if (!state?.enabled) return null;
  if (state.claimedToday) return { text: `连续登录 ${Number(state.runDays) || 1} 天`, button: "查看", claimable: false };
  return { text: "连续登录奖励", button: state.next ? `领 +${state.next.coins}` : "领取", claimable: true };
}

export function claimToast(claimed) {
  if (!claimed) return "";
  const spin = claimed.spins > 0 ? `，转盘 +${claimed.spins} 次` : "";
  return `连续登录第 ${claimed.day} 天 +${claimed.coins} 韭币${spin}`;
}

/** Auto-open at most once per Shanghai day (per device), only when there is something to claim. */
export function shouldAutoOpen(state, lastShownYmd) {
  return !!(state?.enabled && !state.claimedToday && state.today && lastShownYmd !== state.today);
}
