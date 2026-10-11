import { displayAvatarUrl, getAuthState, openAuthModal } from "../auth.js";
import { Route, prepareScreen, activateScreen, setRouteHash } from "../screen-router.js";
import { rankProgress } from "../../shared/pvpRating.js";
import { formatPpm, formatWinRate, reasonLabel } from "./copy.js";
import { pvpEnabled, pvpFetch, whenAuthReady } from "./transport.js";

function outcomeText(outcome) {
  if (outcome === "win") return "胜";
  if (outcome === "loss") return "负";
  if (outcome === "draw") return "平";
  return "结束";
}

export function appendRankProgress(parent, rating) {
  const band = rankProgress(rating);
  if (!band || !parent) return;
  const box = document.createElement("div");
  box.className = "pvp-rank-progress";
  const bar = document.createElement("div");
  bar.className = "pvp-rank-bar";
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", String(band.span));
  bar.setAttribute("aria-valuenow", String(band.current));
  bar.setAttribute("aria-label", band.maxed ? "已满级" : `段位进度 ${band.text}`);
  const fill = document.createElement("span");
  fill.style.width = `${band.current}%`;
  bar.append(fill);
  const fraction = document.createElement("span");
  fraction.className = "pvp-rank-fraction";
  fraction.textContent = band.text;
  const remain = document.createElement("span");
  remain.className = "pvp-rank-remain";
  remain.textContent = band.maxed ? "已满级" : `升级还需 ${band.remain}`;
  box.append(bar, fraction, remain);
  parent.append(box);
}

function recordChip(label, count, kind) {
  const node = document.createElement("span");
  node.className = `pvp-record pvp-record-${kind}`;
  node.textContent = `${count} ${label}`;
  return node;
}

/** Fox-style rank card: large title, colored win/loss. */
export function fillDossier(node, profile) {
  if (!node) return;
  node.replaceChildren();
  if (!profile) {
    node.hidden = true;
    return;
  }
  node.hidden = false;
  const img = document.createElement("img");
  img.className = "pvp-dossier-avatar";
  img.alt = "";
  img.width = 72;
  img.height = 72;
  img.src = displayAvatarUrl(profile);
  const body = document.createElement("div");
  body.className = "pvp-dossier-body";
  const name = document.createElement("p");
  name.className = "pvp-dossier-name";
  name.textContent = profile.nickname || "我";
  const rank = document.createElement("p");
  rank.className = "pvp-dossier-rank";
  rank.textContent = profile.title || "散户一段";
  body.append(name, rank);
  if (profile.inPlacement) {
    const place = document.createElement("p");
    place.className = "pvp-dossier-place";
    place.textContent = "定级中";
    body.append(place);
  }
  if (profile.rating != null && Number.isFinite(Number(profile.rating))) {
    const score = document.createElement("p");
    score.className = "pvp-dossier-score";
    score.textContent = `段位分 ${profile.rating}`;
    body.append(score);
    appendRankProgress(body, profile.rating);
  }
  const record = document.createElement("div");
  record.className = "pvp-dossier-record";
  const scored = (Number(profile.wins) || 0) + (Number(profile.losses) || 0) + (Number(profile.draws) || 0);
  if (!scored || profile.empty) {
    const empty = document.createElement("span");
    empty.className = "pvp-dossier-empty";
    empty.textContent = "尚无战绩";
    record.append(empty);
  } else {
    record.append(
      recordChip("胜", profile.wins || 0, "win"),
      recordChip("负", profile.losses || 0, "loss"),
      recordChip("平", profile.draws || 0, "draw"),
    );
    const rate = formatWinRate(profile.winRate);
    if (rate) {
      const winRate = document.createElement("span");
      winRate.className = "pvp-dossier-rate";
      winRate.textContent = `胜率 ${rate}`;
      record.append(winRate);
    }
  }
  node.append(img, body, record);
}

export async function syncPvpProfile() {
  const on = await pvpEnabled();
  const auth = getAuthState();
  const loggedIn = !!(auth.user && auth.ready !== false);
  let chip = document.getElementById("pvpArchiveBtn");
  const host = document.getElementById("authChip");
  if (on && host && !chip) {
    chip = document.createElement("button");
    chip.type = "button";
    chip.id = "pvpArchiveBtn";
    chip.className = "auth-login-btn";
    chip.textContent = "对战档案";
    chip.addEventListener("click", () => { showPvpHistory().catch(() => {}); });
    host.appendChild(chip);
  }
  if (chip) chip.hidden = !(on && loggedIn);

  const panel = document.getElementById("authSettingsPanel");
  if (!panel) return;
  let section = document.getElementById("pvpSettingsSection");
  if (on && !section) {
    section = document.createElement("div");
    section.id = "pvpSettingsSection";
    section.className = "pvp-settings";
    const title = document.createElement("p");
    title.className = "pvp-settings-title";
    title.textContent = "对战";
    const rank = document.createElement("div");
    rank.id = "pvpSettingsRank";
    rank.className = "pvp-settings-rank";
    rank.textContent = "段位";
    const note = document.createElement("p");
    note.id = "pvpSettingsNote";
    note.textContent = "战绩只对你自己可见。";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "auth-secondary";
    button.textContent = "打开对战档案";
    button.addEventListener("click", () => { showPvpHistory().catch(() => {}); });
    section.append(title, rank, note, button);
    panel.insertBefore(section, panel.querySelector("hr") || null);
  }
  if (section) section.hidden = !on;
  const rank = document.getElementById("pvpSettingsRank");
  if (rank && on && loggedIn) {
    pvpFetch("/me/pvp/stats").then(({ data }) => {
      const place = data?.title?.inPlacement ? " · 定级中" : "";
      rank.textContent = "";
      const title = document.createElement("span");
      title.textContent = `${data?.title?.name || "散户一段"}${place}`;
      rank.append(title);
      appendRankProgress(rank, data?.rating);
    }).catch(() => {});
  }
}

function renderStats(stats, user) {
  const node = document.getElementById("pvpStats");
  if (!node) return;
  node.replaceChildren();
  const card = document.createElement("div");
  card.className = "pvp-dossier";
  fillDossier(card, {
    nickname: user?.nickname || "我",
    avatarId: user?.avatarId || 1,
    avatarUrl: user?.avatarUrl || null,
    title: stats?.title?.name || "散户一段",
    inPlacement: stats?.title?.inPlacement !== false,
    rating: stats?.rating,
    wins: stats?.wins || 0,
    losses: stats?.losses || 0,
    draws: stats?.draws || 0,
    winRate: stats?.winRate,
    empty: !stats || stats.empty,
  });
  node.append(card);
  if (!stats || stats.empty) return;
  const dots = document.createElement("div");
  dots.className = "pvp-dots";
  for (const outcome of stats.recent || []) {
    const dot = document.createElement("span");
    dot.className = `pvp-dot pvp-dot-${outcome}`;
    dot.textContent = outcomeText(outcome);
    dots.append(dot);
  }
  const completed = document.createElement("p");
  completed.className = "pvp-dossier-more";
  completed.textContent = `完整局 ${stats.completedGames} · 完整局平均收益 ${formatPpm(stats.meanCompletedReturnPpm)} · 最佳完整局收益 ${formatPpm(stats.bestCompletedReturnPpm)} · 近 20 场认输 ${stats.recentForfeits}`;
  node.append(dots, completed);
}

function renderBlocks(data) {
  const node = document.getElementById("pvpBlockList");
  if (!node) return;
  node.replaceChildren();
  const entries = data?.entries || [];
  if (!entries.length) {
    const empty = document.createElement("p");
    empty.textContent = "没有屏蔽的对手。";
    node.append(empty);
    return;
  }
  for (const row of entries) {
    const item = document.createElement("div");
    item.className = "pvp-block-item";
    const name = document.createElement("span");
    name.textContent = row.nickname || "对手";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pvp-btn";
    button.textContent = "取消屏蔽";
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await pvpFetch(`/pvp/blocks/${encodeURIComponent(row.userId)}`, { method: "DELETE" });
        button.textContent = "已取消";
      } catch (err) {
        button.disabled = false;
        button.textContent = err.message || "没能取消";
      }
    });
    item.append(name, button);
    node.append(item);
  }
}

export async function showPvpHistory() {
  const on = await pvpEnabled();
  if (!on) {
    if (typeof window.showSimHub === "function") window.showSimHub();
    return;
  }
  const auth = await whenAuthReady();
  if (!auth.user) {
    openAuthModal("login");
    return;
  }
  import("./result.js").then((mod) => mod.releasePvpResult()).catch(() => {});
  prepareScreen(Route.PVP_HISTORY);
  activateScreen(Route.PVP_HISTORY);
  setRouteHash(Route.PVP_HISTORY);
  const list = document.getElementById("pvpHistoryList");
  const empty = document.getElementById("pvpHistoryEmpty");
  const statsNode = document.getElementById("pvpStats");
  const blocks = document.getElementById("pvpBlockList");
  if (list) list.replaceChildren();
  if (statsNode) statsNode.replaceChildren();
  if (blocks) blocks.replaceChildren();
  if (empty) empty.hidden = true;
  try {
    const [statsRes, matchesRes, blocksRes] = await Promise.all([
      pvpFetch("/me/pvp/stats"),
      pvpFetch("/me/pvp/matches?limit=20"),
      pvpFetch("/pvp/blocks"),
    ]);
    renderStats(statsRes.data, auth.user);
    renderBlocks(blocksRes.data);
    const entries = matchesRes.data.entries || [];
    if (!entries.length) {
      if (empty) {
        empty.hidden = false;
        empty.textContent = "尚无战绩";
      }
      return;
    }
    for (const row of entries) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "pvp-history-item";
      const title = document.createElement("strong");
      title.className = `pvp-history-outcome is-${row.outcome || "end"}`;
      title.textContent = `${outcomeText(row.outcome)} · ${row.opponentNickname || "对手"}`;
      const meta = document.createElement("span");
      meta.textContent = `${reasonLabel(row.terminalReason)} · 收益 ${formatPpm(row.returnPpm)}`;
      item.append(title, meta);
      item.addEventListener("click", async () => {
        const result = await import("./result.js");
        await result.openPvpMatch(row.matchId);
      });
      list?.appendChild(item);
    }
  } catch (err) {
    if (empty) {
      empty.hidden = false;
      empty.textContent = err.message || "档案暂时打不开";
    }
  }
}

export { displayAvatarUrl };
