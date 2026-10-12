import { displayAvatarUrl, getAuthState } from "../auth.js";
import { parseRouteHash } from "../screen-router.js";
import { holdPvpSocket, pvpEnabled, pvpFetch, startPoll } from "./transport.js";

const GIFT_MS = 1700;
const GIFT_EMOJI = { flower: "🌸", tomato: "🍅", pipe: "💨", coffee: "☕" };
const GIFT_NAME = { flower: "花花", tomato: "番茄", pipe: "电子烟斗", coffee: "咖啡" };
const IGNORE_KEY = "pvp-ignored-invites";
const JOIN_KEY = "pvp-join-code";

let started = false;
let enabled = null;
let stopPoll = null;
let releaseSocket = null;
let afterGift = 0;
let inbound = [];
let timeBase = { server: 0, local: 0 };
let showingId = "";
let busy = false;
let pulledMatch = "";
let pulling = false;
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

function showGift(event) {
  if (!event || seenGifts.has(event.id)) return;
  seenGifts.add(event.id);
  const stage = giftStage();
  const node = document.createElement("div");
  const kind = GIFT_EMOJI[event.kind] ? event.kind : "flower";
  node.className = `pvp-gift pvp-gift-${kind}`;
  const emoji = GIFT_EMOJI[kind];
  const art = document.createElement("p");
  art.className = "pvp-gift-emoji";
  art.textContent = emoji;
  const caption = document.createElement("p");
  caption.className = "pvp-gift-caption";
  const who = event.nickname || "对手";
  caption.textContent = `${who} 送来${GIFT_NAME[kind]}`;
  node.append(art, caption);
  stage.append(node);
  window.setTimeout(() => node.remove(), GIFT_MS);
}

async function maybeEnterReady(data) {
  const id = data?.activeMatchId || "";
  const status = data?.activeMatchStatus || "";
  if (!id) {
    pulledMatch = "";
    return;
  }
  if (status !== "waiting_ready") return;
  const hash = parseRouteHash() || "";
  if (hash === `pvp/${id}`) {
    pulledMatch = id;
    return;
  }
  if (pulledMatch === id || pulling) return;
  pulling = true;
  pulledMatch = id;
  try {
    const lobby = await import("./lobby.js");
    lobby.leavePvpLobby();
    const room = await import("./room.js");
    await room.showPvpRoom(id);
  } catch {
    pulledMatch = "";
  } finally {
    pulling = false;
  }
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
    await maybeEnterReady(data);
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
    } else {
      let code = "";
      try { code = sessionStorage.getItem(JOIN_KEY) || ""; } catch { code = ""; }
      if (code) {
        import("./lobby.js").then((mod) => mod.joinSharedBattle(code)).catch(() => {});
      }
    }
    beat();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") beat();
  });
  beat();
  stopPoll = startPoll(beat, 1500);
  releaseSocket = holdPvpSocket((msg) => {
    if (msg?.t === "challenge.changed" || msg?.t === "lobby.changed" || msg?.t === "match.changed") beat();
  });
}

export function stopPvpNotices() {
  if (stopPoll) stopPoll();
  stopPoll = null;
  if (releaseSocket) releaseSocket();
  releaseSocket = null;
  started = false;
}
