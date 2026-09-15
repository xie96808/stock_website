// ========== RESULT SCREEN ==========
import { chartRefs } from './state.js';
import { getSession, selectSettleView } from './game-session.js';
import { applyChartTheme, onThemeChange, getTheme } from './theme.js';
import { buildKlineOption } from './kline-option.js';
import { generateBSReport, generateBestPoints, generateKlineAnalysis } from './analysis.js';
import { calcGrade } from './analysis-pure.js';
import { finishCloudGame, updateSaveStatusUi } from './game-sync.js';
import { persistSettledCloudGame, shouldPersistCloudSettle } from './game-play-usecase.js';
import {
    showPuzzleSettleModal,
    paintPuzzleResultDebrief,
    clearPuzzleResultDebrief,
} from './puzzle-settle-modal.js';
import { formatPuzzleDebrief } from './puzzle-debrief-copy.js';
import { renderStarIcons } from './puzzle-settle-copy.js';
import { showToast } from './auth.js';
import { Route, prepareScreen, activateScreen } from './screen-router.js';
import {
    clearShareRankMeta,
    refreshShareRankMeta,
    updateShareRankHint,
    saveResultShareImage,
    copyResultShareText,
    openResultLeaderboard,
} from './result-share.js';
import {
    ensureEcharts,
    markChartLoading,
    clearChartLoading,
    markChartFailed,
} from './echarts-loader.js';

onThemeChange((theme) => {
    applyChartTheme(chartRefs.resultChart, theme);
});

export { saveResultShareImage, copyResultShareText, openResultLeaderboard };

/** Paint result hero for puzzle: icon stars +「残局结算」(no giant digit). */
function paintPuzzleGradeHero({ stars, pending, reward }) {
    const medalEl = document.getElementById('gradeMedal');
    const letter = document.getElementById('gradeLetter');
    const titleEl = document.getElementById('gradeTitle');
    const verdictEl = document.getElementById('gradeVerdict');
    const starInfo = renderStarIcons(pending ? null : stars, {
        pending: !!pending,
        className: 'puzzle-stars puzzle-stars--hero',
    });
    if (medalEl) {
        medalEl.className = 'grade-medal grade-medal--puzzle' +
            (starInfo.starN != null && starInfo.starN >= 3 ? ' is-three' : '') +
            (pending ? ' is-pending' : '');
    }
    if (letter) {
        letter.className = 'grade-medal__letter grade-medal__stars';
        letter.innerHTML = starInfo.html;
        letter.setAttribute('aria-label', starInfo.ariaLabel);
    }
    if (titleEl) titleEl.textContent = pending ? '残局结算中' : '残局结算';
    if (verdictEl) {
        if (pending) {
            verdictEl.textContent = '正在保存进度…';
        } else if (reward?.grantedThisTime) {
            verdictEl.textContent = `首通奖励 +${reward.amount} 韭币`;
        } else if (reward?.alreadyClaimed) {
            verdictEl.textContent = '本关首通韭币已领过';
        } else if (stars != null && stars < 2) {
            verdictEl.textContent = '未达二星：首通韭币需 ≥二星';
        } else {
            verdictEl.textContent = '短窗残局 · 不计入经典榜';
        }
    }
}


/**
 * Result view: paint settle chrome / share / review.
 * Cloud persist goes through persistSettledCloudGame (use-case boundary) → finishCloudGame HTTP.
 */
export function endGame() {
    // Settlement P&L / valuation already applied by finishSettle() via shared engine.
    // Do not invent a day-30 sell fill here.

    prepareScreen(Route.RESULT);
    activateScreen(Route.RESULT);

    const view = selectSettleView();

    document.getElementById('stockReveal').textContent =
        `${view.currentStock.name} (${view.currentStock.code})`;

    // Date range covers the game window only (classic 30 / puzzle short).
    const histLen = view.historyLength;
    const gameDays = view.gameDays || 30;
    const startBar = view.gameKline[histLen];
    const endBar = view.gameKline[histLen + gameDays - 1];
    document.getElementById('dateRange').textContent =
        `${startBar?.date || '--'} ~ ${endBar?.date || '--'}`;

    const fillModeEl = document.getElementById('fillModeLabel');
    if (fillModeEl) {
        fillModeEl.textContent = view.fillMode === 'same_close'
            ? '成交：当日收盘'
            : '成交：次日开盘';
    }

    const assistEl = document.getElementById('assistClassLabel');
    if (assistEl) {
        if (view.gameKind === 'oneshot') {
            assistEl.hidden = false;
            assistEl.textContent = '玩法：一把梭';
        } else if (view.gameKind === 'survival') {
            assistEl.hidden = false;
            assistEl.textContent = view.busted ? '玩法：活过三十日 · 爆仓日' : '玩法：活过三十日 · 活穿';
        } else if (view.gameKind === 'daily') {
            assistEl.hidden = false;
            assistEl.textContent = '玩法：今日挑战';
        } else {
            const a = view.assistClass;
            if (a === 'undo') {
                assistEl.hidden = false;
                assistEl.textContent = '辅助：反悔局';
            } else if (a === 'clean') {
                assistEl.hidden = false;
                assistEl.textContent = '辅助：纯净局';
            } else if (a === 'legacy') {
                assistEl.hidden = false;
                assistEl.textContent = '辅助：旧协议局';
            } else {
                assistEl.hidden = true;
                assistEl.textContent = '';
            }
        }
    }

    // F02 puzzle: icon stars +「残局结算」header (no giant digit / letter grade).
    if (view.gameKind === 'puzzle') {
        const stars = view.puzzleResult?.stars;
        const pendingStars = stars == null;
        paintPuzzleGradeHero({
            stars,
            pending: pendingStars,
            reward: view.puzzleResult?.reward,
        });
        const lbBtn = document.getElementById('resultLeaderboardBtn');
        if (lbBtn) lbBtn.hidden = true;
        const playBtn = document.querySelector('#resultScreen .play-again-btn');
        if (playBtn && playBtn.getAttribute('onclick') === 'playAgain()') {
            playBtn.textContent = '返回残局列表';
        }
        // Celebration / reward layer on top of full result screen + 残局复盘.
        const debriefInput = {
            status: pendingStars ? 'pending' : 'ok',
            puzzleResult: view.puzzleResult || null,
            theme: view.puzzleTheme || null,
            teachingBrief: view.puzzleTeachingBrief || null,
            openStateHint: view.puzzleOpenStateHint || null,
            initialState: view.initialState || null,
            maxOrders: view.maxOrders ?? null,
            tradeHistory: view.tradeHistory || [],
            gameDays: view.gameDays || null,
        };
        showPuzzleSettleModal(debriefInput);
        paintPuzzleResultDebrief(formatPuzzleDebrief(debriefInput));
    } else {
        clearPuzzleResultDebrief();
        const lbBtn = document.getElementById('resultLeaderboardBtn');
        if (lbBtn) {
            // Oneshot: no public board yet. Daily: open day-board modal (same as L3「查看日榜」).
            if (view.gameKind === 'oneshot' || view.gameKind === 'survival') {
                lbBtn.hidden = true;
                lbBtn.textContent = '查看排行榜';
            } else if (view.gameKind === 'daily') {
                lbBtn.hidden = false;
                lbBtn.textContent = '查看日榜';
            } else {
                lbBtn.hidden = false;
                lbBtn.textContent = '查看排行榜';
            }
        }
        const playBtn = document.querySelector('#resultScreen .play-again-btn');
        if (playBtn && playBtn.textContent.includes('残局')) {
            playBtn.textContent = '再来一局';
        }
        if (playBtn && view.gameKind === 'oneshot') {
            playBtn.textContent = '再来一把梭';
        } else if (playBtn && view.gameKind === 'survival') {
            playBtn.textContent = '再来生存模式';
        } else if (playBtn && (playBtn.textContent === '再来一把梭' || playBtn.textContent === '再来生存模式')) {
            playBtn.textContent = '再来一局';
        }
    }

        const finalReturnPercent = view.returnPct != null
        ? parseFloat(view.returnPct)
        : (view.totalReturn - 1) * 100;
    const finalReturnEl = document.getElementById('finalReturn');
    const pctStr = view.returnPct != null
        ? ((parseFloat(view.returnPct) >= 0 ? '+' : '') + view.returnPct)
        : ((finalReturnPercent >= 0 ? '+' : '') + finalReturnPercent.toFixed(2));
    finalReturnEl.textContent = pctStr + '%';
    finalReturnEl.className = 'final-return ' +
        (finalReturnPercent > 0 ? 'positive' : finalReturnPercent < 0 ? 'negative' : 'zero');

    document.getElementById('finalTradeCount').textContent = view.tradeHistory.length;
    document.getElementById('holdingDays').textContent = view.holdingDays;

    const maxGain = view.tradeGains.length > 0 ?
        Math.max(...view.tradeGains) : 0;
    document.getElementById('maxGain').textContent =
        (maxGain >= 0 ? '+' : '') + maxGain.toFixed(2) + '%';

    document.getElementById('resultChartSubtitle').textContent =
        `${view.currentStock.name} (${view.currentStock.code})`;

    // Isolate classic analysis so a short-window BS crash can never block
    // chart draw / kline copy / cloud puzzle finish (progress + stars).
    const runResultStep = (label, fn) => {
        try {
            fn();
        } catch (err) {
            console.error(`[endGame] ${label} failed`, err);
        }
    };
    const settledEarly = selectSettleView();
    const isPuzzle = settledEarly.gameKind === 'puzzle';
    if (!isPuzzle) {
        runResultStep('generateBSReport', () => generateBSReport());
        runResultStep('generateBestPoints', () => generateBestPoints());
        runResultStep('generateKlineAnalysis', () => generateKlineAnalysis());
    } else {
        // Short-window puzzle: keep K-line; classic BS / 波段分析 replaced by 残局复盘.
        const bsEl = document.getElementById('bsReport');
        if (bsEl) {
            bsEl.hidden = true;
            bsEl.innerHTML = '';
        }
        const ka = document.getElementById('klineAnalysis');
        if (ka) {
            ka.hidden = true;
            ka.innerHTML = '';
        }
    }
    runResultStep('drawResultChart', () => {
        void drawResultChart().catch((err) => console.error('[endGame] drawResultChart failed', err));
    });

    // BS score written by generateBSReport — re-read live session.
    // Puzzle already painted 星级 copy above; do not overwrite with classic letter grade.
    const settled = selectSettleView();
    if (settled.gameKind !== 'puzzle') {
        const grade = calcGrade(finalReturnPercent, settled.bsScore);
        const medalEl = document.getElementById('gradeMedal');
        if (medalEl) {
            medalEl.className = 'grade-medal ' + grade.cls;
            const letterEl = document.getElementById('gradeLetter');
            if (letterEl) {
                letterEl.className = 'grade-medal__letter';
                letterEl.textContent = grade.letter;
                letterEl.removeAttribute('aria-label');
            }
        }
        const titleEl = document.getElementById('gradeTitle');
        if (titleEl) {
            titleEl.textContent = settled.gameKind === 'survival'
                ? (settled.busted ? '爆仓日' : '活穿')
                : `${grade.letter}级 · ${grade.title}`;
        }
        const verdictEl = document.getElementById('gradeVerdict');
        if (verdictEl) {
            if (settled.gameKind === 'survival') {
                verdictEl.textContent = settled.busted
                    ? '爆仓日：相对开局净值触及 −20%，本局强制结束。'
                    : '活穿：撑过三十个交易日，未触及 −20% 爆仓线。';
            } else {
                verdictEl.textContent = grade.verdict;
            }
        }
    }

    const bsDisplayEl = document.getElementById('bsScoreDisplay');
    if (bsDisplayEl) {
        bsDisplayEl.textContent =
            settled.gameKind === 'puzzle'
                ? '--'
                : (settled.bsScore != null ? settled.bsScore : '--');
    }

    updateSaveStatusUi();
    clearShareRankMeta();
    updateShareRankHint();
    if (shouldPersistCloudSettle(settled)) {
        // Single settle→persist hook (use-case); HTTP/retry remain in game-sync.
        persistSettledCloudGame({ finishCloud: finishCloudGame }).then(async (res) => {
            // Refresh return display from authoritative server result if present.
            const live = getSession();
            const finalReturnEl = document.getElementById('finalReturn');
            if (finalReturnEl && live.returnPct != null) {
                const finalReturnPercent = parseFloat(live.returnPct);
                const pctStr = (finalReturnPercent >= 0 ? '+' : '') + live.returnPct;
                finalReturnEl.textContent = pctStr + '%';
                finalReturnEl.className = 'final-return ' +
                    (finalReturnPercent > 0 ? 'positive' : finalReturnPercent < 0 ? 'negative' : 'zero');
            }
            if (live.gameKind === 'puzzle') {
                if (live.puzzleResult) {
                    const stars = live.puzzleResult.stars;
                    paintPuzzleGradeHero({
                        stars,
                        pending: false,
                        reward: live.puzzleResult.reward,
                    });
                    const pr = live.puzzleResult;
                    showPuzzleSettleModal({
                        status: 'ok',
                        puzzleResult: pr,
                        theme: pr?.theme || live.puzzleTheme || null,
                        teachingBrief: pr?.teachingBrief || live.puzzleTeachingBrief || null,
                        openStateHint: pr?.openStateHint || live.puzzleOpenStateHint || null,
                        initialState: live.initialState || null,
                        maxOrders: live.maxOrders ?? null,
                        tradeHistory: live.tradeHistory || [],
                        gameDays: live.gameDays || null,
                    });
                } else if (!res) {
                    const err = live.saveError || '保存失败';
                    showPuzzleSettleModal({
                        status: 'fail',
                        saveError: err,
                        theme: live.puzzleTheme || null,
                        teachingBrief: live.puzzleTeachingBrief || null,
                        openStateHint: live.puzzleOpenStateHint || null,
                        initialState: live.initialState || null,
                        maxOrders: live.maxOrders ?? null,
                        tradeHistory: live.tradeHistory || [],
                        gameDays: live.gameDays || null,
                    });
                    try { showToast('残局进度保存失败：' + err, 'error'); } catch (_) {}
                }
            }
            updateSaveStatusUi();
            if (res && live.gameKind !== 'puzzle') await refreshShareRankMeta();
            updateShareRankHint();
        }).catch(() => {
            const live = getSession();
            if (live.gameKind === 'puzzle' && !live.puzzleResult) {
                const err = live.saveError || '保存失败';
                showPuzzleSettleModal({
                    status: 'fail',
                    saveError: err,
                    theme: live.puzzleTheme || null,
                    teachingBrief: live.puzzleTeachingBrief || null,
                    openStateHint: live.puzzleOpenStateHint || null,
                    initialState: live.initialState || null,
                    maxOrders: live.maxOrders ?? null,
                    tradeHistory: live.tradeHistory || [],
                    gameDays: live.gameDays || null,
                });
                try { showToast('残局进度保存失败：' + err, 'error'); } catch (_) {}
            }
            updateSaveStatusUi();
            updateShareRankHint();
        });
    }
}

export async function drawResultChart() {
    const chartDom = document.getElementById('result-kline-chart');
    if (!chartDom) return;

    markChartLoading(chartDom);
    let echartsApi;
    try {
        echartsApi = await ensureEcharts();
    } catch (err) {
        console.error('ECharts unavailable for result chart', err);
        markChartFailed(chartDom, '结算图加载失败，请检查网络后刷新');
        return;
    }
    clearChartLoading(chartDom);

    if (chartRefs.resultChart) {
        chartRefs.resultChart.dispose();
    }
    chartRefs.resultChart = echartsApi.init(chartDom);

    const view = selectSettleView();
    const histLen = view.historyLength;
    const fullData = view.gameKline.slice(0, histLen + (view.gameDays || 30)); // history + game window

    const option = buildKlineOption({
        bars: fullData,
        historyLength: histLen,
        trades: view.tradeHistory,
        bestPoints: view.bestPoints || { buys: [], sells: [] },
        valuation: view.valuation || null,
        mode: 'result',
    });

    // Keep settlement copy/UI responsive; paint chart next frame.
    requestAnimationFrame(function () {
        if (!chartRefs.resultChart) return;
        chartRefs.resultChart.setOption(option);
        applyChartTheme(chartRefs.resultChart, getTheme());
        buildPointNavigator(chartRefs.resultChart, histLen, fullData);
    });
}

export function buildPointNavigator(chart, histLen, fullData) {
    const nav = document.getElementById('pointNavigator');
    nav.innerHTML = '';

    const view = selectSettleView();
    const bp = view.bestPoints || { buys: [], sells: [] };
    const trades = view.tradeHistory || [];
    const allPoints = [];

    bp.buys.forEach((p, idx) => {
        allPoints.push({ day: p.day, label: '信号买' + (idx + 1), type: 'best-buy', date: p.date, price: p.price, reasons: p.reasons });
    });
    bp.sells.forEach((p, idx) => {
        allPoints.push({ day: p.day, label: '信号卖' + (idx + 1), type: 'best-sell', date: p.date, price: p.price, reasons: p.reasons });
    });
    trades.forEach((t, idx) => {
        const dayData = fullData[histLen + t.day - 1];
        if (!dayData) return;
        allPoints.push({
            day: t.day,
            label: t.type === 'buy' ? '买入' + (idx + 1) : '卖出' + (idx + 1),
            type: t.type === 'buy' ? 'user-buy' : 'user-sell',
            date: dayData ? dayData.date : '',
            price: t.price,
            reasons: null,
            tradeReturn: t.return
        });
    });
    if (view.valuation) {
        const v = view.valuation;
        const dayData = fullData[histLen + v.day - 1];
        allPoints.push({
            day: v.day,
            label: '期末估值',
            type: 'user-valuation',
            date: dayData ? dayData.date : '',
            price: v.price,
            reasons: null,
            tradeReturn: v.multiple
        });
    }
    allPoints.sort((a, b) => a.day - b.day);
    if (allPoints.length === 0) return;

    const strip = document.createElement('div');
    strip.className = 'point-nav-strip';
    const detail = document.createElement('div');
    detail.className = 'point-nav-detail';
    let activeIdx = -1;

    allPoints.forEach((pt, i) => {
        const badge = document.createElement('span');
        badge.className = 'point-nav-badge ' + pt.type;
        badge.textContent = pt.label;
        badge.setAttribute('data-idx', i);
        badge.addEventListener('click', () => {
            if (activeIdx === i) {
                detail.classList.remove('open');
                badge.classList.remove('active');
                activeIdx = -1;
                chart.dispatchAction({ type: 'downplay', seriesIndex: 0 });
                return;
            }
            const prev = strip.querySelector('.point-nav-badge.active');
            if (prev) prev.classList.remove('active');
            badge.classList.add('active');
            activeIdx = i;
            let html = '<div class="detail-header">';
            html += `<span class="point-badge ${pt.type.includes('buy') ? 'buy' : (pt.type.includes('valuation') ? 'valuation' : 'sell')}">${pt.label}</span>`;
            html += `<span class="detail-day">第 ${pt.day} 天（${pt.date}）</span>`;
            html += `<span class="detail-price">价格 ${pt.price.toFixed(2)}</span>`;
            html += '</div>';
            if (pt.reasons) {
                html += '<div class="detail-reasons">';
                html += pt.reasons.map(r => `<span class="point-reason-tag">${r.tag}</span>${r.text}`).join('<br>');
                html += '</div>';
            } else {
                html += '<div class="detail-user-info">';
                if (pt.type === 'user-valuation') {
                html += `<div class="point-detail">未平仓按第 30 日收盘做<em>期末估值</em>（不计卖出成交）`;
                if (pt.tradeReturn) {
                    const retPct = ((pt.tradeReturn - 1) * 100).toFixed(2);
                    const cls = parseFloat(retPct) >= 0 ? 'positive' : 'negative';
                    html += `，浮动 <span style="color:var(--${cls});font-weight:700">${parseFloat(retPct) >= 0 ? '+' : ''}${retPct}%</span>`;
                }
                html += `</div>`;
            } else if (pt.type === 'user-buy') {

                    html += `你在第 ${pt.day} 天以 ${pt.price.toFixed(2)} 买入`;
                } else {
                    const retPct = pt.tradeReturn ? ((pt.tradeReturn - 1) * 100).toFixed(2) : null;
                    html += `你在第 ${pt.day} 天以 ${pt.price.toFixed(2)} 卖出`;
                    if (retPct !== null) {
                        const cls = parseFloat(retPct) >= 0 ? 'gain-color' : 'loss-color';
                        html += `，本次收益 <span style="color:var(--${cls});font-weight:700">${parseFloat(retPct) >= 0 ? '+' : ''}${retPct}%</span>`;
                    }
                }
                html += '</div>';
            }
            detail.innerHTML = html;
            detail.classList.add('open');
            chart.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: histLen + pt.day - 1 });
        });
        strip.appendChild(badge);
    });
    nav.appendChild(strip);
    nav.appendChild(detail);
}

export function resetGame() {
    if (typeof window.showHome === 'function') {
        window.showHome();
    } else {
        prepareScreen(Route.HOME);
    }
    const tagsEl = document.getElementById('waveAnalysisTags');
    if (tagsEl) tagsEl.innerHTML = '';
    const textEl = document.getElementById('waveAnalysisText');
    if (textEl) textEl.textContent = '暂无分析数据，随着行情展开将自动生成。';
}

export function playAgain() {
    const session = getSession();
    if (session.gameKind === 'puzzle') {
        if (typeof window.restoreSimShell === 'function') {
            window.restoreSimShell();
        } else {
            resetGame();
        }
        // Re-open chapter-1 level list (not L3 chapter picker).
        if (typeof window.showPuzzleScreen === 'function') {
            setTimeout(() => window.showPuzzleScreen(), 0);
        }
        return;
    }
    if (session.gameKind === 'survival' && typeof window.startSurvivalGame === 'function') {
        window.startSurvivalGame();
        return;
    }
    if (session.gameKind === 'oneshot' && typeof window.startOneshotGame === 'function') {
        window.startOneshotGame();
        return;
    }
    if (session.gameKind === 'daily' && typeof window.showPlayModes === 'function') {
        window.showPlayModes();
        return;
    }
    if (typeof window.startGame === "function") {
        window.startGame();
        return;
    }
    resetGame();
}
