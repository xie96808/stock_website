import { displayAvatarUrl, getAuthState } from "../auth.js";
import { holdPvpSocket, pvpEnabled, pvpFetch, startPoll } from "./transport.js";

const GIFT_MS = 2600;
const GIFT_LABEL = { flower: "鲜花", tomato: "臭番茄", pipe: "烟斗" };
const IGNORE_KEY = "pvp-ignored-invites";

let started = false;
let enabled = null;
let stopPoll = null;
let releaseSocket = null;
let afterGift = 0;
let inbound = [];
let timeBase = { server: 0, local: 0 };
let showingId = "";
let busy = false;
const seenGifts = new Set();

function loadIgnored() {
  try {
    const raw = JSON.parse(sessionStorage.getItem(IGNORE_KEY) || "[]");
    return new Set(Array.isArray(raw) ? raw.map(String) : []);
  } catch {
    return new Set();
  }
}

const ignored = loadIgnored();

function saveIgnored() {
  try { sessionStorage.setItem(IGNORE_KEY, JSON.stringify([...ignored].slice(-40))); } catch { /* ignore */ }
}

function dialog() {
  return document.getElementById("pvpInviteDialog");
}

function hideInvite() {
  const node = dialog();
  if (node) node.hidden = true;
  showingId = "";
}

function giftStage() {
  let node = document.getElementById("pvpGiftStage");
  if (node) return node;
  node = document.createElement("div");
  node.id = "pvpGiftStage";
  node.className = "pvp-gift-stage";
  node.setAttribute("aria-live", "polite");
  document.body.append(node);
  return node;
}

function giftArt(kind) {
  if (kind === "tomato") {
    return `<svg class="pvp-gift-art" viewBox="0 0 64 64" aria-hidden="true">
      <path d="M32 14c2-6 8-8 12-6-2 4-2 8 0 10 6 1 10 6 10 12 0 12-10 22-22 22S10 42 10 30c0-6 4-11 10-12 2-2 2-6 0-10 4-2 10 0 12 6z" fill="#c44536"/>
      <path d="M30 16c2 4 6 6 10 5" fill="none" stroke="#3d6b3a" stroke-width="2"/>
    </svg>`;
  }
  if (kind === "pipe") {
    return `<svg class="pvp-gift-art" viewBox="0 0 64 64" aria-hidden="true">
      <path d="M14 40h24c8 0 12-6 12-12" fill="none" stroke="#8a7350" stroke-width="4" stroke-linecap="round"/>
      <circle cx="18" cy="40" r="6" fill="#6b5344"/>
      <circle class="pvp-smoke" cx="46" cy="20" r="4" fill="none" stroke="#8b949e" stroke-width="1.5"/>
      <circle class="pvp-smoke" cx="52" cy="14" r="3" fill="none" stroke="#8b949e" stroke-width="1.5"/>
    </svg>`;
  }
  return `<svg class="pvp-gift-art" viewBox="0 0 64 64" aria-hidden="true">
    <circle cx="32" cy="34" r="8" fill="#f0c14a"/>
    <circle cx="32" cy="18" r="7" fill="#e05252"/>
    <circle cx="46" cy="28" r="7" fill="#e05252"/>
    <circle cx="42" cy="44" r="7" fill="#e05252"/>
    <circle cx="22" cy="44" r="7" fill="#e05252"/>
    <circle cx="18" cy="28" r="7" fill="#e05252"/>
  </svg>`;
}

function showGift(event) {
  if (!event || seenGifts.has(event.id)) return;
  seenGifts.add(event.id);
  const stage = giftStage();
  const node = document.createElement("div");
  node.className = `pvp-gift pvp-gift-${event.kind || "flower"}`;
  const art = document.createElement("div");
  art.innerHTML = giftArt(event.kind);
  const caption = document.createElement("p");
  const who = event.nickname || "对手";
  caption.textContent = `${who} 送来${GIFT_LABEL[event.kind] || "一份反馈"}`;
  node.append(art, caption);
  stage.append(node);
  window.setTimeout(() => node.remove(), GIFT_MS);
}

function nowServer() {
  if (!timeBase.server) return Date.now();
  return timeBase.server + (Date.now() - timeBase.local);
}

function nextInvite() {
  const now = nowServer();
  return (inbound || []).find((card) => card?.challengeId && !ignored.has(String(card.challengeId)) && (!card.expiresAt || card.expiresAt > now)) || null;
}

function showInvite(card) {
  const node = dialog();
  if (!node || !card) return;
  if (showingId === card.challengeId && !node.hidden) return;
  showingId = card.challengeId;
  const img = document.getElementById("pvpInviteAvatar");
  if (img) img.src = displayAvatarUrl(card);
  const copy = document.getElementById("pvpInviteCopy");
  if (copy) copy.textContent = `${card.nickname || "对手"} 邀请你对战`;
  const note = document.getElementById("pvpInviteNote");
  if (note) note.textContent = "";
  node.hidden = false;
}

function refreshInvite() {
  const card = nextInvite();
  if (!card) {
    hideInvite();
    return;
  }
  showInvite(card);
}

async function battleOn() {
  if (enabled === true) return true;
  enabled = await pvpEnabled();
  return enabled === true;
}

async function poll() {
  const auth = getAuthState();
  if (!auth.user || document.visibilityState === "hidden") return;
  if (!(await battleOn())) return;
  try {
    const { data } = await pvpFetch("/me/pvp/state");
    inbound = data?.inbound || [];
    if (data?.serverNow) timeBase = { server: data.serverNow, local: Date.now() };
    refreshInvite();
  } catch { /* the next tick retries */ }
  try {
    const { data } = await pvpFetch(`/pvp/reactions?after=${afterGift}`);
    for (const event of data?.events || []) {
      if (event.id > afterGift) afterGift = event.id;
      showGift(event);
    }
  } catch { /* gifts are optional */ }
}

async function respond(accept) {
  const id = showingId;
  if (!id || busy) return;
  busy = true;
  const note = document.getElementById("pvpInviteNote");
  try {
    const { data } = await pvpFetch(`/pvp/challenges/${encodeURIComponent(id)}/respond`, {
      method: "POST",
      body: { accept },
    });
    ignored.add(String(id));
    saveIgnored();
    hideInvite();
    if (accept && data?.matchId) {
      const lobby = await import("./lobby.js");
      lobby.leavePvpLobby();
      const room = await import("./room.js");
      await room.showPvpRoom(data.matchId);
      return;
    }
    document.dispatchEvent(new Event("pvp:refresh-lobby"));
    await poll();
  } catch (err) {
    if (note) note.textContent = err.message || "没能处理这条约战";
  } finally {
    busy = false;
  }
}

function wire() {
  document.getElementById("pvpInviteIgnore")?.addEventListener("click", () => {
    if (showingId) {
      ignored.add(String(showingId));
      saveIgnored();
    }
    hideInvite();
    refreshInvite();
  });
  document.getElementById("pvpInviteDecline")?.addEventListener("click", () => { respond(false).catch(() => {}); });
  document.getElementById("pvpInviteAccept")?.addEventListener("click", () => { respond(true).catch(() => {}); });
}

/** Invite popup and incoming gifts, on every page while logged in. */
export function startPvpNotices() {
  if (started || typeof document === "undefined") return;
  started = true;
  wire();
  const beat = () => poll().catch(() => {});
  document.addEventListener("stockgame:auth-changed", () => {
    enabled = null;
    if (!getAuthState().user) {
      inbound = [];
      hideInvite();
    }
    beat();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") beat();
  });
  beat();
  stopPoll = startPoll(beat, 1500);
  releaseSocket = holdPvpSocket((msg) => {
    if (msg?.t === "challenge.changed" || msg?.t === "lobby.changed") beat();
  });
}

export function stopPvpNotices() {
  if (stopPoll) stopPoll();
  stopPoll = null;
  if (releaseSocket) releaseSocket();
  releaseSocket = null;
  started = false;
}
