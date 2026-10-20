/**
 * 段位说明: plain-Chinese rules + every tier with its icon and score range.
 * Every number here is computed from shared/pvpRating.js (the same module the
 * server settles with) — nothing is typed in by hand.
 *
 *   rating (Elo, K = PVP_RATING_K) starts at PVP_RATING_INITIAL, floor PVP_RATING_FLOOR
 *   level  = floor((rating − floor) / 100) + 1, capped at 15 → title via titleForRating()
 *   段位分 = points inside the current 100-point band (rankPoints)
 *   定级中 = fewer than PVP_PLACEMENT_GAMES rated games (same K, label only)
 *
 * There is no separate 经验/XP stat in the PvP code; the bar on the card is 段位分.
 */
import { closeCtlOverlay, openCtlOverlay } from "../controls.js";
import {
  PVP_PLACEMENT_GAMES,
  PVP_RATING_FLOOR,
  PVP_RATING_INITIAL,
  RANK_GROUPS,
  rawDelta,
  titleForRating,
} from "../../shared/pvpRating.js";

const BAND = 100;
const MAX_LEVEL = 15;

/** All 15 tiers, lowest first: { level, name, group, groupIndex, iconSlug, low, high } (high null = 以上). */
export function rankTiers() {
  const out = [];
  for (let level = 1; level <= MAX_LEVEL; level += 1) {
    const t = titleForRating(PVP_RATING_FLOOR + (level - 1) * BAND);
    out.push({
      level: t.level,
      name: t.name,
      group: t.group,
      groupIndex: t.groupIndex,
      iconSlug: t.iconSlug,
      low: t.bandLow,
      high: t.bandHigh,
    });
  }
  return out;
}

/** Rated games still needed to leave 定级中, or null when not in placement / unknown. */
export function placementGamesLeft(profile) {
  if (!profile || !profile.inPlacement) return null;
  // Every rated game adds exactly one of win / loss / draw (server settlement.js recordRating),
  // so their sum is the rated-games count the server compares with PVP_PLACEMENT_GAMES.
  const played = (Number(profile.wins) || 0) + (Number(profile.losses) || 0) + (Number(profile.draws) || 0);
  const left = PVP_PLACEMENT_GAMES - played;
  return left > 0 ? left : null;
}

/** Example score changes, straight from the settlement formula. */
export function ratingExamples() {
  const base = PVP_RATING_INITIAL;
  return {
    evenWin: rawDelta(base, base, 1),
    evenLoss: rawDelta(base, base, 0),
    evenDraw: rawDelta(base, base, 0.5),
    upWin: rawDelta(base, base + BAND, 1),
    upLoss: rawDelta(base, base + BAND, 0),
    gap: BAND,
  };
}

function signed(n) {
  const v = Number(n) || 0;
  const cls = v > 0 ? "pvp-num-up" : v < 0 ? "pvp-num-down" : "pvp-num-flat";
  const text = v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : "0";
  return `<b class="${cls}">${text}</b>`;
}

function rangeText(tier) {
  return tier.high == null ? `${tier.low} 分以上` : `${tier.low}–${tier.high}`;
}

function iconHtml(slug, size) {
  const base = `assets/pvp/rank-icons/rank-${slug}`;
  return `<img class="pvp-rank-help-icon" src="${base}-hd.png" srcset="${base}-hd.png 1x, ${base}-hd@2x.png 2x" width="${size}" height="${size}" alt="" decoding="async">`;
}

export function rulesHtml() {
  const ex = ratingExamples();
  const start = titleForRating(PVP_RATING_INITIAL).name;
  const lowest = titleForRating(PVP_RATING_FLOOR).name;
  const top = rankTiers()[MAX_LEVEL - 1];
  return [
    `<li>每局对战结束后结算<strong>段位分</strong>：赢了加分，输了扣分。对手越强，赢了加得越多、输了扣得越少。</li>`,
    `<li>和实力相当的人打：赢 ${signed(ex.evenWin)}，输 ${signed(ex.evenLoss)}，平局 ${signed(ex.evenDraw)}。对手比你高 ${ex.gap} 分：赢 ${signed(ex.upWin)}，输 ${signed(ex.upLoss)}。</li>`,
    `<li>每一段 ${BAND} 分，进度条攒满就升一段；分数掉出本段会降回上一段。每 3 段换一个称号：${RANK_GROUPS.join(" → ")}。</li>`,
    `<li>新玩家从<strong>${start}</strong>（${PVP_RATING_INITIAL} 分）起步。最低是${lowest}（${PVP_RATING_FLOOR} 分），再输也不会往下扣；${top.name}（${top.low} 分）是最高段。</li>`,
    `<li>前 ${PVP_PLACEMENT_GAMES} 局显示「定级中」，算分方式和之后完全一样，打满 ${PVP_PLACEMENT_GAMES} 局就不再显示。</li>`,
    `<li>和陪练机器人打也算段位分。中途认输或长时间不操作算输；双方都掉线时这局取消，退还韭币，不计段位分。</li>`,
  ].join("");
}

function tiersHtml(currentName) {
  const tiers = rankTiers();
  return RANK_GROUPS.map((group, gi) => {
    const rows = tiers.filter((t) => t.groupIndex === gi);
    const items = rows.map((t) => {
      const me = currentName && currentName === t.name;
      return `<li class="pvp-rank-help-tier${me ? " is-me" : ""}"><span class="pvp-rank-help-duan">${t.name.slice(group.length)}</span><span class="pvp-rank-help-range">${rangeText(t)}</span>${me ? '<span class="pvp-rank-help-me">你在这里</span>' : ""}</li>`;
    }).join("");
    return `<section class="pvp-rank-help-group">${iconHtml(rows[0].iconSlug, 40)}<div><h4>${group}</h4><ul>${items}</ul></div></section>`;
  }).join("");
}

let modal = null;
let lastProfile = null;

function ensureModal() {
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "pvpRankHelpModal";
  modal.className = "ctl-overlay pvp-rank-help-modal";
  modal.hidden = true;
  modal.setAttribute("aria-hidden", "true");
  modal.innerHTML = `
    <div class="ctl-panel ctl-paper pvp-rank-help-dialog" role="dialog" aria-modal="true" aria-labelledby="pvpRankHelpTitle">
      <button type="button" class="pvp-rank-help-close" data-ctl-focus aria-label="关闭">×</button>
      <h3 id="pvpRankHelpTitle">段位说明</h3>
      <p class="pvp-rank-help-place" id="pvpRankHelpPlace" hidden></p>
      <div class="pvp-rank-help-tiers" id="pvpRankHelpTiers"></div>
      <ul class="pvp-rank-help-rules">${rulesHtml()}</ul>
    </div>`;
  modal.addEventListener("click", (event) => {
    if (event.target === modal || event.target.closest(".pvp-rank-help-close")) closeRankHelp();
  });
  modal.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeRankHelp();
  });
  document.body.append(modal);
  return modal;
}

export function openRankHelp(profile = lastProfile) {
  const node = ensureModal();
  const left = placementGamesLeft(profile);
  const place = node.querySelector("#pvpRankHelpPlace");
  place.hidden = left == null;
  place.textContent = left == null ? "" : `你还在定级中：再打 ${left} 局就定级。`;
  const current = profile?.title ? String(profile.title).split(" · ")[0] : "";
  node.querySelector("#pvpRankHelpTiers").innerHTML = tiersHtml(current);
  openCtlOverlay(node, { focusSelector: ".pvp-rank-help-close" });
}

export function closeRankHelp() {
  if (modal) return closeCtlOverlay(modal, { ms: 220 });
  return Promise.resolve();
}

/** Remember the latest dossier so 段位说明 can mark "你在这里" / placement games left. */
export function noteRankProfile(profile) {
  lastProfile = profile || null;
}

/** Short explanation at the very bottom of the battle page + 段位说明 button. */
export function mountRankHelp(root = document.querySelector("#pvpLobbyScreen .pvp-wrap")) {
  if (!root || root.querySelector("#pvpRankExplain")) return;
  const ex = ratingExamples();
  const box = document.createElement("section");
  box.id = "pvpRankExplain";
  box.className = "pvp-rank-explain";
  box.innerHTML = `
    <h3 class="pvp-kicker">段位怎么算</h3>
    <p>每局结束按输赢结算段位分，实力相当时赢 ${signed(ex.evenWin)}、输 ${signed(ex.evenLoss)}。每段 ${BAND} 分，攒满升一段，掉出本段会降段。前 ${PVP_PLACEMENT_GAMES} 局是「定级中」，算分规则不变，打满就定级。</p>
    <button type="button" class="pvp-btn ctl ctl-secondary pvp-rank-explain-btn" id="pvpRankHelpBtn" data-ctl-kind="secondary" data-state="default"><span class="ctl-label">段位说明</span></button>`;
  box.querySelector("#pvpRankHelpBtn").addEventListener("click", () => openRankHelp());
  root.append(box);
}
