import { gameState } from './state.js';
import { api, getAuthState } from './auth.js';
import { showLeaderboard } from './leaderboard.js';

const SHARE_SITE_NAME = '早知道当初不炒了';
const SHARE_SITE_HOST = 'stockgame.xieyw.top';
const SHARE_SITE_URL = 'https://stockgame.xieyw.top';

export function clearShareRankMeta() {
    gameState.shareRank = null;
    gameState.shareBoardTotal = null;
    gameState.shareBeatPct = null;
}

function fillModeBoardLabel(mode) {
    return mode === 'same_close' ? '当日收盘' : '次日开盘';
}

function formatReturnPctDisplay() {
    if (gameState.returnPct != null) {
        const n = parseFloat(gameState.returnPct);
        const raw = String(gameState.returnPct);
        if (Number.isFinite(n)) {
            return (n >= 0 && !raw.startsWith('+') ? '+' : '') + raw + '%';
        }
        return raw + '%';
    }
    const pct = (gameState.totalReturn - 1) * 100;
    return (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
}

function buildResultPromoCaption() {
    const ret = formatReturnPctDisplay();
    const board = fillModeBoardLabel(gameState.fillMode);
    const beat = gameState.shareBeatPct;
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

export async function refreshShareRankMeta() {
    clearShareRankMeta();
    const auth = getAuthState();
    if (!auth || !auth.user || !gameState.cloudMode || gameState.saveStatus !== 'saved') {
        return null;
    }
    const fillMode = gameState.fillMode === 'same_close' ? 'same_close' : 'next_open';
    try {
        const { data } = await api('/leaderboard?fillMode=' + encodeURIComponent(fillMode));
        const total = Number((data && data.total) || 0);
        const myRank = data && data.myRank;
        if (myRank == null || !(total >= 2)) return null;
        const beat = Math.max(0, Math.min(99, Math.round(((total - myRank) / total) * 100)));
        gameState.shareRank = myRank;
        gameState.shareBoardTotal = total;
        gameState.shareBeatPct = beat;
        return { myRank: myRank, total: total, beat: beat };
    } catch (e) {
        return null;
    }
}

export function updateShareRankHint() {
    const el = document.getElementById('resultShareHint');
    if (!el) return;
    if (gameState.shareBeatPct != null && gameState.shareRank != null) {
        el.hidden = false;
        el.textContent =
            '已上' + fillModeBoardLabel(gameState.fillMode) + '榜 · #' + gameState.shareRank +
            ' · 超越约 ' + gameState.shareBeatPct + '% 玩家';
        return;
    }
    if (gameState.cloudMode && gameState.saveStatus === 'saving') {
        el.hidden = false;
        el.textContent = '战绩保存后分享图可带超越比例';
        return;
    }
    if (gameState.cloudMode && gameState.saveStatus === 'saved') {
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
    const stockEl = document.getElementById('stockReveal');
    const stock = gameState.currentStock
        ? (gameState.currentStock.name + '（' + gameState.currentStock.code + '）')
        : ((stockEl && stockEl.textContent) || '');
    const dateEl = document.getElementById('dateRange');
    const dateRange = (dateEl && dateEl.textContent) || '';
    const fill = fillModeBoardLabel(gameState.fillMode) + '成交';
    const ret = formatReturnPctDisplay();
    const gradeEl = document.getElementById('gradeTitle');
    const gradeTitle = (gradeEl && gradeEl.textContent) || '';
    const retEl = sheet.querySelector('#rssReturn');
    const pct = gameState.returnPct != null
        ? parseFloat(gameState.returnPct)
        : (gameState.totalReturn - 1) * 100;
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
        const code = (gameState.currentStock && gameState.currentStock.code) || 'game';
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
    const mode = gameState.fillMode === 'same_close' ? 'same_close' : 'next_open';
    showLeaderboard(mode);
}
