// ========== THEME ==========
import { chartRefs, quizState } from './state.js';
import { applyChartTheme } from './utils.js';

export function toggleTheme() {
    const html = document.documentElement;
    const next = (html.getAttribute('data-theme') || 'dark') === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    // Re-apply chart theme
    applyChartTheme(chartRefs.klineChart);
    applyChartTheme(chartRefs.resultChart);
    quizState.charts.forEach(c => applyChartTheme(c));
}
