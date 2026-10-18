import { importWithRetry } from './lazy-import.js';
import { clearShareMeta, setShareMeta, selectShareView, getSession } from './game-session.js';
import { resultVerdict } from './lb-verdict.js';
import { api, getAuthState } from './auth.js';
import { showLeaderboard } from './leaderboard.js';
import { showDailyChallengeBoard } from './daily-challenge.js';

const SHARE_SITE_NAME = '早知道当初不炒了';
const SHARE_SITE_HOST = 'stockgame.xieyw.top';
const SHARE_SITE_URL = 'https://stockgame.xieyw.top';

let lastVerdict = null;

export function clearShareRankMeta() {
    lastVerdict = null;
    clearShareMeta();
}

function fillModeBoardLabel(mode) {
    return mode === 'same_close' ? '当日收盘' : '次日开盘';
}

function formatReturnPctDisplay() {
    const share = selectShareView();
    if (share.returnPct != null) {
        const n = parseFloat(share.returnPct);
        const raw = String(share.returnPct);
        if (Number.isFinite(n)) {
            return (n >= 0 && !raw.startsWith('+') ? '+' : '') + raw + '%';
        }
        return raw + '%';
    }
    const pct = (share.totalReturn - 1) * 100;
    return (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
}

function buildResultPromoCaption() {
    const share = selectShareView();
    const ret = formatReturnPctDisplay();
    const board = fillModeBoardLabel(share.fillMode);
    const beat = share.shareBeatPct;
    if (beat != null) {
        return (
            '我在' + SHARE_SITE_NAME + '（' + SHARE_SITE_HOST + '）模拟炒股，本局收益率 ' + ret +
            '，在' + board + '榜上超越了 ' + beat + '% 的玩家，你也来试试吧！'
        );
    }
    return (
        '我在' + SHARE_SITE_NAME + '（' + SHARE_SITE_HOST + '）模拟炒股，本局收益率 ' + ret +
        '，快来挑战！'
    );
}

function buildResultShareCopyText() {
    const share = selectShareView();
    const opening = '我在「' + SHARE_SITE_NAME + '」用真实 A 股数据练了一局';
    const ret = formatReturnPctDisplay();
    const rank = share.shareRank;
    const beat = share.shareBeatPct;
    const ranked = rank != null || beat != null;
    if (ranked) {
        const bits = [];
        if (rank != null) bits.push('目前排在第 ' + rank + ' 名');
        if (beat != null) bits.push('超越约 ' + beat + '% 的玩家');
        const mid = bits.join('／');
        return opening + '，收益率 ' + ret + '，' + mid + '。不服来战：\n' + SHARE_SITE_URL;
    }
    return opening + '，收益率 ' + ret + '。你也来试试？\n' + SHARE_SITE_URL;
}

function showShareToast(message, kind) {
    let host = document.getElementById('authToastHost');
    if (!host) {
        host = document.createElement('div');
        host.className = 'auth-toast-host';
        host.id = 'authToastHost';
        host.setAttribute('aria-live', 'polite');
        document.body.appendChild(host);
    }
    const toast = document.createElement('div');
    toast.className = 'auth-toast auth-toast--' + (kind || 'success');
    toast.setAttribute('role', 'status');
    toast.textContent = message;
    host.appendChild(toast);
    requestAnimationFrame(function () { toast.classList.add('show'); });
    setTimeout(function () {
        toast.classList.remove('show');
        setTimeout(function () { toast.remove(); }, 280);
    }, 2600);
}

function copyTextToClipboard(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        return navigator.clipboard.writeText(text).then(function () {
            return true;
        }).catch(function () {
            return fallbackCopyText(text);
        });
    }
    return Promise.resolve(fallbackCopyText(text));
}

function fallbackCopyText(text) {
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, text.length);
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return !!ok;
    } catch (e) {
        return false;
    }
}

export async function copyResultShareText() {
    const text = buildResultShareCopyText();
    const btn = document.getElementById('resultShareCopyBtn');
    const orig = btn ? (btn.querySelector('.ctl-label') || btn).textContent : '';
    if (btn) btn.disabled = true;
    try {
        const ok = await copyTextToClipboard(text);
        if (ok) {
            showShareToast('已复制，去粘贴吧', 'success');
        } else {
            showShareToast('复制失败，请手动长按选择文案', 'error');
            console.warn('share copy failed; text:', text);
        }
    } catch (err) {
        console.error('复制分享文案失败', err);
        showShareToast('复制失败，请稍后再试', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            if (orig) (btn.querySelector('.ctl-label') || btn).textContent = orig;
        }
    }
}

export async function refreshShareRankMeta() {
    clearShareRankMeta();
    const auth = getAuthState();
    const share = selectShareView();
    if (!auth || !auth.user || !share.cloudMode || share.saveStatus !== 'saved') {
        return null;
    }
    const session = getSession();
    const kind = session && session.gameKind;
    const fillMode = share.fillMode === 'same_close' ? 'same_close' : 'next_open';
    // Ask the board this game belongs to: its own kind and assist class (反悔局 → undo board).
    const qs = new URLSearchParams({ fillMode: fillMode });
    if (kind === 'oneshot' || kind === 'survival') qs.set('gameKind', kind);
    else if (session && session.assistClass === 'undo') qs.set('assistClass', 'undo');
    try {
        const { data } = await api('/leaderboard?' + qs.toString());
        const total = Number((data && data.total) || 0);
        const myRank = data && data.myRank;
        const recent = (data && data.myRecent) || [];
        const mine = recent.find(function (g) { return g.gameId === share.cloudGameId; }) || null;
        lastVerdict = resultVerdict(mine, {
            rank: myRank == null ? null : myRank,
            total: total,
            fillMode: fillMode,
            assistClass: data && data.assistClass,
            gameKind: data && data.gameKind,
        });
        if (myRank == null || !(total >= 2)) return null;
        const beat = Math.max(0, Math.min(99, Math.round(((total - myRank) / total) * 100)));
        setShareMeta({ rank: myRank, boardTotal: total, beatPct: beat });
        return { myRank: myRank, total: total, beat: beat };
    } catch (e) {
        return null;
    }
}

export function updateShareRankHint() {
    const el = document.getElementById('resultShareHint');
    if (!el) return;
    const share = selectShareView();
    if (lastVerdict && lastVerdict.kind !== 'best') {
        // Explicit per-game verdict (recorded-but-not-best / no-trade / 反悔榜 / opted-out).
        el.hidden = false;
        el.textContent = lastVerdict.text;
        return;
    }
    if (share.shareBeatPct != null && share.shareRank != null) {
        el.hidden = false;
        el.textContent =
            '已上' + fillModeBoardLabel(share.fillMode) + '榜 · #' + share.shareRank +
            ' · 超越约 ' + share.shareBeatPct + '% 玩家';
        return;
    }
    if (share.cloudMode && share.saveStatus === 'saving') {
        el.hidden = false;
        el.textContent = '战绩保存后分享图可带超越比例';
        return;
    }
    if (lastVerdict && lastVerdict.kind === 'best') {
        el.hidden = false;
        el.textContent = lastVerdict.text;
        return;
    }
    if (share.cloudMode && share.saveStatus === 'saved') {
        el.hidden = false;
        el.textContent = '暂无上榜超越数据，分享图将使用简明文案';
        return;
    }
    el.hidden = false;
    el.textContent = '游客/练习局可用简明文案；登录并上榜后分享图可带超越比例';
}

function ensureResultShareSheet() {
    let sheet = document.getElementById('resultShareSheet');
    if (sheet) return sheet;
    sheet = document.createElement('div');
    sheet.id = 'resultShareSheet';
    sheet.className = 'result-share-sheet';
    sheet.setAttribute('aria-hidden', 'true');
    const parts = [];
    parts.push('<div class="result-share-sheet__brand">' + SHARE_SITE_NAME + '</div>');
    parts.push('<div class="result-share-sheet__stock" id="rssStock"></div>');
    parts.push('<div class="result-share-sheet__meta" id="rssMeta"></div>');
    parts.push('<div class="result-share-sheet__return" id="rssReturn"></div>');
    parts.push('<div class="result-share-sheet__grade" id="rssGrade"></div>');
    parts.push('<div class="result-share-sheet__promo" id="rssPromo"></div>');
    parts.push('<div class="result-share-sheet__url">' + SHARE_SITE_URL + '</div>');
    sheet.innerHTML = parts.join('');
    document.body.appendChild(sheet);
    return sheet;
}

function populateResultShareSheet() {
    const sheet = ensureResultShareSheet();
    const share = selectShareView();
    const stockEl = document.getElementById('stockReveal');
    const stock = share.currentStock
        ? (share.currentStock.name + '（' + share.currentStock.code + '）')
        : ((stockEl && stockEl.textContent) || '');
    const dateEl = document.getElementById('dateRange');
    const dateRange = (dateEl && dateEl.textContent) || '';
    const fill = fillModeBoardLabel(share.fillMode) + '成交';
    const ret = formatReturnPctDisplay();
    const gradeEl = document.getElementById('gradeTitle');
    const gradeTitle = (gradeEl && gradeEl.textContent) || '';
    const retEl = sheet.querySelector('#rssReturn');
    const pct = share.returnPct != null
        ? parseFloat(share.returnPct)
        : (share.totalReturn - 1) * 100;
    retEl.className = 'result-share-sheet__return ' +
        (pct > 0 ? 'positive' : pct < 0 ? 'negative' : 'zero');
    sheet.querySelector('#rssStock').textContent = stock;
    sheet.querySelector('#rssMeta').textContent = dateRange + ' · ' + fill;
    retEl.textContent = '收益率 ' + ret;
    sheet.querySelector('#rssGrade').textContent = gradeTitle;
    sheet.querySelector('#rssPromo').textContent = buildResultPromoCaption();
    return sheet;
}

/* ---------- 保存图片 (result screen) ----------
 * Root cause of the old "生成中…" hang: html2canvas was injected from the jsdelivr CDN with no
 * timeout. Where the CDN is slow/blocked (mainland networks, Android WebView) the <script> neither
 * loads nor errors, so the promise never settled and the button stayed disabled. It also finished
 * with <a download>, which Android WebView silently ignores. Now: vendored html2canvas (same as the
 * PvP path), hard timeouts at every stage, delivery via the StockGameApp.saveImage bridge →
 * navigator.share → <a download>, a shutter-style preview as proof, and a retry toast on failure. */
const SAVE_LOAD_TIMEOUT_MS = 10000;
const SAVE_RENDER_TIMEOUT_MS = 20000;
const SAVE_PREVIEW_MS = 1500;
let saveImageBusy = false;

function withTimeout(promise, ms, tag) {
    let timer = 0;
    const timeout = new Promise(function (_, reject) {
        timer = window.setTimeout(function () { reject(new Error('timeout:' + tag)); }, ms);
    });
    return Promise.race([promise, timeout]).finally(function () { window.clearTimeout(timer); });
}

async function renderShareSheetCanvas(sheet, bg) {
    const mod = await withTimeout(importWithRetry(
        'html2canvas',
        function () { return import('./vendor/html2canvas.esm.js'); },
        function () { return new URL('./vendor/html2canvas.esm.js', import.meta.url).href; }
    ), SAVE_LOAD_TIMEOUT_MS, 'load');
    const h2c = mod.default;
    return withTimeout(h2c(sheet, {
        backgroundColor: bg || '#f7f1e3',
        scale: 2,
        useCORS: true,
        logging: false,
        imageTimeout: 6000,
        width: sheet.offsetWidth,
        height: sheet.offsetHeight,
        windowWidth: sheet.offsetWidth,
        x: 0,
        y: 0,
        scrollX: 0,
        scrollY: 0,
        onclone: function (doc) {
            const c = doc.getElementById('resultShareSheet');
            if (c) { c.style.left = '0px'; c.style.top = '0px'; c.style.zIndex = '1'; }
        },
    }), SAVE_RENDER_TIMEOUT_MS, 'render');
}

/** Screenshot-style preview: white flash, the card drops in, auto-closes (~1.5s) or on tap. */
function showSavePreview(canvas, how) {
    const old = document.getElementById('resultSavePreview');
    if (old) old.remove();
    const copy = {
        'bridge-saved': '已保存到相册',
        'bridge-shared': '已打开系统分享',
        shared: '已打开分享',
        downloaded: '图片已保存',
    }[how] || '图片已保存';
    const root = document.createElement('div');
    root.id = 'resultSavePreview';
    root.className = 'result-save-preview';
    root.setAttribute('role', 'status');
    const flash = document.createElement('div');
    flash.className = 'result-save-preview__flash';
    const card = document.createElement('div');
    card.className = 'result-save-preview__card';
    const img = document.createElement('img');
    img.alt = '分享图预览';
    try { img.src = canvas.toDataURL('image/png'); } catch (e) { /* tainted: caption only */ }
    const cap = document.createElement('div');
    cap.className = 'result-save-preview__cap';
    cap.textContent = '✓ ' + copy;
    card.append(img, cap);
    root.append(flash, card);
    document.body.appendChild(root);
    let closed = false;
    const close = function () {
        if (closed) return;
        closed = true;
        root.classList.add('is-out');
        window.setTimeout(function () { root.remove(); }, 180);
    };
    root.addEventListener('click', close);
    window.setTimeout(close, SAVE_PREVIEW_MS);
    return root;
}

/** Error toast with a 重试 button (no browser dialog). Stays ~6s; own element so showStampToast's 2.2s timer can't remove it. */
function showSaveRetryToast(message, onRetry) {
    let host = document.getElementById('authToastHost');
    if (!host) {
        host = document.createElement('div');
        host.className = 'auth-toast-host';
        host.id = 'authToastHost';
        host.setAttribute('aria-live', 'polite');
        document.body.appendChild(host);
    }
    const toast = document.createElement('div');
    toast.className = 'auth-toast ctl-toast ctl-toast--error auth-toast--error result-retry-toast';
    toast.setAttribute('role', 'alert');
    toast.style.pointerEvents = 'auto';
    const text = document.createElement('span');
    text.textContent = message;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'result-retry-toast__btn';
    btn.textContent = '重试';
    const hide = function () {
        toast.classList.remove('show');
        window.setTimeout(function () { toast.remove(); }, 200);
    };
    btn.addEventListener('click', function (ev) { ev.stopPropagation(); hide(); onRetry(); });
    toast.addEventListener('click', hide);
    toast.append(text, btn);
    host.appendChild(toast);
    requestAnimationFrame(function () { toast.classList.add('show'); });
    window.setTimeout(hide, 6000);
}

export async function saveResultShareImage() {
    if (saveImageBusy) return;
    saveImageBusy = true;
    const btn = document.getElementById('resultShareImageBtn');
    const labelEl = btn ? (btn.querySelector('.ctl-label') || btn) : null;
    const orig = labelEl ? labelEl.textContent : '';
    if (btn) {
        btn.disabled = true;
        labelEl.textContent = '生成中…';
    }
    let sheet = null;
    try {
        sheet = populateResultShareSheet();
        sheet.classList.add('capturing');
        void sheet.offsetWidth;
        const bg = getComputedStyle(document.documentElement).getPropertyValue('--card').trim()
            || getComputedStyle(sheet).backgroundColor
            || '#f7f1e3';
        const canvas = await renderShareSheetCanvas(sheet, bg);
        sheet.classList.remove('capturing');
        const shareStock = selectShareView().currentStock;
        const code = (shareStock && shareStock.code) || 'game';
        const safeCode = String(code).replace(/[\\\/:*?"<>|]/g, '_');
        const filename = '结算分享_' + safeCode + '.png';
        const bridge = window.StockGameApp;
        const hasBridge = !!(bridge && typeof bridge.saveImage === 'function');
        const { deliverImage } = await withTimeout(importWithRetry(
            'share-image',
            function () { return import('./share-image.js'); },
            function () { return new URL('./share-image.js', import.meta.url).href; }
        ), SAVE_LOAD_TIMEOUT_MS, 'deliver-load');
        const how = await deliverImage(canvas, filename, { title: SHARE_SITE_NAME, text: buildResultPromoCaption() });
        if (how === 'cancelled') return;
        // In the Android shell, a bridge that did not report "saved" means nothing reached the album
        // and WebView ignores <a download>: do not claim success.
        if (hasBridge && how === 'downloaded') throw new Error('bridge-save-failed');
        showSavePreview(canvas, how);
    } catch (err) {
        console.error('结算分享图失败', err);
        showSaveRetryToast('保存图片失败，请重试', function () { void saveResultShareImage(); });
    } finally {
        if (sheet) sheet.classList.remove('capturing');
        saveImageBusy = false;
        if (btn) {
            btn.disabled = false;
            labelEl.textContent = orig || '保存图片';
        }
    }
}

export function openResultLeaderboard() {
    const session = getSession();
    if (session?.gameKind === 'daily') {
        void showDailyChallengeBoard();
        return;
    }
    const mode = selectShareView().fillMode === 'same_close' ? 'same_close' : 'next_open';
    const kind = session?.gameKind;
    if (kind === 'oneshot' || kind === 'survival') {
        showLeaderboard({ fillMode: mode, gameKind: kind });
        return;
    }
    showLeaderboard(mode);
}
