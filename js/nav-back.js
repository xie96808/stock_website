/**
 * Unified back navigation (one component, one rule).
 *
 * Every sub page gets a `.sg-backbar` at the top-left of its content with up to two exits:
 *   1. 「← 返回<上一级>」 — one level up, the label names the destination;
 *   2. 「返回主页」        — straight home (omitted when the parent already is home).
 * The page in progress (对局) gets a single 「← 退出对局」 that opens a sheet offering the same
 * two exits plus 「继续对局」.
 *
 * Origin-aware: 排行榜 / 我的战绩 return to wherever they were opened from (home, the 玩法选择
 * sheet, or the 结算 page) instead of always dumping the user on the home page.
 *
 * The parent button keeps the legacy element ids (leaderboardBackBtn …) and its text starts with
 * 「返回」, so js/back-handler.js (Android / browser back key) presses it first.
 */

import { getSession } from './game-session.js';

export const HOME = Object.freeze({ id: 'home', label: '首页' });
export const SHEET = Object.freeze({ id: 'sheet', label: '玩法选择' });

/** Pure: which exits does a page offer? ctx = { origin?, gameKind? } */
export function backSpecFor(key, ctx = {}) {
    switch (key) {
        case 'academy':
        case 'hindsight':
        case 'pvp-lobby':
            return { parent: HOME, home: false };
        case 'academy-zone':
            return { parent: { id: 'academy', label: '修炼基地' }, home: true };
        case 'leaderboard':
        case 'my-games': {
            const o = ctx.origin;
            const parent = o === 'sheet' ? SHEET : o === 'result' ? { id: 'result', label: '结算页' } : HOME;
            return { parent, home: parent.id !== 'home' };
        }
        case 'puzzle-chapters':
            return { parent: SHEET, home: true };
        case 'puzzle-levels':
            return { parent: { id: 'chapters', label: '章节' }, home: true };
        case 'pvp-result':
        case 'pvp-history':
            return { parent: { id: 'pvp-lobby', label: '对战大厅' }, home: true };
        case 'result':
        case 'game': {
            const parent = ctx.gameKind === 'puzzle' ? { id: 'puzzle-levels', label: '残局列表' } : SHEET;
            return { parent, home: true };
        }
        default:
            return { parent: HOME, home: false };
    }
}

/** Legacy ids kept on the parent button so existing wiring / tests keep working. */
const PARENT_ID = {
    leaderboard: 'leaderboardBackBtn',
    'my-games': 'myGamesBackBtn',
    'puzzle-levels': 'puzzleScreenBackBtn',
    'pvp-lobby': 'pvpLobbyBack',
    'pvp-result': 'pvpResultBack',
    'pvp-history': 'pvpHistoryBack',
    result: 'resultBackBtn',
};
/** Pages whose parent button is wired by its own module (do not attach a handler here). */
const OWN_HANDLER = new Set(['pvp-lobby']);

const origins = { leaderboard: 'home', 'my-games': 'home' };

/** Where is the user right now? Call BEFORE the destination screen hides anything. */
export function detectOrigin(doc = typeof document !== 'undefined' ? document : null) {
    if (!doc) return 'home';
    const result = doc.getElementById('resultScreen');
    if (result && result.classList.contains('active')) return 'result';
    if (doc.documentElement.classList.contains('pm-sheet-open')) return 'sheet';
    return 'home';
}

/** Remember where a leaderboard / my-games visit came from, then refresh its bar. */
export function captureOrigin(key, { force = false } = {}) {
    const screenId = key === 'leaderboard' ? 'leaderboardScreen' : 'myGamesScreen';
    const el = typeof document !== 'undefined' ? document.getElementById(screenId) : null;
    const alreadyOpen = !!(el && el.classList.contains('active'));
    if (!alreadyOpen || force) origins[key] = detectOrigin();
    refreshBackBar(key);
}

function currentGameKind() {
    try {
        return getSession()?.gameKind;
    } catch {
        return undefined;
    }
}

function ctxFor(key) {
    return { origin: origins[key], gameKind: currentGameKind() };
}

// ---------------------------------------------------------------- navigation

async function afterHome(targetId, key) {
    const w = window;
    switch (targetId) {
        case 'sheet':
            if (typeof w.showPlayModes === 'function') w.showPlayModes();
            return;
        case 'puzzle-levels':
            if (typeof w.showPuzzleScreen === 'function') setTimeout(() => w.showPuzzleScreen(), 0);
            return;
        default:
            void key;
    }
}

/** Leave `key` for home (cleans up charts / loops through the page's own hide function). */
async function leaveToHome(key) {
    const w = window;
    switch (key) {
        case 'academy':
        case 'academy-zone':
            return w.hideAcademy();
        case 'hindsight':
            return w.hideHindsight();
        case 'leaderboard':
            return w.hideLeaderboard();
        case 'my-games':
            return w.hideMyGames();
        case 'puzzle-levels':
            w.hidePuzzleScreen();
            return w.showHome();
        case 'pvp-result':
        case 'pvp-history': {
            try { (await import('./pvp/room.js')).leavePvpRoom({ deferChart: true }); } catch { /* ignore */ }
            try { (await import('./pvp/lobby.js')).leavePvpLobby(); } catch { /* ignore */ }
            return w.showHome();
        }
        case 'game':
            if (typeof w.leaveGameScreen === 'function') w.leaveGameScreen();
            return w.showHome();
        case 'result':
            return w.resetGame();
        default:
            return w.showHome();
    }
}

async function reshowResult() {
    const { Route, prepareScreen, activateScreen } = await import('./screen-router.js');
    prepareScreen(Route.RESULT);
    activateScreen(Route.RESULT);
    try { window.scrollTo(0, 0); } catch { /* ignore */ }
    setTimeout(() => { try { window.dispatchEvent(new Event('resize')); } catch { /* ignore */ } }, 50);
}

/** Go to `targetId` ('home' or the page's parent) from page `key`. */
export async function goTo(key, targetId) {
    const w = window;
    if (targetId === 'home') return leaveToHome(key);
    switch (targetId) {
        case 'academy':
            return w.backToAcademyLanding();
        case 'chapters':
            return w.hidePuzzleScreen();
        case 'pvp-lobby':
            return w.showPvpLobby({ instant: true });
        case 'result': {
            // leave the current page (home first so its charts / loops are disposed), then restore 结算
            await leaveToHome(key);
            return reshowResult();
        }
        case 'sheet':
        case 'puzzle-levels':
            await leaveToHome(key);
            return afterHome(targetId, key);
        default:
            return leaveToHome(key);
    }
}

// ---------------------------------------------------------------- rendering

function mk(tag, cls, text, attrs = {}) {
    const el = document.createElement(tag);
    el.className = cls;
    if (text) el.textContent = text;
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
}

function renderBar(bar) {
    const key = bar.dataset.sgBack;
    if (!key) return;
    if (key === 'game') {
        const btn = mk('button', 'sg-back', '← 退出对局', { type: 'button', id: 'gameExitBtn' });
        btn.addEventListener('click', () => openGameExitSheet());
        bar.replaceChildren(btn);
        return;
    }
    const spec = backSpecFor(key, ctxFor(key));
    const parent = mk('button', 'sg-back sg-back--parent', `← 返回${spec.parent.label}`, { type: 'button' });
    if (PARENT_ID[key]) parent.id = PARENT_ID[key];
    parent.dataset.sgTarget = spec.parent.id;
    if (!OWN_HANDLER.has(key)) parent.addEventListener('click', () => { goTo(key, spec.parent.id); });
    const nodes = [parent];
    if (spec.home) {
        const home = mk('button', 'sg-home', '返回主页', { type: 'button' });
        home.dataset.sgTarget = 'home';
        home.addEventListener('click', () => { goTo(key, 'home'); });
        nodes.push(home);
    }
    bar.replaceChildren(...nodes);
}

/** Fill every empty `.sg-backbar[data-sg-back]` under `root`. */
export function mountBackBars(root = document) {
    root.querySelectorAll('.sg-backbar[data-sg-back]').forEach((bar) => {
        if (!bar.firstChild) renderBar(bar);
    });
}

/** Re-render the bar(s) of one page (after its origin / game kind changed). */
export function refreshBackBar(key) {
    if (typeof document === 'undefined') return;
    document.querySelectorAll(`.sg-backbar[data-sg-back="${key}"]`).forEach(renderBar);
}

// ---------------------------------------------------------------- game exit sheet

/** Pure: copy for the exit sheet. */
export function exitSheetCopy({ cloudMode = false } = {}) {
    return cloudMode
        ? '进度已保存在云端，之后可以在首页点「继续对局」回来。'
        : '当前没有云端存档，离开后这一局不会保留。';
}

let exitSheet = null;

function ensureExitSheet() {
    if (exitSheet) return exitSheet;
    const root = mk('div', 'ctl-overlay ctl-sheet ctl-confirm sg-exit', '', { id: 'sgExitSheet' });
    root.hidden = true;
    root.innerHTML = `<div class="ctl-panel ctl-sheet-panel ctl-paper" role="alertdialog" aria-modal="true" aria-labelledby="sgExitTitle" aria-describedby="sgExitBody">
        <h2 id="sgExitTitle">退出这一局？</h2><p id="sgExitBody"></p>
        <div class="ctl-sheet-actions sg-exit-actions">
          <button type="button" class="ctl ctl-primary sg-exit-continue" data-ctl-kind="primary" data-state="default" id="sgExitContinue" data-ctl-focus><span class="ctl-label">继续对局</span></button>
          <button type="button" class="ctl ctl-secondary" data-ctl-kind="secondary" data-state="default" id="sgExitParent"><span class="ctl-label"></span></button>
          <button type="button" class="ctl ctl-secondary" data-ctl-kind="secondary" data-state="default" id="sgExitHome"><span class="ctl-label">返回主页</span></button>
        </div></div>`;
    document.body.appendChild(root);
    exitSheet = root;
    return root;
}

export async function openGameExitSheet() {
    const { openCtlSheet, closeCtlSheet } = await import('./controls.js');
    const root = ensureExitSheet();
    let cloudMode = false;
    try { cloudMode = !!getSession()?.cloudMode; } catch { /* ignore */ }
    const spec = backSpecFor('game', { gameKind: currentGameKind() });
    root.querySelector('#sgExitBody').textContent = exitSheetCopy({ cloudMode });
    root.querySelector('#sgExitParent .ctl-label').textContent = `返回${spec.parent.label}`;
    const close = () => closeCtlSheet(root);
    const bind = (id, fn) => { const b = root.querySelector(id); b.onclick = fn; };
    bind('#sgExitContinue', close);
    bind('#sgExitParent', () => { close(); goTo('game', spec.parent.id); });
    bind('#sgExitHome', () => { close(); goTo('game', 'home'); });
    root.onclick = (e) => { if (e.target === root) close(); };
    root.onkeydown = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    openCtlSheet(root, { focusSelector: '#sgExitContinue' });
}

export function initNavBack() {
    mountBackBars(document);
    window.refreshBackBar = refreshBackBar;
    window.mountBackBars = mountBackBars;
}
