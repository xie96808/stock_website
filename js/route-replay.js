/**
 * 付费复盘 client — 最优路线重演 (+ 死拿对照 add-on). Server flag: gameReviewEnabled
 * (GET /games/:id/review → { enabled:false } hides the result-page card).
 *
 * Flow: result-page card → full-screen overlay. Locked: teaser + unlock (two taps: "解锁 30" arms "确认 -30").
 * Unlocked: the same window replays from day 1; trading is locked, the player only walks forward (下一天 / 自动播放).
 * The walk stops on every optimal buy / sell and a popup says what to do and why (hindsight reasons, labelled as such).
 * The end shows a summary: optimal vs the player's own play, where the gap came from, a verdict per round trip.
 */
import { api, getAuthState, selectIsAuthenticated } from './auth.js';
import { openCtlOverlay, closeCtlOverlay, showStampToast } from './controls.js';
import { refreshJiuCoinStatus } from './jiu-coin.js';
import { ensureEcharts } from './echarts-loader.js';
import { applyChartTheme, getTheme } from './theme.js';
import { buildKlineOption } from './kline-option.js';
import {
    initialReplay, advance, acknowledge, runToEnd, popupCopy, gapRows, curvePoints, curveRange, curvePct, fmtPct,
    teaserCopy, reviewAction, reviewErrorToast, REPLAY_DAYS,
} from './route-replay-pure.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const authed = () => selectIsAuthenticated(getAuthState());
const toneCls = (x) => (x > 0.005 ? 'up' : x < -0.005 ? 'down' : 'flat');

let S = null; // { gameId, data, replay, auto, timer, speed, armed, armTimer, busy, chart }
let entryGameId = null;

function newSession(gameId) {
    return { gameId, data: null, replay: initialReplay(), auto: false, timer: 0, speed: 1, armed: null, armTimer: 0, busy: false, chart: null };
}

/* ---------- result-page entry card ---------- */

export function hideReviewEntry() {
    entryGameId = null;
    const el = $('reviewEntry');
    if (el) { el.hidden = true; el.innerHTML = ''; }
}

export async function refreshReviewEntry(gameId) {
    const el = $('reviewEntry');
    if (!el || !gameId || !authed()) { hideReviewEntry(); return; }
    entryGameId = gameId;
    let data;
    try {
        ({ data } = await api(`/games/${encodeURIComponent(gameId)}/review`));
    } catch { hideReviewEntry(); return; }
    if (entryGameId !== gameId) return; // another result screen replaced this one
    if (!data || !data.enabled) { hideReviewEntry(); return; }
    if (!data.eligible) {
        if (data.reason === 'REVIEW_NOT_YET') {
            el.innerHTML = `<div class="rv-card rv-card--note"><strong class="rv-title">深度复盘</strong><p class="rv-text">${esc(data.message)}</p></div>`;
            el.hidden = false;
        } else hideReviewEntry();
        return;
    }
    const route = data.products.find((p) => p.id === 'route');
    const owned = !!data.owned.route;
    el.innerHTML = `<div class="rv-card">
        <div class="rv-head"><strong class="rv-title">深度复盘 · 最优路线重演</strong>${owned ? '<span class="rv-badge">已解锁</span>' : ''}</div>
        <p class="rv-text">${owned ? '同一段行情重走一遍，走到最优买卖点自动停下告诉你为什么。' : esc(teaserCopy(data.teaser))}</p>
        <button type="button" class="rv-btn" data-rr-open>${owned ? '再看一遍' : `重演最优路线 · ${route ? route.price : 30} 韭币`}</button>
    </div>`;
    el.hidden = false;
}

/* ---------- overlay shell ---------- */

function ensureOverlay() {
    if ($('rrOverlay')) return;
    const t = document.createElement('template');
    t.innerHTML = `<div class="ctl-overlay rr-overlay" id="rrOverlay" hidden aria-hidden="true">
        <div class="ctl-panel rr-sheet" role="dialog" aria-modal="true" aria-labelledby="rrTitle">
            <header class="rr-head">
                <button type="button" class="rr-close" id="rrClose" aria-label="关闭">×</button>
                <div class="rr-head-text"><h2 id="rrTitle">最优路线重演</h2><span class="rr-sub" id="rrSub"></span></div>
                <button type="button" class="rr-hold-btn" id="rrHoldBtn" hidden></button>
            </header>
            <div class="rr-body" id="rrBody"></div>
        </div>
    </div>`.trim();
    document.body.appendChild(t.content.firstElementChild);
    $('rrClose').addEventListener('click', closeReplay);
    $('rrOverlay').addEventListener('click', onClick);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('rrOverlay') && !$('rrOverlay').hidden) closeReplay(); });
    window.addEventListener('resize', () => { try { S?.chart?.resize(); } catch { /* ignore */ } });
}

export function closeReplay() {
    if (S) {
        window.clearTimeout(S.timer);
        window.clearTimeout(S.armTimer);
        try { S.chart?.dispose(); } catch { /* ignore */ }
        S.chart = null;
    }
    S = null;
    const o = $('rrOverlay');
    if (o) closeCtlOverlay(o);
    // 「我的战绩」据此刷新已购状态。
    try { document.dispatchEvent(new CustomEvent('rr:closed')); } catch { /* ignore */ }
}

function setBody(html) {
    $('rrBody').innerHTML = html;
}

/* ---------- open / load ---------- */

export async function openReviewReplay(gameId) {
    if (!authed() || !gameId) return;
    ensureOverlay();
    S = newSession(gameId);
    $('rrSub').textContent = '';
    $('rrHoldBtn').hidden = true;
    setBody('<p class="rr-loading">加载中…</p>');
    openCtlOverlay($('rrOverlay'));
    try {
        const { data } = await api(`/games/${encodeURIComponent(gameId)}/review`);
        if (!S || S.gameId !== gameId) return;
        if (!data || !data.enabled || !data.eligible) {
            showStampToast(data && data.message ? data.message : '复盘暂未开放', 'error');
            closeReplay();
            return;
        }
        S.data = data;
        if (data.owned.route) startPlay(); else renderLocked();
    } catch (e) {
        showStampToast(reviewErrorToast(e), 'error');
        closeReplay();
    }
}

/* ---------- locked ---------- */

function productBtn(product, balance, attrs) {
    const a = reviewAction(product, balance, S.armed === product.id);
    return `<button type="button" class="rv-btn rv-btn--${a.kind}" ${attrs} ${a.disabled ? 'disabled' : ''}>${esc(a.label)}</button>`;
}

function renderLocked() {
    const d = S.data;
    const t = d.teaser;
    const route = d.products.find((p) => p.id === 'route');
    $('rrTitle').textContent = '最优路线重演';
    setBody(`<div class="rr-locked">
        <p class="rr-lead">${esc(teaserCopy(t))}</p>
        <div class="rr-versus">
            <div class="rr-vs rr-vs--route"><span>最优操作</span><strong class="${toneCls(t.optimalReturnPct)}">${fmtPct(t.optimalReturnPct)}</strong></div>
            <div class="rr-vs"><span>你的结果</span><strong class="${toneCls(t.yourReturnPct)}">${fmtPct(t.yourReturnPct)}</strong></div>
        </div>
        <ul class="rr-perks">
            <li>同一只股票、同一段行情，从第 1 天重新开始</li>
            <li>买卖按钮锁住，你只管点「下一天」往前走</li>
            <li>走到最优买点 / 卖点自动停下，告诉你这天该买还是该卖、为什么</li>
            <li>走完看总结：你和最优差在哪、每一笔操作的点评</li>
        </ul>
        <div class="rr-buy">
            <span class="rr-bal">我的韭币 ${d.balance}</span>
            ${productBtn(route, d.balance, 'data-rr-buy="route"')}
        </div>
    </div>`);
}

/* ---------- purchase ---------- */

async function buy(productId) {
    if (!S || S.busy) return;
    const d = S.data;
    const product = d.products.find((p) => p.id === productId);
    if (!product) return;
    const a = reviewAction(product, d.balance, S.armed === productId);
    if (a.disabled) return;
    if (a.kind === 'buy') {
        S.armed = productId;
        window.clearTimeout(S.armTimer);
        S.armTimer = window.setTimeout(() => { if (S) { S.armed = null; repaintBuyButtons(); } }, 3500);
        repaintBuyButtons();
        return;
    }
    S.busy = true;
    S.armed = null;
    try {
        const { data } = await api(`/games/${encodeURIComponent(S.gameId)}/review/unlock`, { method: 'POST', body: { product: productId } });
        refreshJiuCoinStatus().catch(() => {});
        S.data = data;
        showStampToast(productId === 'route' ? `已解锁最优路线重演 -${product.price} 韭币` : `已加购死拿对照 -${product.price} 韭币`, 'success');
        if (productId === 'route') startPlay(); else { paintHoldBtn(); paintStats(); paintEquity(); if (S.replay.done) paintSummary({ scroll: false }); }
    } catch (e) {
        showStampToast(reviewErrorToast(e), 'error');
        try {
            const { data } = await api(`/games/${encodeURIComponent(S.gameId)}/review`);
            if (S && data && data.eligible) { S.data = data; if (data.owned.route && !$('rrChartHost')) startPlay(); }
        } catch { /* keep what is on screen */ }
    } finally {
        if (S) { S.busy = false; repaintBuyButtons(); }
    }
}

function repaintBuyButtons() {
    if (!S) return;
    if (!S.data.owned.route) { renderLocked(); return; }
    paintHoldBtn();
    if (S.replay.done) paintSummary({ scroll: false });
}

function paintHoldBtn() {
    const btn = $('rrHoldBtn');
    const d = S.data;
    const hold = d.products.find((p) => p.id === 'hold');
    if (!d.owned.route || !hold || hold.owned) { btn.hidden = true; return; }
    const a = reviewAction(hold, d.balance, S.armed === 'hold');
    btn.hidden = false;
    btn.disabled = a.disabled;
    btn.dataset.rrBuy = 'hold';
    btn.className = `rr-hold-btn rr-hold-btn--${a.kind}`;
    btn.textContent = a.kind === 'confirm' ? a.label : `＋死拿对照 ${hold.price}`;
    if (a.kind === 'poor') btn.textContent = `＋死拿对照（${a.label}）`;
}

/* ---------- play ---------- */

function startPlay() {
    const d = S.data;
    window.clearTimeout(S.timer);
    S.auto = false;
    S.replay = initialReplay();
    $('rrTitle').textContent = '最优路线重演';
    $('rrSub').textContent = d.stock ? `${d.stock.name}（${d.stock.code}）` : '';
    setBody(`<div class="rr-play">
        <div class="rr-stats" id="rrStats"></div>
        <div class="rr-day"><span id="rrDay"></span><span id="rrDate"></span></div>
        <div class="rr-chart" id="rrChartHost"><div class="rr-chart-el" id="rrChart"></div></div>
        <div class="rr-eq-wrap"><svg class="rr-eq" id="rrEq" viewBox="0 0 320 92" preserveAspectRatio="none" role="img" aria-label="收益走势"></svg><div class="rr-legend" id="rrLegend"></div></div>
        <p class="rr-log" id="rrLog" aria-live="polite"></p>
        <div class="rr-controls" id="rrControls">
            <button type="button" class="rr-btn rr-btn--primary" id="rrNext" data-rr-next>下一天 ▶</button>
            <button type="button" class="rr-btn" id="rrAuto" data-rr-auto>自动播放</button>
            <button type="button" class="rr-btn rr-btn--ghost" id="rrSpeed" data-rr-speed>1×</button>
            <button type="button" class="rr-btn rr-btn--ghost" data-rr-skip>跳到结尾</button>
        </div>
        <p class="rr-note">买卖由最优路线自动执行，你只管往前走。</p>
        <div class="rr-popup" id="rrPopup" hidden></div>
        <div class="rr-summary" id="rrSummary" hidden></div>
    </div>`);
    paintHoldBtn();
    initChart().then(() => {
        if (!S) return;
        step(); // arrive on day 1 (it may already be an optimal order day)
    });
}

async function initChart() {
    const host = $('rrChart');
    if (!host) return;
    try {
        const echarts = await ensureEcharts();
        if (!S) return;
        try { S.chart?.dispose(); } catch { /* ignore */ }
        S.chart = echarts.init(host);
    } catch {
        host.innerHTML = '<p class="rr-loading">K 线加载失败，请检查网络后重开</p>';
    }
}

function mineMarks(day) {
    const trips = S.data.review.mine.trips || [];
    const out = [];
    for (const t of trips) {
        if (t.buyDay <= day) out.push({ day: t.buyDay, price: t.buyPrice, text: '我买' });
        if (!t.held && t.sellDay <= day) out.push({ day: t.sellDay, price: t.sellPrice, text: '我卖' });
    }
    return out;
}

function paintChart() {
    if (!S || !S.chart) return;
    const w = S.data.window;
    const cur = Math.max(1, S.replay.cur);
    const bars = [...w.history, ...w.bars.slice(0, cur)];
    const option = buildKlineOption({
        bars,
        historyLength: w.historyLength,
        trades: S.replay.fills,
        extraMarks: mineMarks(cur),
        mode: 'game',
        maSelected: { '5日线': true, '10日线': true, '20日线': true, '30日线': true },
        resetDataZoom: true,
        showDataZoomSlider: false,
        showLegend: false,
    });
    S.chart.setOption(option, true);
    applyChartTheme(S.chart, getTheme());
}

function paintStats() {
    if (!S || !$('rrStats')) return;
    const r = S.data.review;
    const day = S.replay.cur;
    const route = curvePct(r.optimal.curve, day);
    const mine = curvePct(r.mine.curve, day);
    const hold = r.hold ? curvePct(r.hold.curve, day) : null;
    const pos = S.replay.pos === 'long' ? `持仓 ${S.replay.entry ? S.replay.entry.toFixed(2) : ''}` : '空仓';
    $('rrStats').innerHTML = `
        <div class="rr-stat rr-stat--route"><span>最优路线</span><strong class="${toneCls(route)}">${fmtPct(route)}</strong></div>
        <div class="rr-stat"><span>当前</span><strong class="rr-pos">${esc(pos)}</strong></div>
        <div class="rr-stat"><span>你当时</span><strong class="${toneCls(mine)}">${fmtPct(mine)}</strong></div>
        ${hold == null ? '' : `<div class="rr-stat rr-stat--hold"><span>一直死拿</span><strong class="${toneCls(hold)}">${fmtPct(hold)}</strong></div>`}`;
    const w = S.data.window;
    $('rrDay').textContent = `第 ${day} / ${REPLAY_DAYS} 天`;
    $('rrDate').textContent = (w.bars[day - 1] && w.bars[day - 1].date) || '';
}

function paintEquity() {
    const svg = $('rrEq');
    if (!svg || !S) return;
    const r = S.data.review;
    const curves = [r.optimal.curve, r.mine.curve, r.hold ? r.hold.curve : null];
    const { yMin, yMax } = curveRange(curves);
    const dims = { width: 320, height: 92, yMin, yMax };
    const day = S.replay.cur;
    const line = (c, cls) => (c ? `<polyline class="rr-ln ${cls}" points="${curvePoints(c, day, dims)}" fill="none"/>` : '');
    const zeroY = 6 + (1 - (1 - yMin) / (yMax - yMin)) * (92 - 12);
    svg.innerHTML = `<line class="rr-zero" x1="6" x2="314" y1="${zeroY.toFixed(1)}" y2="${zeroY.toFixed(1)}"/>${line(r.mine.curve, 'rr-ln--mine')}${line(r.hold && r.hold.curve, 'rr-ln--hold')}${line(r.optimal.curve, 'rr-ln--route')}`;
    $('rrLegend').innerHTML = `<span class="rr-lg rr-lg--route">最优路线</span><span class="rr-lg rr-lg--mine">你当时</span>${r.hold ? '<span class="rr-lg rr-lg--hold">一直死拿</span>' : ''}`;
}

function paintLog() {
    const last = S.replay.log[S.replay.log.length - 1];
    $('rrLog').textContent = last ? last.text : '点「下一天」开始。走到最优买卖点时会自动停下。';
}

function paintAll() {
    paintStats();
    paintEquity();
    paintLog();
    paintChart();
    const done = S.replay.done;
    $('rrControls').hidden = done || !!S.replay.pause;
    $('rrAuto').classList.toggle('is-on', S.auto);
    $('rrAuto').textContent = S.auto ? '暂停' : '自动播放';
    $('rrSpeed').textContent = `${S.speed}×`;
    $('rrNext').disabled = done;
    if (S.replay.pause) showPopup(S.replay.pause); else hidePopup();
    if (done) { stopAuto(); paintSummary(); } else $('rrSummary').hidden = true;
}

function showPopup(stepObj) {
    const c = popupCopy(stepObj, S.data.review.fillMode);
    const el = $('rrPopup');
    stopAutoTimer();
    el.className = `rr-popup rr-popup--${c.tone}`;
    el.innerHTML = `<div class="rr-popup-card" role="alertdialog" aria-labelledby="rrPopTitle">
        <span class="rr-pop-kicker">${esc(c.kicker)}</span>
        <h3 class="rr-pop-title" id="rrPopTitle">${esc(c.title)}</h3>
        <p class="rr-pop-sub">${esc(c.sub)}</p>
        <ul class="rr-pop-reasons">${c.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        <p class="rr-pop-foot">以上是事后视角的理由：当时的你并不知道后面会怎么走。</p>
        <button type="button" class="rr-btn rr-btn--primary rr-pop-btn" data-rr-ack>${esc(c.button)}</button>
    </div>`;
    el.hidden = false;
    const btn = el.querySelector('[data-rr-ack]');
    if (btn) btn.focus({ preventScroll: true });
}

function hidePopup() {
    const el = $('rrPopup');
    if (el) { el.hidden = true; el.innerHTML = ''; }
}

function step() {
    if (!S) return;
    S.replay = advance(S.data.review.route, S.data.review.fillMode, S.replay);
    paintAll();
    if (S.auto && !S.replay.pause && !S.replay.done) scheduleAuto();
}

function ack() {
    if (!S || !S.replay.pause) return;
    S.replay = acknowledge(S.data.review.route, S.data.review.fillMode, S.replay);
    paintAll();
    if (S.auto && !S.replay.done) scheduleAuto();
}

function stopAutoTimer() {
    if (S) window.clearTimeout(S.timer);
}

function scheduleAuto() {
    stopAutoTimer();
    S.timer = window.setTimeout(() => { if (S && S.auto) step(); }, S.speed === 2 ? 450 : 900);
}

function stopAuto() {
    if (!S) return;
    S.auto = false;
    stopAutoTimer();
}

function toggleAuto() {
    if (!S || S.replay.done || S.replay.pause) return;
    S.auto = !S.auto;
    if (S.auto) step(); else stopAutoTimer();
    paintAll();
}

function skipToEnd() {
    if (!S || S.replay.done) return;
    stopAuto();
    S.replay = runToEnd(S.data.review.route, S.data.review.fillMode, S.replay);
    paintAll();
}

/* ---------- summary ---------- */

function tripHtml(t) {
    const tags = t.tags.map((x) => `<span class="rr-tag">${esc(x)}</span>`).join('');
    const more = t.bestExitReturnPct - t.returnPct;
    const missed = more >= 1 ? `<span class="rr-trip-more">这笔最好的出场能多赚 ${more.toFixed(1)} 个点</span>` : '';
    return `<li class="rr-trip">
        <div class="rr-trip-head"><span>第 ${t.buyDay} 天买 ${t.buyPrice.toFixed(2)} → 第 ${t.sellDay} 天${t.held ? '估值' : '卖'} ${t.sellPrice.toFixed(2)}</span><strong class="${toneCls(t.returnPct)}">${fmtPct(t.returnPct)}</strong></div>
        <div class="rr-trip-tags">${tags}</div>
        ${t.notes.length ? `<p class="rr-trip-note">${esc(t.notes.join('；'))}。</p>` : ''}${missed}
    </li>`;
}

function paintSummary({ scroll = true } = {}) {
    const el = $('rrSummary');
    if (!el || !S) return;
    const r = S.data.review;
    const hold = S.data.products.find((p) => p.id === 'hold');
    const rows = gapRows(r.gap);
    const holdLine = r.hold
        ? `<div class="rr-vs"><span>一直死拿</span><strong class="${toneCls(r.hold.returnPct)}">${fmtPct(r.hold.returnPct)}</strong></div>`
        : '';
    el.innerHTML = `
        <h3 class="rr-sum-title">走完了</h3>
        <div class="rr-versus">
            <div class="rr-vs rr-vs--route"><span>最优路线</span><strong class="${toneCls(r.optimal.returnPct)}">${fmtPct(r.optimal.returnPct)}</strong></div>
            <div class="rr-vs"><span>你当时</span><strong class="${toneCls(r.mine.returnPct)}">${fmtPct(r.mine.returnPct)}</strong></div>
            ${holdLine}
        </div>
        <ul class="rr-insights">${r.insights.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        ${rows.length ? `<h4 class="rr-h">差距从哪来（共差 ${r.gap.gapPct.toFixed(2)} 个点）</h4>
        <div class="rr-gap">${rows.map((g) => `<div class="rr-gap-row"><span class="rr-gap-label">${esc(g.label)}<small>${esc(g.hint)}</small></span><span class="rr-gap-bar"><i style="width:${g.width}%"></i></span><b>${g.value.toFixed(2)}</b></div>`).join('')}</div>` : ''}
        ${r.mine.trips.length ? `<h4 class="rr-h">你的每一笔</h4><ul class="rr-trips">${r.mine.trips.map(tripHtml).join('')}</ul>` : '<p class="rr-note">你这局没有买入。</p>'}
        ${!r.hold && hold && hold.buyable ? `<div class="rr-addon"><span>想知道一直拿着不动会怎样？</span>${productBtn(hold, S.data.balance, 'data-rr-buy="hold"')}</div>` : ''}
        <div class="rr-sum-actions">
            <button type="button" class="rr-btn rr-btn--primary" data-rr-again>再看一遍</button>
            <button type="button" class="rr-btn" data-rr-close>关闭</button>
        </div>`;
    el.hidden = false;
    const sheet = $('rrBody');
    if (scroll && sheet && sheet.scrollTo) sheet.scrollTo({ top: Math.max(0, el.offsetTop - 8), behavior: 'smooth' });
}

/* ---------- events ---------- */

function onClick(e) {
    const t = e.target && e.target.closest ? e.target : null;
    if (!t || !S) return;
    if (t.closest('[data-rr-ack]')) return ack();
    if (t.closest('[data-rr-next]')) return step();
    if (t.closest('[data-rr-auto]')) return toggleAuto();
    if (t.closest('[data-rr-speed]')) { S.speed = S.speed === 1 ? 2 : 1; $('rrSpeed').textContent = `${S.speed}×`; if (S.auto && !S.replay.pause) scheduleAuto(); return; }
    if (t.closest('[data-rr-skip]')) return skipToEnd();
    if (t.closest('[data-rr-again]')) return startPlay();
    if (t.closest('[data-rr-close]')) return closeReplay();
    const b = t.closest('[data-rr-buy]');
    if (b) buy(b.getAttribute('data-rr-buy'));
}

export function initRouteReplay() {
    document.addEventListener('click', (e) => {
        const t = e.target && e.target.closest ? e.target.closest('[data-rr-open]') : null;
        if (t && entryGameId) { e.preventDefault(); openReviewReplay(entryGameId).catch(() => {}); }
    });
}
