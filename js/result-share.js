import { importWithRetry } from './lazy-import.js';
import { clearShareMeta, setShareMeta, selectShareView, getSession } from './game-session.js';
import { shareBoardQuery, planShareRank, bestGameText } from './lb-verdict.js';
import { api, getAuthState } from './auth.js';
import { showLeaderboard } from './leaderboard.js';
import { showDailyChallengeBoard } from './daily-challenge.js';
import { posterFooter } from './invite-pure.js';
import { shareWindowBars, drawShareKline } from './share-kline.js';
import { pickShareSlogan } from './share-slogan.js';

const SHARE_SITE_NAME = '早知道当初不炒了';
const SHARE_SITE_HOST = 'stockgame.xieyw.top';
const SHARE_SITE_URL = 'https://stockgame.xieyw.top';

let lastVerdict = null;
// Board the rank/beat% came from (e.g. 一把梭·次日开盘, 次日开盘·反悔). Not always the plain fill-mode board.
let lastBoardLabel = null;

export function clearShareRankMeta() {
    lastVerdict = null;
    lastBoardLabel = null;
    clearShareMeta();
}

function fillModeBoardLabel(mode) {
    return mode === 'same_close' ? '当日收盘' : '次日开盘';
}

/** Label of the board the shown rank belongs to (falls back to the plain fill-mode board). */
function rankBoardLabel(share) {
    return lastBoardLabel || fillModeBoardLabel(share.fillMode);
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
    const board = rankBoardLabel(share);
    const beat = share.shareBeatPct;
    if (beat != null && beat > 0) {
        return (
            '我在' + SHARE_SITE_NAME + '（' + SHARE_SITE_HOST + '）模拟炒股，本局收益率 ' + ret +
            '，在' + board + '榜上超越了 ' + beat + '% 的玩家，你也来试试吧！'
        );
    }
    if (beat === 0) {
        // last place on the board: no "超越 0%" fragment
        return (
            '我在' + SHARE_SITE_NAME + '（' + SHARE_SITE_HOST + '）模拟炒股，本局收益率 ' + ret +
            '，登上了' + board + '榜，你也来试试吧！'
        );
    }
    return (
        '我在' + SHARE_SITE_NAME + '（' + SHARE_SITE_HOST + '）模拟炒股，本局收益率 ' + ret +
        '，快来挑战！'
    );
}

export async function refreshShareRankMeta() {
    clearShareRankMeta();
    const auth = getAuthState();
    const share = selectShareView();
    if (!auth || !auth.user || !share.cloudMode || share.saveStatus !== 'saved') {
        return null;
    }
    // Ask the board this game belongs to (own kind / 反悔 class). daily / ghost / puzzle have no board here.
    const query = shareBoardQuery(share);
    if (!query) return null;
    try {
        const { data } = await api('/leaderboard?' + new URLSearchParams(query.params).toString());
        const plan = planShareRank(share, data, query.fillMode);
        lastBoardLabel = plan.label;
        lastVerdict = plan.verdict;
        if (!plan.meta) return null;
        setShareMeta({ rank: plan.meta.rank, boardTotal: plan.meta.boardTotal, beatPct: plan.meta.beatPct });
        return { myRank: plan.meta.rank, total: plan.meta.boardTotal, beat: plan.meta.beatPct };
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
        el.textContent = bestGameText(rankBoardLabel(share), share.shareRank, share.shareBeatPct);
        return;
    }
    if (share.cloudMode && share.saveStatus === 'saving') {
        el.hidden = true; // 说明性文字不再占结算页位置
        el.textContent = '';
        return;
    }
    if (lastVerdict && lastVerdict.kind === 'best') {
        el.hidden = false;
        el.textContent = lastVerdict.text;
        return;
    }
    // 没有名次/超越比例可说时什么都不显示（以前这里是“游客/练习局可用简明文案…”之类的说明）。
    el.hidden = true;
    el.textContent = '';
}

function ensureResultShareSheet() {
    let sheet = document.getElementById('resultShareSheet');
    if (sheet) return sheet;
    sheet = document.createElement('div');
    sheet.id = 'resultShareSheet';
    sheet.className = 'result-share-sheet';
    sheet.setAttribute('aria-hidden', 'true');
    const parts = [];
    parts.push('<div class="result-share-sheet__stock" id="rssStock"></div>');
    parts.push('<div class="result-share-sheet__meta" id="rssMeta"></div>');
    parts.push('<div class="result-share-sheet__ret-label">收益率</div>');
    parts.push('<div class="result-share-sheet__return" id="rssReturn"></div>');
    parts.push('<canvas class="result-share-sheet__kline" id="rssKline" width="1168" height="560"></canvas>');
    parts.push('<div class="result-share-sheet__slogan" id="rssSlogan"></div>');
    parts.push(
        '<div class="result-share-sheet__foot">' +
            '<img class="result-share-sheet__qr" id="rssQr" alt="" width="96" height="96">' +
            '<div class="result-share-sheet__foot-words">' +
                '<div class="result-share-sheet__foot-1" id="rssFoot1"></div>' +
                '<div class="result-share-sheet__foot-code" id="rssFoot2"></div>' +
                '<div class="result-share-sheet__foot-3" id="rssFoot3"></div>' +
            '</div>' +
        '</div>'
    );
    sheet.innerHTML = parts.join('');
    document.body.appendChild(sheet);
    return sheet;
}

/** Invite code for the poster / caption. Never blocks saving: guests, flag off or a slow API → plain site card. */
async function loadPosterInvite() {
    try {
        const m = await import('./invite.js');
        return await Promise.race([
            m.fetchInvite(),
            new Promise(function (resolve) { window.setTimeout(function () { resolve(null); }, 2500); }),
        ]);
    } catch (e) {
        return null;
    }
}

async function fillPosterFooter(sheet, invite) {
    const foot = posterFooter(invite);
    sheet.querySelector('#rssFoot1').textContent = foot.line1;
    const f2 = sheet.querySelector('#rssFoot2');
    f2.textContent = foot.line2;
    f2.classList.toggle('is-code', !!foot.code);
    sheet.querySelector('#rssFoot3').textContent = foot.line3;
    const img = sheet.querySelector('#rssQr');
    try {
        const { qrDataUrl } = await import('./share-image.js');
        img.src = await qrDataUrl(foot.link);
        await (img.decode ? img.decode().catch(function () {}) : Promise.resolve());
        img.style.visibility = 'visible';
    } catch (e) {
        img.removeAttribute('src');
        img.style.visibility = 'hidden';
    }
    return foot;
}

function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
}

/** Paint the 30 played bars (+ 买/卖 marks) onto the sheet's canvas. Returns false when there is no data. */
function paintShareKline(sheet) {
    const canvas = sheet.querySelector('#rssKline');
    if (!canvas) return false;
    const view = getSession();
    const bars = shareWindowBars(view.gameKline, view.historyLength, view.gameDays || 30);
    canvas.hidden = bars.length === 0;
    if (!bars.length) return false;
    return drawShareKline(canvas, bars, view.tradeHistory, {
        up: cssVar('--gain-color', '#e05252'),
        down: cssVar('--loss-color', '#3db86a'),
        grid: cssVar('--line', '#3a3530') + '55',
        text: cssVar('--mute', '#8a7f70'),
        buy: cssVar('--terra', '#c45c3a'),
        sell: cssVar('--ink', '#2b2622'),
        markInk: cssVar('--card', '#f7f1e3'),
        font: 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
    }, 2);
}

async function populateResultShareSheet() {
    const sheet = ensureResultShareSheet();
    const share = selectShareView();
    const stockEl = document.getElementById('stockReveal');
    const stock = share.currentStock
        ? (share.currentStock.name + '（' + share.currentStock.code + '）')
        : ((stockEl && stockEl.textContent) || '');
    const dateEl = document.getElementById('dateRange');
    const dateRange = (dateEl && dateEl.textContent) || '';
    const ret = formatReturnPctDisplay();
    const retEl = sheet.querySelector('#rssReturn');
    const pct = share.returnPct != null
        ? parseFloat(share.returnPct)
        : (share.totalReturn - 1) * 100;
    retEl.className = 'result-share-sheet__return ' +
        (pct > 0 ? 'positive' : pct < 0 ? 'negative' : 'zero');
    sheet.querySelector('#rssStock').textContent = stock;
    sheet.querySelector('#rssMeta').textContent = dateRange;
    retEl.textContent = ret;
    sheet.querySelector('#rssSlogan').textContent = pickShareSlogan(ret, pct);
    paintShareKline(sheet);
    const invite = await loadPosterInvite();
    lastPosterFoot = await fillPosterFooter(sheet, invite);
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
let saveImageBusy = false;
let lastPosterFoot = null;

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

/* ---------- 截图特效 ----------
 * 像手机截屏：画面一闪（白闪 + 轻震动）→ 刚拍下的图放大停一下 → 缩成左下角缩略图，
 * 缩略图下面先是“保存中…”，交付完成后变成“✓ 已保存”，约 2.6 秒后滑出；点缩略图可放大查看。 */
const THUMB_HOLD_MS = 2600;

function reducedMotion() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
}

function playCaptureFlash() {
    try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) { /* no haptics */ }
    if (reducedMotion()) return;
    const flash = document.createElement('div');
    flash.className = 'result-capture-flash';
    flash.setAttribute('aria-hidden', 'true');
    document.body.appendChild(flash);
    window.setTimeout(function () { flash.remove(); }, 400);
}

function openCaptureEnlarged(src) {
    if (!src || document.getElementById('resultCaptureBig')) return;
    const root = document.createElement('div');
    root.id = 'resultCaptureBig';
    root.className = 'result-capture-big';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', '分享图预览');
    const img = document.createElement('img');
    img.alt = '分享图预览';
    img.src = src;
    root.appendChild(img);
    const close = function () { root.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = function (e) { if (e.key === 'Escape') close(); };
    root.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(root);
}

/**
 * Show the flash + thumbnail for a freshly rendered canvas.
 * @returns {{ saved(how: string): void, dismiss(): void }}
 */
function playCaptureEffect(canvas) {
    const old = document.getElementById('resultCaptureThumb');
    if (old) old.remove();
    let src = '';
    try { src = canvas.toDataURL('image/png'); } catch (e) { /* tainted canvas: caption only */ }
    playCaptureFlash();

    const root = document.createElement('div');
    root.id = 'resultCaptureThumb';
    root.className = 'result-capture-thumb';
    root.setAttribute('role', 'status');
    const frame = document.createElement('button');
    frame.type = 'button';
    frame.className = 'result-capture-thumb__frame';
    frame.setAttribute('aria-label', '查看刚保存的分享图');
    const img = document.createElement('img');
    img.alt = '';
    if (src) img.src = src;
    frame.appendChild(img);
    const cap = document.createElement('div');
    cap.className = 'result-capture-thumb__cap';
    cap.textContent = '保存中…';
    root.append(frame, cap);
    document.body.appendChild(root);

    let timer = 0;
    let gone = false;
    const dismiss = function () {
        if (gone) return;
        gone = true;
        window.clearTimeout(timer);
        if (reducedMotion() || !root.animate) { root.remove(); return; }
        root.animate(
            [{ transform: 'none', opacity: 1 }, { transform: 'translateX(-130%)', opacity: 0 }],
            { duration: 220, easing: 'ease-in', fill: 'forwards' }
        ).onfinish = function () { root.remove(); };
    };
    frame.addEventListener('click', function () {
        window.clearTimeout(timer);
        timer = window.setTimeout(dismiss, THUMB_HOLD_MS * 2);
        openCaptureEnlarged(src);
    });

    // 飞入：先在屏幕中央放大停一下，再缩到左下角。
    if (!reducedMotion() && root.animate) {
        const r = root.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const scale = Math.min(3.2, (vw * 0.62) / Math.max(r.width, 1), (vh * 0.5) / Math.max(r.height, 1));
        const dx = vw / 2 - (r.left + r.width / 2);
        const dy = vh / 2 - (r.top + r.height / 2);
        const mid = 'translate(' + dx + 'px,' + dy + 'px) scale(' + scale + ') rotate(-1.5deg)';
        root.animate(
            [
                { transform: mid, opacity: 0, offset: 0 },
                { transform: mid, opacity: 1, offset: 0.12 },
                { transform: mid, opacity: 1, offset: 0.5 },
                { transform: 'none', opacity: 1, offset: 1 },
            ],
            { duration: 820, easing: 'cubic-bezier(.22,.8,.24,1)' }
        );
    }

    return {
        saved: function (how) {
            const copy = {
                'bridge-saved': '已保存到相册',
                'bridge-shared': '已打开系统分享',
                shared: '已打开分享',
                downloaded: '图片已保存',
            }[how] || '图片已保存';
            cap.textContent = '✓ ' + copy;
            root.classList.add('is-saved');
            window.clearTimeout(timer);
            timer = window.setTimeout(dismiss, THUMB_HOLD_MS);
        },
        dismiss: dismiss,
    };
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
    let capture = null;
    try {
        sheet = await populateResultShareSheet();
        sheet.classList.add('capturing');
        void sheet.offsetWidth;
        const bg = getComputedStyle(document.documentElement).getPropertyValue('--card').trim()
            || getComputedStyle(sheet).backgroundColor
            || '#f7f1e3';
        const canvas = await renderShareSheetCanvas(sheet, bg);
        sheet.classList.remove('capturing');
        capture = playCaptureEffect(canvas);
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
        const caption = lastPosterFoot && lastPosterFoot.code
            ? buildResultPromoCaption() + ' 邀请码 ' + lastPosterFoot.code + ' ' + lastPosterFoot.link
            : buildResultPromoCaption();
        const how = await deliverImage(canvas, filename, { title: SHARE_SITE_NAME, text: caption });
        if (how === 'cancelled') { capture.dismiss(); return; }
        // In the Android shell, a bridge that did not report "saved" means nothing reached the album
        // and WebView ignores <a download>: do not claim success.
        if (hasBridge && how === 'downloaded') throw new Error('bridge-save-failed');
        capture.saved(how);
    } catch (err) {
        console.error('结算分享图失败', err);
        if (capture) capture.dismiss();
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
    if (session?.gameKind === 'stake') {
        import('./coin-board.js').then((m) => m.showCoinBoard()).catch(() => {});
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
