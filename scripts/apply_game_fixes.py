#!/usr/bin/env python3
from pathlib import Path

ROOT = Path('.')


def patch(path, replacements):
    p = Path(path)
    s = p.read_text()
    for old, new, label in replacements:
        if old not in s:
            raise SystemExit(f'missing snippet in {path}: {label}')
        s = s.replace(old, new, 1)
    p.write_text(s)
    print('patched', path)


patch('js/game.js', [
    (
        "if (action === 'sell' && gameState.position !== 'holding') return;",
        "if (action === 'sell' && gameState.position === 'empty') return;",
        'sell-guard',
    ),
    (
        "gameState.position = 'locked'; // T+1: can't sell on fill day",
        "gameState.position = 'locked'; // T+1: filled today; sell may be queued for next open",
        'locked-comment',
    ),
    (
        "document.getElementById('currentPrice').textContent = todayData.close.toFixed(2);",
        """document.getElementById('currentPrice').textContent = todayData.close.toFixed(2);

    const prevIdx = histLen + gameState.currentDay - 2;
    const prevData = prevIdx >= 0 ? gameState.gameKline[prevIdx] : null;
    let dailyPct = null;
    if (prevData && prevData.close > 0) {
        dailyPct = (todayData.close / prevData.close - 1) * 100;
    } else if (todayData.open > 0) {
        dailyPct = (todayData.close / todayData.open - 1) * 100;
    }
    const dailyEl = document.getElementById('dailyReturn');
    if (dailyEl) {
        if (dailyPct == null) {
            dailyEl.textContent = '--';
            dailyEl.className = 'meta-value neutral';
        } else {
            dailyEl.textContent = (dailyPct >= 0 ? '+' : '') + dailyPct.toFixed(2) + '%';
            dailyEl.className = 'meta-value ' + (dailyPct > 0 ? 'positive' : dailyPct < 0 ? 'negative' : 'neutral');
        }
    }""",
        'daily-return',
    ),
    (
        "// Buttons — no buy on last shown decision day; no sell on T+1 fill day",
        "// Buttons — no buy on last shown decision day; sell allowed while locked (queue for next open)",
        'btn-comment',
    ),
    (
        "if (sellBtn) sellBtn.disabled = gameState.position !== 'holding';",
        "if (sellBtn) sellBtn.disabled = gameState.position === 'empty';",
        'sell-btn',
    ),
    (
        "hintEl.textContent = '最后交易日 · T+1 锁定，持仓将于次日开盘结算';",
        "hintEl.textContent = '最后交易日 · 可挂卖单，次日开盘成交；或持有至次日开盘结算';",
        'last-day-hint',
    ),
    (
        "hintEl.textContent = 'T+1 锁定中，今日只能持仓观望';",
        "hintEl.textContent = 'T+1 锁定中，今日可挂卖单，将于次日开盘成交';",
        'lock-hint',
    ),
])

patch('js/result.js', [
    (
        """    document.getElementById('resultScreen').classList.remove('active');
    document.getElementById('startScreen').style.display = 'flex';""",
        """    document.getElementById('resultScreen').classList.remove('active');
    document.getElementById('gameScreen').classList.remove('active');
    document.getElementById('startScreen').style.display = 'flex';""",
        'hide-game',
    ),
    (
        "label: '荐买' + (idx + 1)",
        "label: '信号买' + (idx + 1)",
        'label-buy',
    ),
    (
        "label: '荐卖' + (idx + 1)",
        "label: '信号卖' + (idx + 1)",
        'label-sell',
    ),
])

text = Path('js/result.js').read_text()
if 'export function playAgain()' not in text:
    Path('js/result.js').write_text(text.rstrip() + """

export function playAgain() {
    if (typeof window.startGame === \"function\") {
        window.startGame();
        return;
    }
    resetGame();
}
""")
    print('appended playAgain')

patch('js/analysis.js', [
    (
        "        for (let j = i + 2; j < gameDays; j++) {",
        "        for (let j = i + 1; j < gameDays; j++) {",
        't1-window',
    ),
    (
        "    const volumes = gameData.map(d => d.volume);\n    const avgVol = volumes.reduce((a, b) => a + b, 0) / gameDays;\n",
        "    const volumes = gameData.map(d => d.volume);\n",
        'drop-future-avgvol',
    ),
    (
        "        // 4. Volume breakout\n        if (volumes[i] > avgVol * 1.8 && d.close > d.open) {",
        """        // 4. Volume breakout vs trailing 10-day average (no future peek)
        const volTrail = volumes.slice(Math.max(0, i - 10), i);
        const avgVol = volTrail.length ? volTrail.reduce((a, b) => a + b, 0) / volTrail.length : 0;
        if (avgVol > 0 && volumes[i] > avgVol * 1.8 && d.close > d.open) {""",
        'vol-buy',
    ),
    (
        "        if (volumes[i] > avgVol * 1.8 && d.close < d.open) {",
        "        if (avgVol > 0 && volumes[i] > avgVol * 1.8 && d.close < d.open) {",
        'vol-sell',
    ),
    (
        """    buyScores.sort((a, b) => b.score - a.score);
    sellScores.sort((a, b) => b.score - a.score);

    const topBuys = buyScores.slice(0, 3);
    const topSells = sellScores.slice(0, 3);

    gameState.bestPoints = { buys: topBuys, sells: topSells };
}""",
        """    function pickSignals(items) {
        const qualified = items.filter(x => x.score >= 4)
            .sort((a, b) => b.score - a.score || a.day - b.day);
        const picked = [];
        for (const it of qualified) {
            if (picked.some(p => Math.abs(p.day - it.day) < 3)) continue;
            picked.push(it);
            if (picked.length >= 3) break;
        }
        picked.sort((a, b) => a.day - b.day);
        return picked;
    }

    gameState.bestPoints = { buys: pickSignals(buyScores), sells: pickSignals(sellScores) };
}""",
        'pick-signals',
    ),
    (
        """        <div class=\"analysis-text\">${analysis}</div>
    `;
}""",
        """        <div class=\"analysis-text\">${analysis}</div>
    `;

    const bp = gameState.bestPoints || { buys: [], sells: [] };
    const analysisEl = document.getElementById('klineAnalysis');
    if (analysisEl) {
        const renderPt = (p, kind) => {
            const tags = (p.reasons || []).map(r => `<span class=\"point-reason-tag\">${r.tag}</span>`).join('');
            const why = (p.reasons || []).map(r => r.text).join('；');
            return `<div class=\"best-point-card\">
                <div class=\"point-header\">
                    <span class=\"point-badge ${kind}\">${kind === 'buy' ? '信号买' : '信号卖'}</span>
                    <span class=\"point-day\">第 ${p.day} 天（${p.date}）</span>
                    <span class=\"point-price\">${p.price.toFixed(2)}</span>
                </div>
                <div class=\"point-reason\">${tags} ${why}</div>
            </div>`;
        };
        let extra = '<div class=\"analysis-title\">当时信号</div>';
        extra += '<div class=\"analysis-text\"><p>只用当日及以前的均线、量价、形态，不偷看后续行情。分数达到阈值后按强度选取，同类信号至少间隔 3 个交易日，最多各 3 个。</p></div>';
        if (bp.buys.length === 0 && bp.sells.length === 0) {
            extra += '<div class=\"analysis-text\"><p>本局没有足够强的当时信号。</p></div>';
        } else {
            extra += bp.buys.map(p => renderPt(p, 'buy')).join('');
            extra += bp.sells.map(p => renderPt(p, 'sell')).join('');
        }
        analysisEl.insertAdjacentHTML('beforeend', extra);
    }
}""",
        'signal-html',
    ),
])

patch('index.html', [
    (
        """                        <div class=\"meta-card\">
                            <div class=\"meta-label\">当前价</div>
                            <div class=\"meta-value neutral\" id=\"currentPrice\">--</div>
                        </div>
                        <div class=\"meta-card\">
                            <div class=\"meta-label\">累计收益</div>""",
        """                        <div class=\"meta-card\">
                            <div class=\"meta-label\">当前价</div>
                            <div class=\"meta-value neutral\" id=\"currentPrice\">--</div>
                        </div>
                        <div class=\"meta-card\">
                            <div class=\"meta-label\">当日涨跌</div>
                            <div class=\"meta-value neutral\" id=\"dailyReturn\">--</div>
                        </div>
                        <div class=\"meta-card\">
                            <div class=\"meta-label\">累计收益</div>""",
        'daily-card',
    ),
    (
        '<button class=\"play-again-btn\" onclick=\"resetGame()\">再来一局</button>',
        """<div class=\"result-actions\">
                        <button class=\"play-again-btn\" onclick=\"playAgain()\">再来一局</button>
                        <button class=\"play-again-btn play-again-btn--ghost\" onclick=\"resetGame()\">返回首页</button>
                    </div>""",
        'home-btn',
    ),
    (
        "import { resetGame } from './js/result.js';",
        "import { resetGame, playAgain } from './js/result.js';",
        'import-playagain',
    ),
    (
        "window.resetGame = resetGame;",
        "window.resetGame = resetGame;\n        window.playAgain = playAgain;",
        'window-playagain',
    ),
])

css = Path('css/result.css')
s = css.read_text()
if '.result-actions' not in s:
    css.write_text(s + """

.result-actions {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    margin-top: 8px;
}

.result-actions .play-again-btn {
    margin-top: 12px;
}

.play-again-btn--ghost {
    background: transparent;
    color: #c8a44e;
    border: 1px solid rgba(200, 164, 78, 0.55);
    box-shadow: none;
}

.play-again-btn--ghost:hover {
    background: rgba(200, 164, 78, 0.12);
    box-shadow: 0 8px 32px rgba(200, 164, 78, 0.15);
}
""")
    print('patched css/result.css')

print('all patches ok')
