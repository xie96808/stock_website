/** Stage 3: cloud game create / finish with light retry */
import { api, getAuthState } from "./auth.js";
import { gameState } from "./state.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function newIdempotencyKey() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `k-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function apiWithHeaders(path, { method = "GET", body, headers = {} } = {}) {
  const auth = getAuthState();
  const h = { Accept: "application/json", ...headers };
  if (body !== undefined) h["Content-Type"] = "application/json";
  if (auth.csrfToken) h["X-CSRF-Token"] = auth.csrfToken;
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: "same-origin",
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return { ok: true, status: 204, data: null };
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.error?.message || `HTTP ${res.status}`);
    err.code = json?.error?.code;
    err.status = res.status;
    err.payload = json;
    throw err;
  }
  return { ok: true, status: res.status, data: json.data, requestId: json.requestId };
}

/** Create a cloud game for the logged-in user. */
export async function createCloudGame(fillMode) {
  const auth = getAuthState();
  if (!auth.user) throw new Error("未登录，无法创建云端对局");
  const key = newIdempotencyKey();
  const { data, status } = await apiWithHeaders("/games", {
    method: "POST",
    body: { fillMode },
    headers: { "Idempotency-Key": key },
  });
  if (!data?.gameId) throw new Error("开局响应无效");
  return { ...data, httpStatus: status, createKey: key };
}

function actionsPayload(actions) {
  return actions.map((action, i) => ({ day: i + 1, action }));
}

export function updateSaveStatusUi() {
  const el = document.getElementById("cloudSaveStatus");
  if (!el) return;
  if (!gameState.cloudMode) {
    if (gameState.practiceOnly) {
      el.hidden = false;
      el.className = "cloud-save-status status-idle";
      el.textContent = "本地练习（本局不保存到云端）";
      return;
    }
    el.hidden = true;
    el.textContent = "";
    return;
  }
  const map = {
    saving: "云端战绩保存中…",
    saved: "云端战绩已保存",
    retry: "保存失败，正在重试…",
    fail: `云端保存失败${gameState.saveError ? "：" + gameState.saveError : ""}`,
  };
  el.hidden = false;
  el.className = "cloud-save-status status-" + (gameState.saveStatus || "idle");
  el.textContent = map[gameState.saveStatus] || "云端对局进行中";
}

/** Finish cloud game with retries on network / 5xx. */
export async function finishCloudGame() {
  if (!gameState.cloudMode || !gameState.cloudGameId) {
    gameState.saveStatus = null;
    updateSaveStatusUi();
    return null;
  }
  const gameId = gameState.cloudGameId;
  const body = { actions: actionsPayload(gameState.actions), finish: true };
  const delays = [1000, 3000, 10000];
  gameState.saveStatus = "saving";
  gameState.saveError = null;
  updateSaveStatusUi();

  let lastErr = null;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const { data, status } = await api(`/games/${gameId}/finish`, {
        method: "POST",
        body,
      });
      gameState.saveStatus = "saved";
      gameState.saveError = null;
      if (data?.returnPpm != null) {
        gameState.returnPpm = data.returnPpm;
        gameState.returnPct = data.returnPct;
      }
      updateSaveStatusUi();
      return { data, status };
    } catch (e) {
      lastErr = e;
      const retryable = !e.status || e.status >= 500 || e.status === 429;
      if (!retryable || attempt === delays.length) {
        gameState.saveStatus = "fail";
        gameState.saveError = e.message || "保存失败";
        updateSaveStatusUi();
        return null;
      }
      gameState.saveStatus = "retry";
      gameState.saveError = e.message || "网络异常，重试中…";
      updateSaveStatusUi();
      await sleep(e.status === 429 ? delays[attempt] * 2 : delays[attempt]);
    }
  }
  gameState.saveStatus = "fail";
  gameState.saveError = lastErr?.message || "保存失败";
  updateSaveStatusUi();
  return null;
}

export async function fetchMyGames(params = {}) {
  const q = new URLSearchParams();
  if (params.fillMode) q.set("fillMode", params.fillMode);
  if (params.limit) q.set("limit", String(params.limit));
  if (params.cursor) q.set("cursor", params.cursor);
  const qs = q.toString();
  const { data } = await api(`/me/games${qs ? `?${qs}` : ""}`);
  return data;
}

export async function fetchMyStats(params = {}) {
  const q = new URLSearchParams();
  if (params.fillMode) q.set("fillMode", params.fillMode);
  const qs = q.toString();
  const { data } = await api(`/me/stats${qs ? `?${qs}` : ""}`);
  return data;
}

export async function abandonActiveCloudGame() {
  const auth = getAuthState();
  if (!auth.user) return null;
  const { data } = await api("/games/active");
  if (!data?.gameId) return null;
  await api(`/games/${data.gameId}/abandon`, { method: "POST" });
  return data.gameId;
}
