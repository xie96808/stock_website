import { clearShareMeta, setShareMeta, selectShareView } from './game-session.js';
import { api, getAuthState } from './auth.js';
import { showLeaderboard } from './leaderboard.js';

const SHARE_SITE_NAME = '早知道当初不炒了';
const SHARE_SITE_HOST = 'stockgame.xieyw.top';
const SHARE_SITE_URL = 'https://stockgame.xieyw.top';

export function clearShareRankMeta() {
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
    const orig = btn ? btn.textContent : '';
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
            if (orig) btn.textContent = orig;
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
    const fillMode = share.fillMode === 'same_close' ? 'same_close' : 'next_open';
    try {
        const { data } = await api('/leaderboard?fillMode=' + encodeURIComponent(fillMode));
        const total = Number((data && data.total) || 0);
        const myRank = data && data.myRank;
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
    if (share.cloudMode && share.saveStatus === 'saved') {
        el.hidden = false;
        el.textContent = '暂无上榜超越数据，分享图将使用简明文案';
        return;
    }
    el.hidden = false;
    el.textContent = '游客/练习局可用简明文案；登录并上榜后分享图可带超越比例';
}

function loadHtml2canvas() {
    if (typeof html2canvas === 'function') return Promise.resolve(true);
    return new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
        s.async = true;
        s.onload = () => resolve(typeof html2canvas === 'function');
        s.onerror = () => resolve(false);
        document.head.appendChild(s);
    });
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

export async function saveResultShareImage() {
    const btn = document.getElementById('resultShareImageBtn');
    const orig = btn ? btn.textContent : '';
    if (btn) {
        btn.disabled = true;
        btn.textContent = '生成中…';
    }
    try {
        const ok = await loadHtml2canvas();
        const sheet = populateResultShareSheet();
        sheet.classList.add('capturing');
        void sheet.offsetWidth;
        if (!ok || typeof html2canvas !== 'function') {
            sheet.classList.remove('capturing');
            alert('当前环境无法生成分享图，请稍后再试');
            return;
        }
        const bg = getComputedStyle(document.documentElement).getPropertyValue('--card').trim()
            || getComputedStyle(sheet).backgroundColor
            || '#f7f1e3';
        const canvas = await html2canvas(sheet, {
            backgroundColor: bg || '#f7f1e3',
            scale: 2,
            useCORS: true,
            logging: false,
        });
        sheet.classList.remove('capturing');
        const blob = await new Promise(function (resolve) { canvas.toBlob(resolve, 'image/png'); });
        if (!blob) {
            alert('生成分享图失败，请稍后再试');
            return;
        }
        const shareStock = selectShareView().currentStock;
        const code = (shareStock && shareStock.code) || 'game';
        const safeCode = String(code).replace(/[\\\/:*?"<>|]/g, '_');
        const filename = '结算分享_' + safeCode + '.png';
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    } catch (err) {
        console.error('结算分享图失败', err);
        const sheet = document.getElementById('resultShareSheet');
        if (sheet) sheet.classList.remove('capturing');
        alert('生成分享图失败，请稍后再试');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = orig || '📷 保存分享图';
        }
    }
}

export function openResultLeaderboard() {
    const mode = selectShareView().fillMode === 'same_close' ? 'same_close' : 'next_open';
    showLeaderboard(mode);
}
