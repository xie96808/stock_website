/**
 * Track R3 — shared 后悔券 count for the rewind button, confirm sheet, account panel and wheel.
 * One GET /me/items cache; any change (wheel prize, rewind, login) dispatches `stockgame:items-changed`.
 * Older APIs without /me/items ⇒ tickets 0 ⇒ every surface behaves exactly as before Track R.
 */
import { api, getAuthState } from "./auth.js";
import { normalizeItems, inventoryLine } from "./rewind-tickets-pure.js";

const st = { tickets: 0, board: "clean", known: false, at: 0, inflight: null, userId: null };

export function getRewindTickets() {
  return { tickets: st.tickets, board: st.board, known: st.known };
}

/** Account panel (auth settings sheet): 「道具：后悔券 ×N」, hidden until the API reports inventory. */
function paintAccountLine() {
  const el = document.getElementById("authItemsLine");
  if (!el) return;
  el.hidden = !st.known;
  el.textContent = st.known ? `道具：${inventoryLine(st.tickets)}` : "";
}

function emit() {
  paintAccountLine();
  document.dispatchEvent(new CustomEvent("stockgame:items-changed", { detail: getRewindTickets() }));
}

export function setRewindTickets(n) {
  const v = Number.isInteger(Number(n)) && Number(n) > 0 ? Number(n) : 0;
  if (v === st.tickets && st.known) return;
  st.tickets = v;
  st.known = true;
  st.at = Date.now();
  emit();
}

/** Refresh from the server (deduped; `maxAgeMs` lets callers reuse a fresh value). */
export async function refreshRewindTickets({ maxAgeMs = 0 } = {}) {
  const auth = getAuthState();
  const uid = auth?.user?.id ?? null;
  if (!uid) {
    if (st.known || st.tickets) {
      Object.assign(st, { tickets: 0, known: false, userId: null, at: 0 });
      emit();
    }
    return getRewindTickets();
  }
  if (uid === st.userId && st.known && Date.now() - st.at < maxAgeMs) return getRewindTickets();
  if (st.inflight) return st.inflight;
  st.inflight = (async () => {
    try {
      const { data } = await api("/me/items");
      const n = normalizeItems(data);
      const changed = n.tickets !== st.tickets || n.board !== st.board || !st.known || st.userId !== uid;
      Object.assign(st, n, { at: Date.now(), userId: uid });
      if (changed) emit();
    } catch {
      // 404 on an older API / offline: keep whatever we had (0 by default ⇒ legacy UI)
    } finally {
      st.inflight = null;
    }
    return getRewindTickets();
  })();
  return st.inflight;
}

if (typeof document !== "undefined") document.addEventListener("stockgame:auth-changed", () => {
  st.known = false;
  st.at = 0;
  void refreshRewindTickets();
});

if (typeof document !== "undefined") {
  // Opening the account sheet refreshes the count (cheap, deduped); painting happens on emit.
  document.addEventListener("click", (e) => {
    if (e.target?.closest?.("#authUserBtn")) {
      paintAccountLine();
      void refreshRewindTickets({ maxAgeMs: 10000 });
    }
  });
}
