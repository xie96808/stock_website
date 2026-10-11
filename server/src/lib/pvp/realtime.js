import { WebSocketServer } from "ws";
import { openDb } from "../../db/connection.js";
import { config } from "../config.js";
import { randomToken, sha256Hex } from "../crypto.js";
import { upgradeOriginAllowed } from "../origin.js";
import { sessionStillValidByHash, setSessionRevokeHook } from "../sessions.js";

const TICKET_TTL_MS = 30_000;
const COALESCE_DEFAULT_MS = 200;
const UPLINK_MAX_BYTES = 4 * 1024;
const SEND_QUEUE_MAX_BYTES = 256 * 1024;
const PER_USER_SOCKETS = 3;
const SWEEP_MS = 30_000;

const tickets = new Map();
const sockets = new Set();
const pending = new Map();

let coalesceMs = COALESCE_DEFAULT_MS;
let httpServer = null;
let wss = null;
let sweepTimer = null;
let upgradeHandler = null;

export function issueWsTicket({ userId, sessionToken, now = Date.now() }) {
  const ticket = randomToken(32);
  const expiresAt = now + TICKET_TTL_MS;
  tickets.set(sha256Hex(ticket), {
    userId,
    sessionHash: sha256Hex(sessionToken),
    expiresAt,
  });
  return { ticket, expiresAt, wsPath: "/api/v1/pvp/ws" };
}

function takeTicket(ticket, sessionToken, now) {
  const digest = sha256Hex(ticket || "");
  const row = tickets.get(digest);
  if (!row) return null;
  tickets.delete(digest);
  if (row.expiresAt <= now) return null;
  if (row.sessionHash !== sha256Hex(sessionToken || "")) return null;
  return row;
}

function readCookie(header, name) {
  if (!header) return "";
  for (const part of String(header).split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      return "";
    }
  }
  return "";
}

function rejectUpgrade(socket, status, reason) {
  if (!socket || socket.destroyed) return;
  const phrase = reason || "Forbidden";
  const body = `HTTP/1.1 ${status} ${phrase}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`;
  try {
    socket.end(body);
  } catch {
    socket.destroy();
  }
}

function liveSockets(userId = null) {
  let count = 0;
  for (const ws of sockets) {
    if (ws.readyState !== ws.OPEN && ws.readyState !== ws.CONNECTING) continue;
    if (userId != null && ws.pvp?.userId !== userId) continue;
    count += 1;
  }
  return count;
}

function closeMatching(userId, tokenHash) {
  for (const ws of [...sockets]) {
    if (ws.pvp?.userId !== userId) continue;
    if (tokenHash && ws.pvp.sessionHash !== tokenHash) continue;
    ws.close(4001, "session closed");
  }
}

function onRevoke({ userId, tokenHash, all }) {
  closeMatching(userId, all ? null : tokenHash);
}

export function openPvpSockets() {
  return [...sockets];
}

export function revalidateSockets(now = Date.now()) {
  for (const ws of [...sockets]) {
    if (!sessionStillValidByHash(ws.pvp?.sessionHash, now)) {
      ws.close(4001, "session closed");
    }
  }
}

function safeSend(ws, payload) {
  if (!ws || ws.readyState !== ws.OPEN) return;
  if (ws.bufferedAmount > SEND_QUEUE_MAX_BYTES) {
    ws.close(1009, "slow consumer");
    return;
  }
  ws.send(JSON.stringify(payload));
}

function userInMatch(userId, matchId) {
  const row = openDb()
    .prepare(`SELECT 1 AS hit FROM pvp_match_players WHERE match_id = ? AND user_id = ?`)
    .get(matchId, userId);
  return !!row;
}

function schedule(key, build) {
  const prev = pending.get(key);
  if (prev) clearTimeout(prev.timer);
  const timer = setTimeout(() => {
    pending.delete(key);
    deliver(build());
  }, coalesceMs);
  timer.unref?.();
  pending.set(key, { timer, build });
}

function deliver(message) {
  if (!message) return;
  if (message.broadcast) {
    for (const ws of sockets) safeSend(ws, message.payload);
    return;
  }
  const targets = new Set(message.userIds || []);
  for (const ws of sockets) {
    if (targets.has(ws.pvp?.userId)) safeSend(ws, message.payload);
  }
}

export function flushPvpPushes() {
  for (const [key, item] of [...pending.entries()]) {
    clearTimeout(item.timer);
    pending.delete(key);
    deliver(item.build());
  }
}

export function setPvpCoalesceMs(ms) {
  coalesceMs = ms;
}

export function noteMatchChanged(matchId) {
  if (!matchId) return;
  schedule(`match:${matchId}`, () => {
    const match = openDb().prepare(`SELECT revision FROM pvp_matches WHERE id = ?`).get(matchId);
    if (!match) return null;
    const players = openDb().prepare(`SELECT user_id FROM pvp_match_players WHERE match_id = ?`).all(matchId);
    return {
      userIds: players.map((player) => player.user_id),
      payload: {
        t: "match.changed",
        matchId,
        revision: match.revision,
        serverNow: Date.now(),
      },
    };
  });
}

export function noteChallengeChanged(challengeId, userIds) {
  if (!challengeId) return;
  const ids = [...userIds];
  schedule(`challenge:${challengeId}`, () => ({
    userIds: ids,
    payload: { t: "challenge.changed", challengeId, serverNow: Date.now() },
  }));
}

export function noteLobbyChanged() {
  schedule("lobby", () => ({
    broadcast: true,
    payload: { t: "lobby.changed", serverNow: Date.now() },
  }));
}

function allowedMessage(msg) {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return false;
  const keys = Object.keys(msg);
  if (msg.t === "ping") return keys.length === 1 && keys[0] === "t";
  if (msg.t === "hello" || msg.t === "sync") {
    return keys.every((key) => key === "t" || key === "matchId") && (msg.matchId == null || typeof msg.matchId === "string");
  }
  return false;
}

function onMessage(ws, data, isBinary) {
  if (isBinary) {
    ws.close(1003, "text only");
    return;
  }
  const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data || "");
  if (Buffer.byteLength(text) > UPLINK_MAX_BYTES) {
    ws.close(1009, "message too large");
    return;
  }
  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    ws.close(1007, "bad json");
    return;
  }
  if (!allowedMessage(msg)) {
    ws.close(1008, "unsupported");
    return;
  }
  if (msg.t === "ping") {
    safeSend(ws, { t: "pong", serverNow: Date.now() });
    return;
  }
  if (msg.t === "hello") safeSend(ws, { t: "hello", serverNow: Date.now() });
  if (typeof msg.matchId === "string" && msg.matchId && userInMatch(ws.pvp.userId, msg.matchId)) {
    noteMatchChanged(msg.matchId);
  }
}

function acceptUpgrade(req, socket, head) {
  let url;
  try {
    url = new URL(req.url || "/", "http://127.0.0.1");
  } catch {
    rejectUpgrade(socket, 400, "Bad Request");
    return;
  }
  if (url.pathname !== "/api/v1/pvp/ws") {
    rejectUpgrade(socket, 404, "Not Found");
    return;
  }
  if (!upgradeOriginAllowed({ origin: req.headers.origin, allowlist: config.originAllowlist })) {
    rejectUpgrade(socket, 403, "Forbidden");
    return;
  }
  const sessionToken = readCookie(req.headers.cookie, config.cookieName);
  const sessionHash = sha256Hex(sessionToken || "");
  const session = sessionStillValidByHash(sessionHash);
  if (!session) {
    rejectUpgrade(socket, 401, "Unauthorized");
    return;
  }
  if (liveSockets(session.id) >= PER_USER_SOCKETS || liveSockets() >= config.pvpMaxWs) {
    rejectUpgrade(socket, 429, "Too Many Requests");
    return;
  }
  const ticket = takeTicket(url.searchParams.get("ticket"), sessionToken, Date.now());
  if (!ticket || ticket.userId !== session.id || ticket.sessionHash !== sessionHash) {
    rejectUpgrade(socket, 401, "Unauthorized");
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.pvp = { userId: session.id, sessionHash };
    sockets.add(ws);
    ws.on("close", () => sockets.delete(ws));
    ws.on("error", () => {});
    ws.on("message", (data, isBinary) => onMessage(ws, data, isBinary));
  });
}

export function attachPvpRealtime(server) {
  if (httpServer) detachPvpRealtime();
  httpServer = server;
  wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: UPLINK_MAX_BYTES,
  });
  upgradeHandler = (req, socket, head) => {
    try {
      acceptUpgrade(req, socket, head);
    } catch (err) {
      console.error("pvp upgrade failed:", err && err.message ? err.message : err);
      rejectUpgrade(socket, 500, "Internal Server Error");
    }
  };
  server.on("upgrade", upgradeHandler);
  setSessionRevokeHook(onRevoke);
  sweepTimer = setInterval(() => revalidateSockets(), SWEEP_MS);
  sweepTimer.unref();
}

export function detachPvpRealtime() {
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
  setSessionRevokeHook(null);
  for (const item of pending.values()) clearTimeout(item.timer);
  pending.clear();
  tickets.clear();
  if (httpServer && upgradeHandler) httpServer.removeListener("upgrade", upgradeHandler);
  for (const ws of [...sockets]) {
    try {
      ws.close(1001, "going away");
    } catch {
      /* already closed */
    }
  }
  sockets.clear();
  if (wss) wss.close();
  wss = null;
  httpServer = null;
  upgradeHandler = null;
  coalesceMs = COALESCE_DEFAULT_MS;
}
