// ========== UTILITY FUNCTIONS ==========

export function calculateMA(data, period) {
    const result = [];
    for (let i = 0; i < data.length; i++) {
        if (i < period - 1) {
            result.push(null);
        } else {
            let sum = 0;
            for (let j = 0; j < period; j++) {
                sum += data[i - j].close;
            }
            result.push(parseFloat((sum / period).toFixed(2)));
        }
    }
    return result;
}

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
