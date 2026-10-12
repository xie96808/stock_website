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

/** EMA series for closes; seeds with SMA of the first `period` closes. */
export function calculateEMA(data, period) {
    const result = new Array(data.length).fill(null);
    if (!data.length || period < 1) return result;
    const k = 2 / (period + 1);
    let sum = 0;
    const seed = Math.min(period, data.length);
    for (let i = 0; i < seed; i++) sum += data[i].close;
    let prev = roundHalfUp(sum / seed, 4);
    result[seed - 1] = prev;
    for (let i = seed; i < data.length; i++) {
        prev = roundHalfUp(data[i].close * k + prev * (1 - k), 4);
        result[i] = prev;
    }
    return result;
}

/**
 * Classic MACD(12,26,9): DIF / DEA / histogram (2×(DIF−DEA)).
 * Null until EMAs have enough bars.
 */
export function calculateMACD(data, shortPeriod = 12, longPeriod = 26, signalPeriod = 9) {
    const emaShort = calculateEMA(data, shortPeriod);
    const emaLong = calculateEMA(data, longPeriod);
    const dif = data.map((_, i) => {
        if (emaShort[i] == null || emaLong[i] == null) return null;
        return roundHalfUp(emaShort[i] - emaLong[i], 4);
    });
    const dea = new Array(data.length).fill(null);
    const hist = new Array(data.length).fill(null);
    const k = 2 / (signalPeriod + 1);
    let seeded = false;
    let prev = 0;
    let window = [];
    for (let i = 0; i < dif.length; i++) {
        if (dif[i] == null) continue;
        if (!seeded) {
            window.push(dif[i]);
            if (window.length < signalPeriod) continue;
            prev = roundHalfUp(window.reduce((a, b) => a + b, 0) / signalPeriod, 4);
            seeded = true;
            dea[i] = prev;
        } else {
            prev = roundHalfUp(dif[i] * k + prev * (1 - k), 4);
            dea[i] = prev;
        }
        hist[i] = roundHalfUp(2 * (dif[i] - dea[i]), 4);
    }
    return { dif, dea, hist };
}

