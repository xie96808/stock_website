// ========== UTILITY FUNCTIONS ==========

/** Half-up round to `digits` decimal places (avoids 5.425 → 5.42 via banker's toFixed). */
export function roundHalfUp(value, digits = 2) {
    const f = 10 ** digits;
    return Math.round((Number(value) + Number.EPSILON) * f) / f;
}

/** Expanding / rounded MA for chart series (cold-start average).
 *  Analysis scoring uses calcMANullPad in analysis-pure.js instead —
 *  the two algorithms intentionally differ; do not merge without re-golden.
 */
export function calculateMA(data, period) {
    const result = [];
    for (let i = 0; i < data.length; i++) {
        // Cold start: expanding average of available bars until full period.
        const window = Math.min(period, i + 1);
        let sum = 0;
        for (let j = 0; j < window; j++) {
            sum += data[i - j].close;
        }
        result.push(roundHalfUp(sum / window, 2));
    }
    return result;
}


/** 1-based day-index labels for K-line category axis (no calendar dates on axis). */
export function buildDayIndexLabels(length) {
    const labels = new Array(length);
    for (let i = 0; i < length; i++) labels[i] = String(i + 1);
    return labels;
}

/** Chinese MA series / legend name, e.g. 5 → 「5日线」. */
export function maDayLabel(period) {
    return period + '日线';
}

export const MA_DAY_LABELS = ['5日线', '10日线', '20日线', '30日线'];

export const MA_DAY_COLORS = {
    '5日线': '#f5c542',
    '10日线': '#42a5f5',
    '20日线': '#ab47bc',
    '30日线': '#26a69a'
};

export function shuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

export function getChartColors() {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    return {
        tooltipBg: isLight ? 'rgba(255,253,248,0.96)' : 'rgba(22,22,29,0.95)',
        tooltipBorder: isLight ? 'rgba(140,120,80,0.2)' : 'rgba(200,164,78,0.2)',
        tooltipText: isLight ? '#1a1814' : '#e8e4dd',
        axisLine: isLight ? 'rgba(140,120,80,0.2)' : 'rgba(200,164,78,0.2)',
        axisLabel: isLight ? '#9a948a' : '#6b6660',
        splitLine: isLight ? 'rgba(140,120,80,0.08)' : 'rgba(200,164,78,0.06)'
    };
}

export function applyChartTheme(chart) {
    if (!chart) return;
    const tc = getChartColors();
    chart.setOption({
        tooltip: {
            backgroundColor: tc.tooltipBg,
            borderColor: tc.tooltipBorder,
            textStyle: { color: tc.tooltipText }
        },
        legend: {
            textStyle: { color: tc.axisLabel }
        },
        xAxis: [
            { axisLine: { lineStyle: { color: tc.axisLine } } },
            { axisLine: { lineStyle: { color: tc.axisLine } }, axisLabel: { color: tc.axisLabel } }
        ],
        yAxis: [
            { scale: true, axisLabel: { color: tc.axisLabel }, splitLine: { lineStyle: { color: tc.splitLine } } },
            { scale: true }
        ]
    });
}
