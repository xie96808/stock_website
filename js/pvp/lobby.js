import { displayAvatarUrl, getAuthState, openAuthModal } from "../auth.js";
import { Route, prepareScreen, activateScreen, setRouteHash } from "../screen-router.js";
import { formatRemain, remainingMs } from "./copy.js";
import { holdPvpSocket, pvpEnabled, pvpFetch, startPoll, whenAuthReady } from "./transport.js";

let showing = false;
let stopPoll = null;
let stopHeartbeat = null;
let releaseSocket = null;
let wired = false;
let lastAvailable = false;
let waitingOutbound = false;
let latestState = null;
let acceptingNew = true;
const seenRevision = new Map();

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value == null ? "" : String(value);
}

function setError(message) {
  const node = document.getElementById("pvpLobbyError");
  if (!node) return;
  node.textContent = message || "";
}

export async function refreshPvpEntry() {
  const card = document.getElementById("pvpEntryCard");
  if (!card) return;
  card.hidden = !(await pvpEnabled());
}

function stopLoops() {
  if (stopPoll) stopPoll();
  stopPoll = null;
  if (stopHeartbeat) stopHeartbeat();
  stopHeartbeat = null;
  if (releaseSocket) releaseSocket();
  releaseSocket = null;
}

export function leavePvpLobby() {
  const clear = showing && lastAvailable;
  showing = false;
  stopLoops();
  if (clear) {
    lastAvailable = false;
    pvpFetch("/pvp/lobby/presence", { method: "POST", body: { available: false } }).catch(() => {});
  }
}

function syncHeartbeat(available) {
  if (available && showing) {
    if (!stopHeartbeat) {
      const beat = () => pvpFetch("/pvp/heartbeat", { method: "POST", body: {} });
      beat().catch(() => {});
      stopHeartbeat = startPoll(beat, 15_000);
    }
    return;
  }
  if (stopHeartbeat) {
    stopHeartbeat();
    stopHeartbeat = null;
  }
}

function outcomeGlyph(outcome) {
  if (outcome === "win") return "胜";
  if (outcome === "loss") return "负";
  if (outcome === "draw") return "平";
  return "·";
}

function challengeKey(userId) {
  const id = String(userId);
  const store = challengeKey.map || (challengeKey.map = new Map());
  if (!store.has(id)) store.set(id, `pvp-${crypto.randomUUID()}`);
  return store.get(id);
}

function dropChallengeKey(userId) {
  challengeKey.map?.delete(String(userId));
}

export async function sendChallenge(userId) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) return;
  setError("");
  try {
    await pvpFetch("/pvp/challenges", {
      method: "POST",
      body: { toUserId: id },
      idempotencyKey: challengeKey(id),
    });
    dropChallengeKey(id);
    waitingOutbound = true;
    if (showing) await refresh();
  } catch (err) {
    if (err.status) dropChallengeKey(id);
    setError(err.message || "约战没能发出");
  }
}

export async function challengeFromResult(userId) {
  await showPvpLobby();
  if (userId) await sendChallenge(userId);
}

async function enterMatch(matchId) {
  leavePvpLobby();
  const room = await import("./room.js");
  await room.showPvpRoom(matchId);
}

async function respond(challengeId, accept) {
  setError("");
  try {
    const { data } = await pvpFetch(`/pvp/challenges/${encodeURIComponent(challengeId)}/respond`, {
      method: "POST",
      body: { accept },
    });
    if (accept && data.matchId) {
      await enterMatch(data.matchId);
      return;
    }
    if (showing) await refresh();
  } catch (err) {
    setError(err.message || "没能处理这条约战");
  }
}

async function cancelOutbound(challengeId) {
  setError("");
  try {
    await pvpFetch(`/pvp/challenges/${encodeURIComponent(challengeId)}/cancel`, {
      method: "POST",
      body: {},
    });
    if (showing) await refresh();
  } catch (err) {
    setError(err.message || "没能取消约战");
  }
}

function renderInvites(state) {
  const inbound = document.getElementById("pvpInbound");
  const outbound = document.getElementById("pvpOutbound");
  if (inbound) inbound.replaceChildren();
  if (outbound) outbound.replaceChildren();
  if (state.outbound && outbound) {
    const row = document.createElement("div");
    row.className = "pvp-invite";
    const text = document.createElement("p");
    const left = remainingMs(state.outbound.expiresAt, state.serverNow, Date.now());
    text.textContent = `已向 ${state.outbound.nickname || "对手"} 发出约战 · 剩余 ${formatRemain(left)}`;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pvp-btn";
    button.textContent = "取消约战";
    button.addEventListener("click", () => { cancelOutbound(state.outbound.challengeId).catch(() => {}); });
    row.append(text, button);
    outbound.append(row);
  }
  for (const card of state.inbound || []) {
    if (!inbound) break;
    const row = document.createElement("div");
    row.className = "pvp-invite";
    const text = document.createElement("p");
    text.textContent = `${card.nickname || "对手"} 邀请你对战`;
    const accept = document.createElement("button");
    accept.type = "button";
    accept.className = "pvp-btn pvp-btn-primary";
    accept.textContent = "接受";
    accept.disabled = !acceptingNew;
    accept.addEventListener("click", () => { respond(card.challengeId, true).catch(() => {}); });
    const decline = document.createElement("button");
    decline.type = "button";
    decline.className = "pvp-btn";
    decline.textContent = "拒绝";
    decline.addEventListener("click", () => { respond(card.challengeId, false).catch(() => {}); });
    row.append(text, accept, decline);
    inbound.append(row);
  }
}

function renderList(entries, state) {
  const list = document.getElementById("pvpLobbyList");
  const empty = document.getElementById("pvpLobbyEmpty");
  const modes = document.getElementById("pvpLobbyModes");
  if (list) list.replaceChildren();
  const rows = entries || [];
  const showEmpty = rows.length === 0;
  if (empty) empty.hidden = !showEmpty;
  if (modes) modes.hidden = !showEmpty;
  const blocked = !acceptingNew || !state?.eligibility?.ok || !!state?.outbound;
  for (const entry of rows) {
    if (!list) break;
    const item = document.createElement("article");
    item.className = "pvp-person";
    const img = document.createElement("img");
    img.className = "pvp-avatar";
    img.alt = "";
    img.width = 40;
    img.height = 40;
    img.src = displayAvatarUrl(entry);
    const body = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = entry.nickname || "对手";
    const title = document.createElement("span");
    title.textContent = entry.title || "";
    const recent = document.createElement("span");
    const marks = (entry.recent || []).map(outcomeGlyph).join("");
    recent.textContent = marks ? `近况 ${marks}` : "暂无近况";
    body.append(name, title, recent);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pvp-btn pvp-btn-primary";
    if (entry.busy) {
      button.textContent = "对局中";
      button.disabled = true;
    } else if (blocked) {
      button.textContent = "约战";
      button.disabled = true;
    } else {
      button.textContent = "约战";
      button.addEventListener("click", () => { sendChallenge(entry.userId).catch(() => {}); });
    }
    item.append(img, body, button);
    list.append(item);
  }
}

function renderState(state) {
  latestState = state;
  lastAvailable = state.available === true;
  const box = document.getElementById("pvpAvailable");
  if (box) box.checked = lastAvailable;
  const eligibility = document.getElementById("pvpLobbyEligibility");
  if (eligibility) {
    eligibility.hidden = !!state.eligibility?.ok;
    eligibility.textContent = state.eligibility?.ok ? "" : (state.eligibility?.message || "");
  }
  setText("pvpLobbyBalance", `余额 ${state.balance} 韭币`);
  const active = document.getElementById("pvpActiveMatch");
  if (active) active.hidden = !state.activeMatchId;
  renderInvites(state);
  syncHeartbeat(lastAvailable);
}

async function refresh() {
  if (!showing) return;
  const summary = await pvpFetch("/pvp/lobby/summary");
  if (!showing) return;
  if (summary.data?.disabledReason === "对战未开放") {
    leavePvpLobby();
    if (typeof window.showSimHub === "function") window.showSimHub();
    return;
  }
  acceptingNew = summary.data?.acceptingNew !== false;
  setText("pvpLobbyCount", `当前可约战 ${summary.data.availableCount} 人`);
  const closed = document.getElementById("pvpLobbyClosed");
  if (closed) {
    closed.hidden = !summary.data.disabledReason;
    closed.textContent = summary.data.disabledReason || "";
  }
  const auth = getAuthState();
  const guest = document.getElementById("pvpLobbyGuest");
  const member = document.getElementById("pvpLobbyMember");
  if (!auth.user) {
    if (guest) guest.hidden = false;
    if (member) member.hidden = true;
    syncHeartbeat(false);
    return;
  }
  if (guest) guest.hidden = true;
  if (member) member.hidden = false;
  const prevOutbound = waitingOutbound;
  const { data } = await pvpFetch("/me/pvp/state");
  if (!showing) return;
  renderState(data);
  const lobby = await pvpFetch("/pvp/lobby?limit=50");
  if (!showing) return;
  renderList(lobby.data.entries || [], data);
  const entered = prevOutbound && !data.outbound && data.activeMatchId;
  waitingOutbound = !!data.outbound;
  if (entered) await enterMatch(data.activeMatchId);
}

function newerPush(matchId, revision) {
  if (revision == null) return true;
  const next = Number(revision);
  const prev = seenRevision.get(matchId);
  if (prev != null && next < prev) return false;
  seenRevision.set(matchId, next);
  return true;
}

function onSocket(msg) {
  if (!showing || !msg) return;
  if (msg.t === "lobby.changed" || msg.t === "challenge.changed") {
    refresh().catch((err) => setError(err.message || ""));
    return;
  }
  if (msg.t === "match.changed" && msg.matchId) {
    if (!newerPush(msg.matchId, msg.revision)) return;
    refresh().catch((err) => setError(err.message || ""));
  }
}

function wireLobby() {
  if (wired) return;
  wired = true;
  document.getElementById("pvpLobbyBack")?.addEventListener("click", () => {
    leavePvpLobby();
    if (typeof window.showSimHub === "function") window.showSimHub();
  });
  document.getElementById("pvpLobbyLogin")?.addEventListener("click", () => openAuthModal("login"));
  document.getElementById("pvpLobbyModes")?.addEventListener("click", () => {
    leavePvpLobby();
    if (typeof window.showPlayModes === "function") window.showPlayModes();
  });
  document.getElementById("pvpActiveMatch")?.addEventListener("click", () => {
    const id = latestState?.activeMatchId;
    if (id) enterMatch(id).catch((err) => setError(err.message || ""));
  });
  document.getElementById("pvpAvailable")?.addEventListener("change", async (event) => {
    const want = event.target.checked === true;
    try {
      await pvpFetch("/pvp/lobby/presence", { method: "POST", body: { available: want } });
      lastAvailable = want;
      if (showing) await refresh();
    } catch (err) {
      event.target.checked = !want;
      setError(err.message || "没能切换可约战");
    }
  });
  document.addEventListener("stockgame:auth-changed", () => {
    if (showing) refresh().catch(() => {});
  });
}

export async function showPvpLobby() {
  import("./result.js").then((mod) => mod.releasePvpResult()).catch(() => {});
  const on = await pvpEnabled();
  if (!on) {
    if (typeof window.showSimHub === "function") window.showSimHub();
    return;
  }
  prepareScreen(Route.PVP_LOBBY);
  activateScreen(Route.PVP_LOBBY);
  setRouteHash(Route.PVP_LOBBY);
  wireLobby();
  showing = true;
  setError("");
  const guest = document.getElementById("pvpLobbyGuest");
  const member = document.getElementById("pvpLobbyMember");
  if (guest) guest.hidden = true;
  if (member) member.hidden = true;
  await whenAuthReady();
  if (!showing) return;
  try {
    await refresh();
  } catch (err) {
    setError(err.message || "大厅暂时打不开");
  }
  if (!showing) return;
  if (stopPoll) stopPoll();
  stopPoll = startPoll(() => refresh(), 5000);
  if (releaseSocket) releaseSocket();
  releaseSocket = holdPvpSocket(onSocket);
}

export async function openPvpHash(matchId) {
  const on = await pvpEnabled();
  if (!on) {
    if (typeof window.showSimHub === "function") window.showSimHub();
    return;
  }
  const result = await import("./result.js");
  await result.openPvpMatch(matchId);
}
