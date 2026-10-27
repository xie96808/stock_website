/**
 * 对战装扮 in the match room: the sticker tray (inside the message picker), the sticker that pops beside a seat, and the
 * entrance effect that plays when a match starts. room.js owns the match state and hands it in through `ctx`; with the flag
 * off (cosmeticsState() is null) none of this shows and nothing is sent.
 */
import { getAuthState } from "../auth.js";
import { pvpFetch } from "./transport.js";
import { stickerSvg, isStickerId } from "../sticker-art-pure.js";
import { playEntranceFx } from "../entrance-fx.js";
import { cosmeticsState, fetchCosmetics, onCosmeticsChange, openCosmeticShop } from "../cosmetic-shop.js";
import { ownedStickerIds, lockedPacks, shouldPlayEntrance } from "../cosmetic-pure.js";

const POP_MS = 3400;
const popTimers = { me: 0, opp: 0 };
let sending = false;
let playedFor = "";
let wired = false;
let ctx = null;
const $ = (id) => document.getElementById(id);

try { playedFor = sessionStorage.getItem("pvpEntrancePlayed") || ""; } catch { /* storage may be blocked */ }

function reducedMotion() {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

/** Repaint the tray from the cached cosmetics state. */
export function renderStickerTray() {
  const tray = $("pvpStickerTray");
  if (!tray) return;
  const st = cosmeticsState();
  if (!st) { tray.hidden = true; tray.innerHTML = ""; return; }
  const playing = ctx?.getView?.()?.status === "playing";
  const owned = ownedStickerIds(st);
  if (owned.length) {
    tray.innerHTML =
      `<div class="pvp-sticker-tray-head"><span>表情</span><button type="button" class="pvp-sticker-tray-shop" data-cos-shop>更多表情</button></div>` +
      `<div class="pvp-sticker-grid">${owned.map((id) => `<button type="button" class="pvp-sticker-btn" data-sticker="${id}" ${playing && !sending ? "" : "disabled"} aria-label="${id}">${stickerSvg(id)}</button>`).join("")}</div>`;
  } else {
    const first = lockedPacks(st)[0];
    const ids = first ? first.stickers.slice(0, 4) : [];
    tray.innerHTML =
      `<div class="pvp-sticker-tray-head"><span>表情包 · 对手能看到</span><button type="button" class="pvp-sticker-tray-shop" data-cos-shop>去解锁</button></div>` +
      `<div class="pvp-sticker-teaser"><div class="pvp-sticker-grid">${ids.map((id) => `<span>${stickerSvg(id)}</span>`).join("")}</div></div>`;
  }
  tray.hidden = false;
}

function popFor(side) {
  const seat = $(side === "me" ? "pvpSeatMe" : "pvpSeatOpp");
  const face = seat?.querySelector(".pvp-seat-face");
  if (!face) return null;
  let pop = face.querySelector(".pvp-sticker-pop");
  if (!pop) {
    pop = document.createElement("div");
    pop.className = "pvp-sticker-pop";
    pop.hidden = true;
    pop.setAttribute("aria-hidden", "true");
    face.append(pop);
  }
  return pop;
}

export function showStickerPop(side, stickerId) {
  const pop = popFor(side);
  if (!pop) return;
  window.clearTimeout(popTimers[side]);
  if (!isStickerId(stickerId)) { pop.hidden = true; pop.innerHTML = ""; return; }
  pop.innerHTML = stickerSvg(stickerId);
  pop.hidden = false;
  if (pop.animate && !reducedMotion()) {
    pop.animate([
      { transform: "scale(2.2) rotate(-12deg)", opacity: 0 },
      { transform: "scale(.94) rotate(3deg)", opacity: 1, offset: 0.35 },
      { transform: "scale(1.04) rotate(-2deg)", opacity: 1, offset: 0.55 },
      { transform: "scale(1) rotate(0deg)", opacity: 1 },
    ], { duration: 420, easing: "cubic-bezier(.2,1,.4,1)" });
  }
  popTimers[side] = window.setTimeout(() => {
    if (pop.animate && !reducedMotion()) {
      pop.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260 }).onfinish = () => { pop.hidden = true; pop.innerHTML = ""; };
    } else {
      pop.hidden = true;
      pop.innerHTML = "";
    }
  }, POP_MS);
}

export function clearStickerPops() {
  showStickerPop("me", null);
  showStickerPop("opp", null);
}

/** WS `match.sticker`: show it beside whoever sent it. */
export function onStickerEvent(msg) {
  const id = ctx?.getMatchId?.();
  if (!id || !msg || msg.t !== "match.sticker" || msg.matchId !== id) return;
  const event = msg.event;
  if (!event || !isStickerId(event.stickerId)) return;
  const auth = getAuthState().user;
  const mine = auth && Number(event.fromUserId) === Number(auth.id);
  showStickerPop(mine ? "me" : "opp", event.stickerId);
}

async function sendSticker(stickerId) {
  const matchId = ctx?.getMatchId?.();
  if (!matchId || sending || !isStickerId(stickerId) || ctx.getView?.()?.status !== "playing") return;
  sending = true;
  renderStickerTray();
  showStickerPop("me", stickerId);
  ctx.closePicker?.();
  try {
    await pvpFetch(`/pvp/matches/${encodeURIComponent(matchId)}/stickers`, { method: "POST", body: { stickerId } });
  } catch (err) {
    showStickerPop("me", null);
    ctx.setStatus?.(err?.message || "表情没能发送");
  } finally {
    sending = false;
    renderStickerTray();
  }
}

/** Play the equipped entrance effects (mine, then the opponent's a beat later) the first time a match shows as playing. */
export function maybePlayEntrance() {
  const view = ctx?.getView?.();
  const matchId = ctx?.getMatchId?.();
  if (!view || !shouldPlayEntrance({ status: view.status, resolvedRounds: view.resolvedRounds, playedFor, matchId })) return;
  playedFor = matchId;
  try { sessionStorage.setItem("pvpEntrancePlayed", matchId); } catch { /* ignore */ }
  const auth = getAuthState().user;
  const mine = view.me?.pvpEntrance || auth?.pvpEntrance || null;
  const theirs = view.opponent?.pvpEntrance || null;
  if (mine) playEntranceFx(mine, $("pvpSeatMeAvatar")).catch(() => {});
  if (theirs) window.setTimeout(() => playEntranceFx(theirs, $("pvpSeatOppAvatar")).catch(() => {}), mine ? 450 : 0);
}

/** room.js calls this once; `c` = { getView, getMatchId, closePicker, setStatus }. */
export function initRoomCosmetics(c) {
  ctx = c;
  if (wired) return;
  wired = true;
  onCosmeticsChange(() => renderStickerTray());
  $("pvpStickerTray")?.addEventListener("click", (e) => {
    const t = e.target && e.target.closest ? e.target : null;
    const st = t && t.closest("[data-sticker]");
    if (st) { sendSticker(st.getAttribute("data-sticker")).catch(() => {}); return; }
    if (t && t.closest("[data-cos-shop]")) openCosmeticShop().catch(() => {});
  });
}

/** Called when the room opens: warm the cosmetics state so the tray is ready. */
export function warmRoomCosmetics() {
  fetchCosmetics().then(() => renderStickerTray()).catch(() => {});
}
