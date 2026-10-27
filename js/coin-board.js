/**
 * 韭币榜 sheet: opened by tapping the 韭币余额 chip. Two tabs (余额榜 / 本周净赚榜), top 20 + your own standing.
 * The server flag `coinBoard` gates the whole thing; with it off the chip stays a plain label.
 */
import { api, getAuthState, displayAvatarUrl, selectIsAuthenticated } from './auth.js';
import { openCtlSheet, closeCtlSheet } from './controls.js';
import { wrapAvatarHtml } from './avatar-frame-pure.js';
import { titleChipHtml } from './title-pure.js';
import { BOARD_TABS, boardNote, formatBoardValue, meLine } from './coin-board-pure.js';

let overlay = null;
let board = 'balance';
let seq = 0;
let flag = null;

export function primeCoinBoardFlag(features) {
  if (features && typeof features === 'object') flag = !!features.coinBoard;
}

export async function coinBoardEnabled() {
  if (flag != null) return flag;
  try {
    const r = await fetch('/api/v1/config', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    const j = await r.json().catch(() => ({}));
    flag = !!j?.data?.features?.coinBoard;
  } catch {
    flag = false;
  }
  return flag;
}

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function ensureOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'coinBoardModal';
  overlay.className = 'ctl-overlay ctl-sheet';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="ctl-panel ctl-sheet-panel ctl-paper coin-board-panel" role="dialog" aria-modal="true" aria-labelledby="coinBoardTitle">
      <div class="coin-board-head">
        <h2 id="coinBoardTitle">韭币榜</h2>
        <button type="button" class="coin-board-close" data-ctl-focus aria-label="关闭">×</button>
      </div>
      <div class="coin-board-tabs" role="tablist" aria-label="榜单"></div>
      <p class="coin-board-note" id="coinBoardNote"></p>
      <ol class="coin-board-list" id="coinBoardList" aria-live="polite"></ol>
      <div class="coin-board-me" id="coinBoardMe" hidden></div>
    </div>`;
  document.body.appendChild(overlay);
  const tabs = overlay.querySelector('.coin-board-tabs');
  for (const t of BOARD_TABS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'coin-board-tab';
    b.setAttribute('role', 'tab');
    b.dataset.board = t.id;
    b.textContent = t.label;
    tabs.appendChild(b);
  }
  tabs.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('.coin-board-tab');
    if (b && b.dataset.board !== board) load(b.dataset.board);
  });
  overlay.querySelector('.coin-board-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay && !overlay.hidden) close();
  });
  return overlay;
}

function close() {
  if (overlay) closeCtlSheet(overlay);
}

function paintTabs() {
  overlay.querySelectorAll('.coin-board-tab').forEach((b) => b.setAttribute('aria-selected', b.dataset.board === board ? 'true' : 'false'));
  overlay.querySelector('#coinBoardNote').textContent = boardNote(board);
}

function rowHtml(e) {
  const img = `<img class="coin-board-av" src="${esc(displayAvatarUrl(e))}" alt="" loading="lazy" decoding="async" width="40" height="40">`;
  const cls = board === 'week' ? ' is-gain' : '';
  return `<li class="coin-board-row">
    <span class="coin-board-rank">${e.rank}</span>
    <span class="coin-board-av-wrap">${wrapAvatarHtml(img, e.avatarFrame, e.avatarMedal)}</span>
    <span class="coin-board-name">${esc(e.nickname)}${titleChipHtml(e.shopTitle)}</span>
    <span class="coin-board-val${cls}">${esc(formatBoardValue(board, e.value))}</span>
  </li>`;
}

async function load(which) {
  board = which;
  const mine = ++seq;
  paintTabs();
  const list = overlay.querySelector('#coinBoardList');
  const me = overlay.querySelector('#coinBoardMe');
  list.innerHTML = '<li class="coin-board-empty">加载中…</li>';
  me.hidden = true;
  try {
    const { data } = await api(`/leaderboard/coins?board=${encodeURIComponent(which)}`);
    if (mine !== seq) return; // a newer tab click won
    const entries = (data && data.entries) || [];
    list.innerHTML = entries.length
      ? entries.map(rowHtml).join('')
      : `<li class="coin-board-empty">${which === 'week' ? '本周还没有人净赚，抢个头名吧' : '暂无数据'}</li>`;
    const line = meLine(which, data && data.me);
    me.hidden = !line;
    me.textContent = line || '';
  } catch (err) {
    if (mine !== seq) return;
    list.innerHTML = `<li class="coin-board-error">${esc(err && err.message ? err.message : '榜单暂时不可用')}</li>`;
  }
}

export async function showCoinBoard(which = 'balance') {
  if (!(await coinBoardEnabled())) return false;
  ensureOverlay();
  openCtlSheet(overlay, { focusSelector: '[data-ctl-focus]' });
  await load(which === 'week' ? 'week' : 'balance');
  return true;
}

/** Make the top balance chip a button (idempotent). Called when the chrome is built and again when the flag arrives. */
export async function wireCoinBoardEntry() {
  const chip = document.querySelector('#jiuCoinChrome .jiu-coin-balance');
  if (!chip || chip.dataset.board === '1') return;
  if (!(await coinBoardEnabled())) return;
  chip.dataset.board = '1';
  chip.classList.add('is-board-link');
  chip.setAttribute('role', 'button');
  chip.tabIndex = 0;
  chip.title = '韭币榜';
  chip.setAttribute('aria-label', '韭币余额，点开韭币榜');
  const open = (e) => {
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    if (selectIsAuthenticated(getAuthState())) showCoinBoard();
  };
  chip.addEventListener('click', open);
  chip.addEventListener('keydown', open);
}
