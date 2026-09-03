// ========== THEME ==========
import { chartRefs, quizState } from './state.js';
import { applyChartTheme } from './utils.js';

if (typeof document !== 'undefined' && !document.querySelector('script[data-html2canvas]')) {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
    s.async = true;
    s.setAttribute('data-html2canvas', '1');
    document.head.appendChild(s);
}

function patchHindsightTeaserDates() {
    document.querySelectorAll('.oracle-input-mock span').forEach(el => {
        if (el.textContent && el.textContent.includes('2020-01-01')) {
            el.textContent = '2024-01-01 → 2024-06-01';
        }
    });
}
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', patchHindsightTeaserDates);
    } else {
        patchHindsightTeaserDates();
    }
}

export function toggleTheme(forced) {
    const html = document.documentElement;
    const cur = html.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const next = (forced === 'light' || forced === 'dark') ? forced : (cur === 'light' ? 'dark' : 'light');
    if (next !== cur) {
        html.setAttribute('data-theme', next);
        localStorage.setItem('theme', next);
    }
    applyChartTheme(chartRefs.klineChart);
    applyChartTheme(chartRefs.resultChart);
    quizState.charts.forEach(c => applyChartTheme(c));
}
