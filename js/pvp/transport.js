import { getAuthState } from "../auth.js";

export function whenAuthReady() {
  const auth = getAuthState();
  if (auth.ready) return Promise.resolve(auth);
  return new Promise((resolve) => {
    const onChange = () => {
      const next = getAuthState();
      if (!next.ready) return;
      document.removeEventListener("stockgame:auth-changed", onChange);
      resolve(next);
    };
    document.addEventListener("stockgame:auth-changed", onChange);
  });
}

let enabledKnown = null;
let enabledAt = 0;

export async function pvpEnabled() {
  if (enabledKnown === true && Date.now() - enabledAt < 30_000) return true;
  try {
    const res = await fetch("/api/v1/config", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const json = await res.json().catch(() => ({}));
    enabledKnown = !!(json?.data?.features?.pvpBattle);
    enabledAt = Date.now();
    return enabledKnown;
  } catch {
    return false;
  }
}

export async function pvpFetch(path, { method = "GET", body, idempotencyKey } = {}) {
  const auth = getAuthState();
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth.csrfToken) headers["X-CSRF-Token"] = auth.csrfToken;
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: "same-origin",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return { ok: true, status: 204, data: null };
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.error?.message || `HTTP ${res.status}`);
    err.code = json?.error?.code;
    err.status = res.status;
    throw err;
  }
  return { ok: true, status: res.status, data: json.data };
}

export function startPoll(fn, baseMs) {
  let timer = 0;
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try { await fn(); } catch { /* caller renders the last good snapshot */ }
    if (stopped) return;
    const wait = baseMs * (0.8 + Math.random() * 0.4);
    timer = window.setTimeout(tick, wait);
  };
  timer = window.setTimeout(tick, baseMs);
  return () => {
    stopped = true;
    window.clearTimeout(timer);
  };
}

const listeners = new Set();
let socketStop = null;
let releaseTimer = 0;
let socketHealthy = false;

export function pvpSocketHealthy() {
  return socketHealthy;
}

function startSocket() {
  let ws = null;
  let stopped = false;
  let retry = 1000;
  let ping = 0;
  let reconnectTimer = 0;
  const connect = async () => {
    if (stopped) return;
    try {
      await whenAuthReady();
      if (stopped) return;
      const auth = getAuthState();
      if (!auth.user || !auth.csrfToken) {
        schedule();
        return;
      }
      const { data } = await pvpFetch("/pvp/ws-ticket", { method: "POST", body: {} });
      if (stopped) return;
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const next = new WebSocket(`${proto}//${location.host}${data.wsPath}?ticket=${encodeURIComponent(data.ticket)}`);
      if (stopped) {
        try { next.close(); } catch { /* ignore */ }
        return;
      }
      ws = next;
      ws.onopen = () => {
        retry = 1000;
        socketHealthy = true;
        ws.send(JSON.stringify({ t: "hello" }));
      };
      ws.onmessage = (ev) => {
        let msg = null;
        try { msg = JSON.parse(ev.data); } catch { msg = null; }
        if (!msg) return;
        for (const fn of listeners) fn(msg);
      };
      ws.onclose = (ev) => {
        socketHealthy = false;
        // 4001 session closed / 1008 unsupported — do not loop forever
        if (ev && (ev.code === 4001 || ev.code === 1008)) {
          stopped = true;
          return;
        }
        schedule();
      };
      ws.onerror = () => {};
    } catch {
      socketHealthy = false;
      schedule();
    }
  };
  const schedule = () => {
    if (stopped) return;
    window.clearTimeout(reconnectTimer);
    const wait = retry * (0.8 + Math.random() * 0.4);
    retry = Math.min(15_000, retry * 2);
    reconnectTimer = window.setTimeout(connect, wait);
  };
  connect();
  ping = window.setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "ping" }));
  }, 25_000);
  return () => {
    stopped = true;
    socketHealthy = false;
    window.clearInterval(ping);
    window.clearTimeout(reconnectTimer);
    try { ws && ws.close(); } catch { /* already closed */ }
  };
}

export function holdPvpSocket(onEvent) {
  listeners.add(onEvent);
  window.clearTimeout(releaseTimer);
  if (!socketStop) socketStop = startSocket();
  return () => {
    listeners.delete(onEvent);
    window.clearTimeout(releaseTimer);
    releaseTimer = window.setTimeout(() => {
      if (!listeners.size && socketStop) {
        socketStop();
        socketStop = null;
      }
    }, 400);
  };
}

export function actionKey(matchId, round) {
  const id = `${matchId}:${round}`;
  const store = actionKey.map || (actionKey.map = new Map());
  if (!store.has(id)) store.set(id, `pvp-${crypto.randomUUID()}`);
  return store.get(id);
}

export function clearActionKeys() {
  actionKey.map?.clear();
}
