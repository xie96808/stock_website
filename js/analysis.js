// ========== TECHNICAL ANALYSIS ==========
import { gameState } from './state.js';
import { calculateMA } from './utils.js';
import { kbTag } from './patterns.js';

function calcMA(data, period) {
    const result = [];
    for (let i = 0; i < data.length; i++) {
        if (i < period - 1) { result.push(null); continue; }
        let sum = 0;
        for (let j = 0; j < period; j++) sum += data[i - j].close;
        result.push(sum / period);
    }
    return result;
}

function calcSlope(arr, start, end) {
    const seg = arr.slice(start, end)
        .map(v => (v != null && typeof v === 'object') ? v.close : v)
        .filter(v => v != null && typeof v === 'number');
    if (seg.length < 2) return 0;
    const n = seg.length;
    const mean = seg.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
        num += (i - (n - 1) / 2) * (seg[i] - mean);
        den += (i - (n - 1) / 2) ** 2;
    }
    return den === 0 ? 0 : (num / den) / mean;
}
