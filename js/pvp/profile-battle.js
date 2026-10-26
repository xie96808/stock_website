import { closeAuthModal, displayAvatarUrl, getAuthState, openAuthModal } from "../auth.js";
import { applyFrameToImg } from "../avatar-frame.js";
import { Route, prepareScreen, activateScreen, setRouteHash } from "../screen-router.js";
import { rankPoints, rankProgress, rankIconPathForTitle } from "../../shared/pvpRating.js";
import { formatPpm, formatWinRate, reasonLabel } from "./copy.js";
import { pvpEnabled, pvpFetch, whenAuthReady } from "./transport.js";
import { noteRankProfile, openRankHelp, placementGamesLeft } from "./rank-help.js";


function escapeAttr(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

/** Inline rank-group icon next to a title string. */
export function rankTitleWithIcon(titleText, { className = "pvp-rank-title" } = {}) {
  const wrap = document.createElement("span");
  wrap.className = className;
  const icon = document.createElement("img");
  icon.className = "pvp-rank-icon";
  icon.alt = "";
  icon.width = 22;
  icon.height = 22;
  icon.decoding = "async";
  icon.src = rankIconPathForTitle(titleText);
  icon.onerror = () => { icon.hidden = true; };
  const label = document.createElement("span");
  label.className = "pvp-rank-title-text";
  label.textContent = titleText || "";
  wrap.append(icon, label);
  return wrap;
}

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
  noteRankProfile(profile);
  // Hand-drawn rank card shell (ctl-rank-card): rank icon sits in the left slot.
  node.classList.add("ctl-rank-card");
  const emblem = document.createElement("img");
  emblem.className = "pvp-dossier-emblem";
  emblem.alt = "";
  emblem.setAttribute("aria-hidden", "true");
  emblem.width = 72;
  emblem.height = 72;
  emblem.decoding = "async";
  // Batch 2: HD rank art (144 / @2x 288) fills the 72×72 slot; legacy PNG is the fallback.
  const legacyIcon = rankIconPathForTitle(profile.title || "散户一段");
  const rankKey = (legacyIcon.match(/rank-([a-z]+)\.png/) || [])[1] || "";
  emblem.dataset.rank = rankKey;
  if (rankKey) {
    const hd = legacyIcon.replace(/\.png$/, "-hd");
    emblem.src = `${hd}.png`;
    emblem.srcset = `${hd}.png 1x, ${hd}@2x.png 2x`;
    emblem.onerror = () => {
      emblem.onerror = () => { emblem.hidden = true; };
      emblem.removeAttribute("srcset");
      emblem.src = legacyIcon;
    };
  } else {
    emblem.src = legacyIcon;
    emblem.onerror = () => { emblem.hidden = true; };
  }
  const img = document.createElement("img");
  img.className = "pvp-dossier-avatar";
  img.alt = "";
  img.width = 72;
  img.height = 72;
  img.src = displayAvatarUrl(profile);
  const avatarBtn = document.createElement("button");
  avatarBtn.type = "button";
  avatarBtn.className = "pvp-dossier-avatar-btn";
  avatarBtn.title = "更换头像";
  avatarBtn.setAttribute("aria-label", "更换头像");
  avatarBtn.append(img);
  applyFrameToImg(img, profile.avatarFrame);
  avatarBtn.addEventListener("click", () => openAuthModal("settings"));
  const body = document.createElement("div");
  body.className = "pvp-dossier-body";
  const name = document.createElement("p");
  name.className = "pvp-dossier-name";
  name.textContent = profile.nickname || "我";
  const rank = document.createElement("p");
  rank.className = "pvp-dossier-rank";
  rank.append(rankTitleWithIcon(profile.title || "散户一段"));
  body.append(name, rank);
  if (profile.inPlacement) {
    // 定级中 is tappable: opens 段位说明, and says how many rated games are left.
    const place = document.createElement("button");
    place.type = "button";
    place.className = "pvp-dossier-place pvp-dossier-place-btn";
    const left = placementGamesLeft(profile);
    // Short label keeps the rank line on one row at 360; the modal says 再打 N 局.
    place.textContent = "定级中";
    const hint = left == null ? "定级中，点开看段位说明" : `定级中：再打 ${left} 局定级，点开看段位说明`;
    place.title = hint;
    place.setAttribute("aria-label", hint);
    place.setAttribute("aria-haspopup", "dialog");
    place.addEventListener("click", () => openRankHelp(profile));
    body.append(place);
  }
  if (profile.rating != null && Number.isFinite(Number(profile.rating))) {
    const score = document.createElement("p");
    score.className = "pvp-dossier-score";
    score.textContent = `段位分 ${rankPoints(profile.rating)}`;
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
  node.append(emblem, avatarBtn, body, record);
}

export async function syncPvpProfile() {
  const on = await pvpEnabled();
  const auth = getAuthState();
  const loggedIn = !!(auth.user && auth.ready !== false);
  // 对战档案 lives in the account panel (top-right 个人资料), not as a home chip.
  document.getElementById("pvpArchiveBtn")?.remove();

  const panel = document.getElementById("authSettingsPanel");
  if (!panel) return;
  let section = document.getElementById("pvpSettingsSection");
  if (on && !section) {
    section = document.createElement("div");
    section.id = "pvpSettingsSection";
    section.className = "pvp-settings";
    const title = document.createElement("p");
    title.className = "pvp-settings-title";
    title.textContent = "对战段位";
    const rank = document.createElement("div");
    rank.id = "pvpSettingsRank";
    rank.className = "pvp-settings-rank";
    rank.textContent = "段位";
    const archive = document.createElement("button");
    archive.type = "button";
    archive.id = "pvpSettingsArchiveBtn";
    archive.className = "auth-secondary ctl ctl-secondary pvp-settings-archive";
    archive.dataset.ctlKind = "secondary";
    archive.dataset.state = "default";
    const label = document.createElement("span");
    label.className = "ctl-label";
    label.textContent = "对战档案";
    archive.append(label);
    archive.addEventListener("click", () => {
      closeAuthModal();
      showPvpHistory().catch(() => {});
    });
    section.append(title, rank, archive);
    panel.insertBefore(section, panel.querySelector("hr") || null);
  }
  if (section) section.hidden = !on;
  const archiveBtn = document.getElementById("pvpSettingsArchiveBtn");
  if (archiveBtn) archiveBtn.hidden = !(on && loggedIn);
  const rank = document.getElementById("pvpSettingsRank");
  if (rank && on && loggedIn) {
    pvpFetch("/me/pvp/stats").then(({ data }) => {
      const place = data?.title?.inPlacement ? " · 定级中" : "";
      const name = `${data?.title?.name || "散户一段"}${place}`;
      rank.textContent = "";
      rank.append(rankTitleWithIcon(name));
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
  const recentLabel = document.createElement("p");
  recentLabel.className = "pvp-dots-label";
  recentLabel.textContent = "近期战绩";
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
  if ((stats.recent || []).length) node.append(recentLabel);
  node.append(dots, completed);
}

// 「战绩详情」fold: detailed rows hidden by default, toggled by a hand-drawn control.
function setHistoryFold(open) {
  const toggle = document.getElementById("pvpHistoryToggle");
  const fold = document.getElementById("pvpHistoryFold");
  if (!toggle || !fold) return;
  toggle.setAttribute("aria-expanded", open ? "true" : "false");
  const glyph = toggle.querySelector(".pvp-details-glyph");
  if (glyph) glyph.textContent = open ? "▴" : "▾";
  fold.dataset.open = open ? "true" : "false";
  fold.inert = !open;
  fold.setAttribute("aria-hidden", open ? "false" : "true");
}

function bindHistoryFold() {
  const toggle = document.getElementById("pvpHistoryToggle");
  if (!toggle || toggle.dataset.bound === "1") return;
  toggle.dataset.bound = "1";
  toggle.addEventListener("click", () => {
    setHistoryFold(toggle.getAttribute("aria-expanded") !== "true");
  });
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
    button.className = "pvp-btn ctl ctl-secondary";
    button.dataset.ctlKind = "secondary";
    button.dataset.state = "default";
    button.innerHTML = '<span class="ctl-label">取消屏蔽</span>';
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
    if (typeof window.showHome === "function") window.showHome();
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
  bindHistoryFold();
  setHistoryFold(false);
  const foldToggle = document.getElementById("pvpHistoryToggle");
  if (foldToggle) foldToggle.hidden = true;
  if (statsNode) statsNode.replaceChildren();
  if (blocks) blocks.replaceChildren();
  if (empty) {
    empty.hidden = false;
    empty.textContent = "档案加载中…";
  }
  try {
    const [statsRes, matchesRes, blocksRes] = await Promise.all([
      pvpFetch("/me/pvp/stats"),
      pvpFetch("/me/pvp/matches?limit=20"),
      pvpFetch("/pvp/blocks"),
    ]);
    if (empty) empty.hidden = true;
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
    if (foldToggle) foldToggle.hidden = false;
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
