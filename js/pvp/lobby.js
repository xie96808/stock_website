import { displayAvatarUrl, getAuthState, openAuthModal, showToast } from "../auth.js";
import { coinIconHtml } from "../jiu-coin.js";
import { setCtlState, shakeError, ensureCastbar } from "../controls.js";
import { Route, prepareScreen, activateScreen, setRouteHash } from "../screen-router.js";
import { escapeHtml, formatRemain, remainingMs } from "./copy.js";
import { buildInviteCanvas, canSendToWeChat, copyInviteLink, forgetInvitePayload, getInvitePayload, saveInviteImage, sendInviteToWeChat } from "./invite-share.js";
import { mountRankHelp } from "./rank-help.js";
import { fillDossier, rankTitleWithIcon } from "./profile-battle.js";
import { mountBattleCover, setPvpAvatar } from "./bot-art.js";
import { holdPvpSocket, pvpEnabled, pvpFetch, startPoll, whenAuthReady } from "./transport.js";
import { loadChunk } from "../chunk-reload.js";

let showing = false;
let stopPoll = null;
let releaseSocket = null;
let wired = false;
let presenceWired = false;
let presenceOn = false;
let stopPresenceBeat = null;
let presenceChain = Promise.resolve();
let waitingOutbound = false;
let latestState = null;
let acceptingNew = true;
let respondInFlight = false;
const seenRevision = new Map();

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value == null ? "" : String(value);
}

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to the older copy path */ }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Busy flag on the two small share icons (copy / save image). */
async function withMiniBusy(button, task) {
  if (!button || button.getAttribute("aria-busy") === "true") return;
  button.setAttribute("aria-busy", "true");
  button.disabled = true;
  try {
    await task();
  } finally {
    button.removeAttribute("aria-busy");
    button.disabled = !(latestState?.eligibility?.ok && acceptingNew);
  }
}

function nativeAppShare(payload) {
  try {
    const bridge = typeof window !== "undefined" ? window.StockGameApp : null;
    if (bridge && typeof bridge.share === "function") {
      bridge.share(payload.title || "", payload.text || "", payload.url || "");
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

async function systemShare(payload) {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") return false;
  try {
    await navigator.share({
      title: payload.title,
      text: payload.text,
      url: payload.url,
    });
    return true;
  } catch (err) {
    // User cancelled the sheet — do not fall through to clipboard spam.
    if (err && (err.name === "AbortError" || err.name === "NotAllowedError")) return "cancelled";
    return false;
  }
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
  if (releaseSocket) releaseSocket();
  releaseSocket = null;
}

async function applyPresence(want) {
  if (want) {
    if (!presenceOn) {
      await pvpFetch("/pvp/lobby/presence", { method: "POST", body: { available: true } });
      presenceOn = true;
    }
    if (!stopPresenceBeat) {
      const beat = () => pvpFetch("/pvp/heartbeat", { method: "POST", body: {} });
      beat().catch(() => {});
      stopPresenceBeat = startPoll(beat, 15_000);
    }
    return;
  }
  if (stopPresenceBeat) {
    stopPresenceBeat();
    stopPresenceBeat = null;
  }
  if (!presenceOn) return;
  presenceOn = false;
  await pvpFetch("/pvp/lobby/presence", { method: "POST", body: { available: false } }).catch(() => {});
}

/** Logged-in players are available while the app is open. There is no opt-in switch. */
export function syncSessionPresence() {
  wirePresence();
  presenceChain = presenceChain.then(async () => {
    const auth = getAuthState();
    if (!auth.ready) return;
    const visible = typeof document === "undefined" || document.visibilityState !== "hidden";
    const want = !!(auth.user && visible && await pvpEnabled());
    await applyPresence(want);
  }).catch(() => {});
  return presenceChain;
}

function wirePresence() {
  if (presenceWired || typeof document === "undefined") return;
  presenceWired = true;
  document.addEventListener("stockgame:auth-changed", () => { syncSessionPresence(); });
  document.addEventListener("visibilitychange", () => { syncSessionPresence(); });
}

export function leavePvpLobby() {
  showing = false;
  forgetInvitePayload();
  stopLoops();
  document.getElementById("pvpLobbyScreen")?.classList.remove("pvp-instant");
}

function outcomeGlyph(outcome) {
  if (outcome === "win") {
    return '<span class="pvp-recent-mark is-win" title="胜" aria-label="胜">✓</span>';
  }
  if (outcome === "loss") {
    return '<span class="pvp-recent-mark is-loss" title="负" aria-label="负">✕</span>';
  }
  if (outcome === "draw") {
    return '<span class="pvp-recent-mark is-draw" title="平" aria-label="平">–</span>';
  }
  return "";
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

export async function sendChallenge(userId, button = null) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) return;
  setError("");
  if (button) setCtlState(button, "loading", { syncImg: false });
  try {
    const res = await pvpFetch("/pvp/challenges", {
      method: "POST",
      body: { toUserId: id },
      idempotencyKey: challengeKey(id),
    });
    dropChallengeKey(id);
    if (res?.data?.matchId && res.data.autoAccepted) {
      waitingOutbound = false;
      await enterMatch(res.data.matchId);
      return;
    }
    waitingOutbound = true;
    if (showing) await refresh();
  } catch (err) {
    if (err.status) dropChallengeKey(id);
    setError(err.message || "约战没能发出");
    if (button && button.isConnected) {
      setCtlState(button, "default", { clearDisabled: true, syncImg: false });
      shakeError(button);
    }
  }
}

export async function challengeFromResult(userId) {
  await showPvpLobby();
  if (userId) await sendChallenge(userId);
}

async function enterMatch(matchId) {
  leavePvpLobby();
  const room = await loadChunk(() => import("./room.js"));
  await room.showPvpRoom(matchId);
}

let joiningCode = "";

export async function joinSharedBattle(code) {
  const normalized = String(code || "").trim().toLowerCase();
  if (!/^[a-z2-9]{8}$/.test(normalized)) return;
  await whenAuthReady();
  if (!getAuthState().user) {
    try { sessionStorage.setItem("pvp-join-code", normalized); } catch { /* ignore */ }
    openAuthModal("login");
    return;
  }
  if (joiningCode === normalized) return;
  joiningCode = normalized;
  try { sessionStorage.removeItem("pvp-join-code"); } catch { /* ignore */ }
  try {
    const { data } = await pvpFetch(`/pvp/shares/${encodeURIComponent(normalized)}/join`, {
      method: "POST",
      body: {},
    });
    await enterMatch(data.matchId);
  } catch (err) {
    await showPvpLobby();
    setError(err.message || "没能进入这场对战");
  } finally {
    joiningCode = "";
  }
}

export const SHARE_PENDING_LABEL = "生成链接…";
let sharePending = false;

async function shareBattle() {
  // Lobby polling re-renders the button (disabled = !shareOk) while the request
  // is in flight, so a disabled button alone does not dedupe repeat taps.
  if (sharePending) return;
  sharePending = true;
  setError("");
  const note = document.getElementById("pvpShareNote");
  if (note) note.textContent = "";
  const button = document.getElementById("pvpShareBtn");
  const label = button?.querySelector(".ctl-label");
  const idleText = label?.textContent || "分享对战";
  if (button) {
    button.disabled = true;
    // Immediate feedback while POST /pvp/shares is in flight (M-10): before, the
    // button only went disabled with no visible change for several seconds.
    button.setAttribute("aria-busy", "true");
    button.classList.add("is-pending");
  }
  if (label) label.textContent = SHARE_PENDING_LABEL;
  try {
    // Same invite link as 复制链接 / 保存邀请图 (buildBattleSharePayload inside).
    const payload = await getInvitePayload();
    if (note) note.textContent = payload.url;

    if (nativeAppShare(payload)) {
      showToast("已打开系统分享，可选微信发给朋友", "success");
      return;
    }
    // WeChat in-app browser: no usable share sheet; point at the native ··· menu.
    const guide = await import("./wechat-guide.js");
    if (guide.isWeChatBrowser()) {
      const imageUrl = guide.isIosUa()
        ? buildInviteCanvas(payload).then(({ canvas }) => canvas.toDataURL("image/png")).catch(() => null)
        : null;
      guide.showWeChatGuide(payload, { imageUrl });
      return;
    }
    const shared = await systemShare(payload);
    if (shared === true) {
      showToast("已打开分享，发给朋友就能进房间", "success");
      return;
    }
    if (shared === "cancelled") return;

    const copied = await copyText(payload.clipboard);
    showToast(
      copied ? "链接已复制，可粘贴到微信发给好友" : "没能复制，请长按下方链接",
      copied ? "success" : "error",
    );
  } catch (err) {
    setError(err.message || "没能生成分享链接");
  } finally {
    sharePending = false;
    if (label) label.textContent = idleText;
    if (button) {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.classList.remove("is-pending");
    }
  }
}

async function respond(challengeId, accept) {
  if (respondInFlight) return;
  respondInFlight = true;
  setError("");
  if (showing) renderInvites(latestState || { inbound: [], outbound: null });
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
  } finally {
    respondInFlight = false;
    if (showing) renderInvites(latestState || { inbound: [], outbound: null });
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

function faceImage(person) {
  const img = document.createElement("img");
  img.className = "pvp-avatar";
  img.alt = "";
  img.width = 40;
  img.height = 40;
  setPvpAvatar(img, person || { avatarId: 1 }, { size: 40 });
  return img;
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
    button.className = "pvp-btn ctl ctl-secondary";
    button.dataset.ctlKind = "secondary";
    button.dataset.state = "default";
    button.innerHTML = '<span class="ctl-label">取消约战</span>';
    button.addEventListener("click", () => { cancelOutbound(state.outbound.challengeId).catch(() => {}); });
    row.append(faceImage(state.outbound), text, button);
    outbound.append(row);
  }
  for (const card of state.inbound || []) {
    if (!inbound) break;
    const row = document.createElement("div");
    row.className = "pvp-invite";
    const text = document.createElement("p");
    const who = document.createElement("strong");
    who.textContent = card.nickname || "对手";
    text.append(who, document.createTextNode(" 邀请你对战"));
    const accept = document.createElement("button");
    accept.type = "button";
    accept.className = "pvp-btn pvp-btn-primary ctl ctl-primary";
    accept.dataset.ctlKind = "primary";
    accept.dataset.state = "default";
    accept.innerHTML = '<span class="ctl-label">接受</span>';
    accept.disabled = !acceptingNew || respondInFlight;
    accept.addEventListener("click", () => { respond(card.challengeId, true).catch(() => {}); });
    const decline = document.createElement("button");
    decline.type = "button";
    decline.className = "pvp-btn ctl ctl-danger";
    decline.dataset.ctlKind = "danger";
    decline.dataset.state = "default";
    decline.innerHTML = '<span class="ctl-label">拒绝</span>';
    decline.disabled = respondInFlight;
    decline.addEventListener("click", () => { respond(card.challengeId, false).catch(() => {}); });
    row.append(faceImage(card), text, accept, decline);
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
  document.getElementById("pvpLobbyScreen")?.classList.toggle("pvp-lobby-empty", showEmpty);
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
    setPvpAvatar(img, entry, { size: 40 });
    const body = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = entry.nickname || "对手";
    const title = rankTitleWithIcon(entry.title || "", { className: "pvp-rank-title pvp-person-rank" });
    const recent = document.createElement("span");
    recent.className = "pvp-recent";
    const marks = (entry.recent || []).map(outcomeGlyph).join("");
    recent.innerHTML = marks ? `近况 ${marks}` : "暂无近况";
    body.append(name, title, recent);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pvp-btn pvp-btn-primary ctl ctl-challenge";
    button.dataset.ctlKind = "challenge";
    button.dataset.state = "default";
    if (entry.busy) {
      button.textContent = "对局中";
      button.disabled = true;
    } else if (blocked) {
      button.textContent = "约战";
      button.disabled = true;
    } else {
      button.textContent = "约战";
      button.addEventListener("click", () => { sendChallenge(entry.userId, button).catch(() => {}); });
    }
    item.append(img, body, button);
    list.append(item);
  }
}

let balanceEl = null;
/** 余额 lives inside the rank card; fillDossier() rebuilds the card, so re-dock it. */
function dockBalance(node) {
  balanceEl = balanceEl || document.getElementById("pvpLobbyBalance");
  if (!balanceEl) return;
  if (node && !node.hidden) {
    if (balanceEl.parentNode !== node) node.append(balanceEl);
  } else {
    const member = document.getElementById("pvpLobbyMember");
    if (member && balanceEl.parentNode !== member) member.append(balanceEl);
  }
}

function paintLobbyMe(state) {
  const node = document.getElementById("pvpLobbyMe");
  if (state?.me) {
    fillDossier(node, state.me);
    dockBalance(node);
    return;
  }
  const auth = getAuthState().user;
  if (!auth) {
    if (node) node.hidden = true;
    dockBalance(node);
    return;
  }
  fillDossier(node, {
    nickname: auth.nickname,
    avatarId: auth.avatarId || 1,
    avatarUrl: auth.avatarUrl || null,
    avatarFrame: auth.avatarFrame || null,
    title: "散户一段",
    inPlacement: true,
    empty: true,
  });
  dockBalance(node);
  pvpFetch("/me/pvp/stats").then(({ data }) => {
    if (!showing) return;
    fillDossier(node, {
      nickname: auth.nickname,
      avatarId: auth.avatarId || 1,
      avatarUrl: auth.avatarUrl || null,
      avatarFrame: auth.avatarFrame || null,
      title: data?.title?.name || "散户一段",
      inPlacement: data ? !!data.title?.inPlacement : true,
      rating: data?.rating,
      wins: data?.wins || 0,
      losses: data?.losses || 0,
      draws: data?.draws || 0,
      winRate: data?.winRate,
      empty: !data || data.empty,
    });
    dockBalance(node);
  }).catch(() => {});
}


function paintLobbyRules(economy) {
  const entry = Number(economy?.entryCost);
  const win = Number(economy?.winReward);
  const entryCost = Number.isFinite(entry) && entry > 0 ? entry : 20;
  const winReward = Number.isFinite(win) && win > 0 ? win : 35;
  const net = winReward - entryCost;
  const coin = (n) => `<span class="jiu-coin-amt"><span class="jiu-price-num">${n}</span>${coinIconHtml({ size: 14 })}</span>`;
  const list = document.querySelector("#pvpLobbyScreen .pvp-rules");
  if (!list) return;
  list.innerHTML = [
    `<li>双方各付 ${coin(entryCost)}。</li>`,
    `<li>胜者到账 ${coin(winReward)}（净赚 ${coin(net)}），负者净减 ${coin(entryCost)}。</li>`,
  ].join("");
}

function renderState(state) {
  latestState = state;
  paintLobbyRules(state.economy);
  const eligibility = document.getElementById("pvpLobbyEligibility");
  if (eligibility) {
    eligibility.hidden = !!state.eligibility?.ok;
    eligibility.textContent = state.eligibility?.ok ? "" : (state.eligibility?.message || "");
  }
  const shareBtn = document.getElementById("pvpShareBtn");
  const shareOk = !!state.eligibility?.ok && acceptingNew;
  if (shareBtn) {
    shareBtn.hidden = !shareOk;
    shareBtn.disabled = !shareOk || sharePending;
  }
  const shareRow = document.getElementById("pvpShareRow");
  if (shareRow) shareRow.hidden = !shareOk;
  const weChatBtn = document.getElementById("pvpShareWeChatBtn");
  if (weChatBtn) {
    // Android shell only; the web keeps 分享对战 / copy / save.
    weChatBtn.hidden = !(shareOk && canSendToWeChat());
    if (weChatBtn.getAttribute("aria-busy") !== "true") weChatBtn.disabled = !shareOk;
  }
  for (const id of ["pvpShareCopyBtn", "pvpShareImageBtn"]) {
    const mini = document.getElementById(id);
    if (mini && mini.getAttribute("aria-busy") !== "true") mini.disabled = !shareOk;
  }
  const balance = state.balance == null ? "—" : escapeHtml(state.balance);
  const balanceNode = balanceEl || document.getElementById("pvpLobbyBalance");
  if (balanceNode) {
    balanceNode.innerHTML = `余额 <span class="jiu-coin-amt"><span class="jiu-price-num">${balance}</span>${coinIconHtml({ size: 12 })}</span>`;
    balanceNode.setAttribute("aria-label", `余额 ${state.balance ?? "—"} 韭币`);
  }
  const active = document.getElementById("pvpActiveMatch");
  if (active) active.hidden = !state.activeMatchId;
  paintLobbyMe(state);
  renderInvites(state);
}

async function refresh() {
  if (!showing) return;
  const summary = await pvpFetch("/pvp/lobby/summary");
  if (!showing) return;
  if (summary.data?.disabledReason === "对战未开放") {
    leavePvpLobby();
    if (typeof window.showHome === "function") window.showHome();
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
  const loading = document.getElementById("pvpLobbyLoading");
  if (!auth.ready) {
    if (guest) guest.hidden = true;
    if (member) member.hidden = true;
    if (loading) {
      loading.hidden = false;
      ensureCastbar(loading, { indeterminate: true, labelText: "大厅加载中…" })?.setIndeterminate(true);
    }
    return;
  }
  if (loading) loading.hidden = true;
  if (!auth.user) {
    if (guest) guest.hidden = false;
    if (member) member.hidden = true;
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
    if (typeof window.showHome === "function") window.showHome();
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
  document.getElementById("pvpShareBtn")?.addEventListener("click", () => { shareBattle().catch(() => {}); });
  const shareNote = () => document.getElementById("pvpShareNote");
  const copyBtn = document.getElementById("pvpShareCopyBtn");
  copyBtn?.addEventListener("click", () => {
    withMiniBusy(copyBtn, () => copyInviteLink({ note: shareNote() })).catch(() => {});
  });
  const imageBtn = document.getElementById("pvpShareImageBtn");
  imageBtn?.addEventListener("click", () => {
    withMiniBusy(imageBtn, () => saveInviteImage({ note: shareNote() })).catch(() => {});
  });
  const weChatBtn = document.getElementById("pvpShareWeChatBtn");
  weChatBtn?.addEventListener("click", () => {
    withMiniBusy(weChatBtn, () => sendInviteToWeChat({ note: shareNote() })).catch(() => {});
  });
  mountRankHelp();
  document.addEventListener("stockgame:auth-changed", () => {
    if (showing) refresh().catch(() => {});
  });
  document.addEventListener("pvp:refresh-lobby", () => {
    if (showing) refresh().catch(() => {});
  });
}

export async function showPvpLobby({ instant = false } = {}) {
  const lobby = document.getElementById("pvpLobbyScreen");
  if (instant) lobby?.classList.add("pvp-instant");
  else lobby?.classList.remove("pvp-instant");
  prepareScreen(Route.PVP_LOBBY);
  activateScreen(Route.PVP_LOBBY);
  setRouteHash(Route.PVP_LOBBY);
  mountBattleCover(lobby?.querySelector(".pvp-sketch"));
  window.setTimeout(() => {
    loadChunk(() => import("./result.js")).then((mod) => mod.releasePvpResult()).catch(() => {});
  }, 0);
  wireLobby();
  wirePresence();
  showing = true;
  syncSessionPresence();
  setError("");
  const guest = document.getElementById("pvpLobbyGuest");
  const member = document.getElementById("pvpLobbyMember");
  const loading = document.getElementById("pvpLobbyLoading");
  if (guest) guest.hidden = true;
  if (member) member.hidden = true;
  if (loading) loading.hidden = false;
  const on = await pvpEnabled();
  if (!showing) return;
  if (!on) {
    showing = false;
    if (typeof window.showHome === "function") window.showHome();
    return;
  }
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
    if (typeof window.showHome === "function") window.showHome();
    return;
  }
  const result = await loadChunk(() => import("./result.js"));
  await result.openPvpMatch(matchId);
}
