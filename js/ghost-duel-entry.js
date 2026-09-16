/**
 * Phase C 幽灵对局 — day-board entry + multi-ghost picker (paper list).
 */
import { getAuthState, openAuthModal, showToast } from './auth.js';
import { amountWithCoinHtml } from './jiu-coin.js';
import {
  ghostAvatarSrc,
  GHOST_LABEL,
} from '../shared/ghost.js';

/** @type {boolean} */
let ghostDuelEnabled = false;
/** @type {object|null} */
let previewCache = null;
/** @type {boolean} */
let startLocked = false;
/** @type {string|null} */
let selectedGhostGameId = null;

/** @type {(opts?: {ghostGameId?: string, random?: boolean}) => Promise<void>} */
let startClickHandler = async () => {};

export function isGhostDuelEnabled() {
  return ghostDuelEnabled;
}

export function setGhostDuelEnabled(v) {
  ghostDuelEnabled = !!v;
}

export function getGhostPreviewCache() {
  return previewCache;
}

export function setGhostPreviewCache(v) {
  previewCache = v;
}

export function isGhostStartLocked() {
  return startLocked;
}

export function setGhostStartLocked(v) {
  startLocked = !!v;
}

export function registerGhostStartHandler(fn) {
  startClickHandler = fn;
}

export async function refreshGhostDuelFlag() {
  try {
    const res = await fetch('/api/v1/config', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    const json = await res.json().catch(() => ({}));
    ghostDuelEnabled = !!(json?.data?.features?.ghostDuel);
  } catch {
    ghostDuelEnabled = false;
  }
  return ghostDuelEnabled;
}

export async function ghostApi(path, { method = 'GET', body, headers = {} } = {}) {
  const auth = getAuthState();
  const h = { Accept: 'application/json', ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (auth.csrfToken) h['X-CSRF-Token'] = auth.csrfToken;
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: 'same-origin',
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.error?.message || `HTTP ${res.status}`);
    err.code = json?.error?.code;
    err.status = res.status;
    err.payload = json;
    err.details = json?.error?.details;
    throw err;
  }
  return { ok: true, status: res.status, data: json.data };
}

export async function fetchGhostPreview() {
  if (!ghostDuelEnabled) {
    previewCache = null;
    return null;
  }
  try {
    const { data } = await ghostApi('/daily-challenge/ghost');
    previewCache = data;
    return data;
  } catch (e) {
    if (e.code === 'FEATURE_DISABLED' || e.status === 403) {
      ghostDuelEnabled = false;
    }
    previewCache = null;
    return null;
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

function previewGhostList(preview) {
  if (!preview) return [];
  if (Array.isArray(preview.ghosts) && preview.ghosts.length) return preview.ghosts;
  if (preview.ghost) return [preview.ghost];
  return [];
}

function formatGhostReturn(g) {
  if (g?.returnPct != null) {
    return `${Number(g.returnPct) >= 0 ? '+' : ''}${g.returnPct}%`;
  }
  return '—';
}

function renderGhostPickRow(g, index, selectedId) {
  const src = ghostAvatarSrc(g);
  const preset = `images/avatars/${String(g.avatarId || 1).padStart(2, '0')}.png`;
  const ret = formatGhostReturn(g);
  const gid = g.gameId || '';
  const selected = selectedId && gid === selectedId;
  const rank = index + 1;
  return `<button type="button" class="ghost-duel-pick${selected ? ' is-selected' : ''}"
      data-ghost-game-id="${escapeAttr(gid)}"
      aria-pressed="${selected ? 'true' : 'false'}">
    <span class="ghost-duel-pick__rank">#${rank}</span>
    <img class="ghost-duel-pick__avatar" src="${escapeAttr(src)}" alt="" width="32" height="32"
      loading="lazy" decoding="async"
      onerror="this.onerror=null;this.src='${escapeAttr(preset)}'">
    <span class="ghost-duel-pick__meta">
      <strong class="ghost-duel-pick__name">${escapeHtml(g.nickname || '幽灵选手')}</strong>
      <span class="ghost-duel-pick__ret">收益 ${escapeHtml(ret)}</span>
    </span>
  </button>`;
}

/**
 * Render entry strip into daily board modal body (call after board table HTML).
 * Persistent CTA when ghost available; clear empty state when not.
 * Multiple ghosts → paper list picker + 随机挑战.
 */
export function renderGhostDuelEntryHtml(preview) {
  if (!ghostDuelEnabled) return '';
  const list = previewGhostList(preview);
  if (!preview || !preview.available || !list.length) {
    const msg = preview?.message || '昨日暂无幽灵可挑战';
    return `<div class="ghost-duel-entry ghost-duel-entry--empty" id="ghostDuelEntry">
      <span class="ghost-duel-entry__label">${escapeHtml(GHOST_LABEL)}</span>
      <p class="ghost-duel-entry__empty">${escapeHtml(msg)}</p>
    </div>`;
  }

  const cost = Number(preview.cost) || 20;
  const featured = list[0];
  selectedGhostGameId = featured.gameId || null;

  if (list.length === 1) {
    const g = featured;
    const src = ghostAvatarSrc(g);
    const preset = `images/avatars/${String(g.avatarId || 1).padStart(2, '0')}.png`;
    const ret = formatGhostReturn(g);
    return `<div class="ghost-duel-entry" id="ghostDuelEntry" data-ghost-count="1">
    <div class="ghost-duel-entry__who">
      <img class="ghost-duel-entry__avatar" src="${escapeAttr(src)}" alt="" width="36" height="36"
        loading="lazy" decoding="async"
        onerror="this.onerror=null;this.src='${escapeAttr(preset)}'">
      <div class="ghost-duel-entry__meta">
        <span class="ghost-duel-entry__ribbon">${escapeHtml(GHOST_LABEL)}</span>
        <strong class="ghost-duel-entry__name">${escapeHtml(g.nickname || '幽灵选手')}</strong>
        <span class="ghost-duel-entry__sub">昨日同题 · 收益 ${escapeHtml(ret)} · ${escapeHtml(preview.sourceDate || '')}</span>
      </div>
    </div>
    <button type="button" class="ghost-duel-entry__cta" id="ghostDuelStartBtn"
      data-ghost-game-id="${escapeAttr(g.gameId || '')}">
      挑战幽灵<span class="jiu-price-badge jiu-price-paid" data-jiu-price="${cost}">${amountWithCoinHtml(cost, { size: 12 })}</span>
    </button>
  </div>`;
  }

  const rows = list.map((g, i) => renderGhostPickRow(g, i, selectedGhostGameId)).join('');
  return `<div class="ghost-duel-entry ghost-duel-entry--multi" id="ghostDuelEntry" data-ghost-count="${list.length}">
    <div class="ghost-duel-entry__head">
      <span class="ghost-duel-entry__ribbon">${escapeHtml(GHOST_LABEL)}</span>
      <span class="ghost-duel-entry__sub">昨日同题可回放 · ${list.length} 位 · ${escapeHtml(preview.sourceDate || '')}</span>
    </div>
    <div class="ghost-duel-pick-list" id="ghostDuelPickList" role="listbox" aria-label="选择幽灵对手">
      ${rows}
    </div>
    <div class="ghost-duel-entry__actions">
      <button type="button" class="ghost-duel-entry__cta ghost-duel-entry__cta--secondary" id="ghostDuelRandomBtn">
        随机挑战
      </button>
      <button type="button" class="ghost-duel-entry__cta" id="ghostDuelStartBtn">
        挑战所选<span class="jiu-price-badge jiu-price-paid" data-jiu-price="${cost}">${amountWithCoinHtml(cost, { size: 12 })}</span>
      </button>
    </div>
  </div>`;
}

export function wireGhostDuelEntry(root = document) {
  const entry =
    root.querySelector?.('#ghostDuelEntry') || document.getElementById('ghostDuelEntry');
  if (!entry || entry.dataset.wired === '1') return;
  entry.dataset.wired = '1';

  const listEl = entry.querySelector('#ghostDuelPickList');
  if (listEl) {
    listEl.addEventListener('click', (e) => {
      const btn = e.target.closest?.('.ghost-duel-pick');
      if (!btn || !listEl.contains(btn)) return;
      e.preventDefault();
      e.stopPropagation();
      const gid = btn.getAttribute('data-ghost-game-id') || null;
      selectedGhostGameId = gid;
      listEl.querySelectorAll('.ghost-duel-pick').forEach((el) => {
        const on = el === btn;
        el.classList.toggle('is-selected', on);
        el.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    });
  }

  const startBtn =
    entry.querySelector('#ghostDuelStartBtn') || document.getElementById('ghostDuelStartBtn');
  if (startBtn) {
    startBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const fromBtn = startBtn.getAttribute('data-ghost-game-id');
      const gid = selectedGhostGameId || fromBtn || null;
      void startClickHandler({ ghostGameId: gid || undefined });
    });
  }

  const randomBtn = entry.querySelector('#ghostDuelRandomBtn');
  if (randomBtn) {
    randomBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const list = previewGhostList(previewCache);
      if (!list.length) {
        showToast('暂无幽灵可挑战', 'error');
        return;
      }
      const pick = list[Math.floor(Math.random() * list.length)];
      selectedGhostGameId = pick.gameId || null;
      if (listEl && selectedGhostGameId) {
        listEl.querySelectorAll('.ghost-duel-pick').forEach((el) => {
          const on = el.getAttribute('data-ghost-game-id') === selectedGhostGameId;
          el.classList.toggle('is-selected', on);
          el.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
      }
      void startClickHandler({ ghostGameId: selectedGhostGameId || undefined, random: true });
    });
  }
}

export { openAuthModal, showToast, previewGhostList };
