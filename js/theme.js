// ========== THEME (纸 / 墨) — single owner ==========
// Owns: preference persistence, documentElement data-theme, change notification,
// and chart color tokens. Consumers call getTheme() / onThemeChange / applyChartTheme
// — they must not scrape DOM or re-read localStorage ad hoc.

export const THEME_STORAGE_KEY = 'theme';
export const THEME_LIGHT = 'light';
export const THEME_DARK = 'dark';

const listeners = new Set();

/** @type {{ document?: Document | null, localStorage?: Storage | null }} */
let deps = {
    document: typeof document !== 'undefined' ? document : null,
    localStorage: typeof localStorage !== 'undefined' ? localStorage : null,
};

/** Test-only: inject document / localStorage doubles. */
export function __setThemeDepsForTests(next = {}) {
    if ('document' in next) deps.document = next.document;
    if ('localStorage' in next) deps.localStorage = next.localStorage;
}

/** Test-only: clear listeners and restore default deps. */
export function __resetThemeForTests() {
    listeners.clear();
    deps = {
        document: typeof document !== 'undefined' ? document : null,
        localStorage: typeof localStorage !== 'undefined' ? localStorage : null,
    };
}

/** Normalize any value to 'light' | 'dark' (default light). */
export function normalizeTheme(value) {
    return value === THEME_DARK ? THEME_DARK : THEME_LIGHT;
}

/**
 * Read current theme. Prefers live documentElement[data-theme], then storage.
 * Does not write.
 */
export function getTheme() {
    const doc = deps.document;
    if (doc && doc.documentElement) {
        const attr = doc.documentElement.getAttribute('data-theme');
        if (attr === THEME_LIGHT || attr === THEME_DARK) return attr;
    }
    const store = deps.localStorage;
    if (store) {
        try {
            return normalizeTheme(store.getItem(THEME_STORAGE_KEY));
        } catch {
            /* ignore quota / private mode */
        }
    }
    return THEME_LIGHT;
}

/**
 * Write theme to DOM + localStorage and notify subscribers when it changes.
 * @param {'light'|'dark'|string} next
 * @returns {'light'|'dark'} applied theme
 */
export function setTheme(next) {
    const theme = normalizeTheme(next);
    const prev = getTheme();
    const doc = deps.document;
    if (doc && doc.documentElement) {
        doc.documentElement.setAttribute('data-theme', theme);
    }
    const store = deps.localStorage;
    if (store) {
        try {
            store.setItem(THEME_STORAGE_KEY, theme);
        } catch {
            /* ignore */
        }
    }
    if (theme !== prev) {
        for (const fn of [...listeners]) {
            try {
                fn(theme, prev);
            } catch (err) {
                console.error('onThemeChange listener failed', err);
            }
        }
    }
    return theme;
}

/**
 * Toggle 纸/墨. Optional forced 'light' | 'dark' (pill buttons).
 * Same as setTheme when forced; otherwise flips current.
 */
export function toggleTheme(forced) {
    const cur = getTheme();
    const next =
        forced === THEME_LIGHT || forced === THEME_DARK
            ? forced
            : cur === THEME_LIGHT
              ? THEME_DARK
              : THEME_LIGHT;
    return setTheme(next);
}

/**
 * Subscribe to theme changes. Listener receives (next, prev).
 * @returns {() => void} unsubscribe
 */
export function onThemeChange(listener) {
    if (typeof listener !== 'function') {
        throw new TypeError('onThemeChange listener must be a function');
    }
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** Chart chrome colors for the given (or current) theme. */
export function getChartColors(theme = getTheme()) {
    const isLight = normalizeTheme(theme) === THEME_LIGHT;
    return {
        tooltipBg: isLight ? 'rgba(255,253,248,0.96)' : 'rgba(22,22,29,0.95)',
        tooltipBorder: isLight ? 'rgba(140,120,80,0.2)' : 'rgba(200,164,78,0.2)',
        tooltipText: isLight ? '#1a1814' : '#e8e4dd',
        axisLine: isLight ? 'rgba(140,120,80,0.2)' : 'rgba(200,164,78,0.2)',
        axisLabel: isLight ? '#9a948a' : '#6b6660',
        splitLine: isLight ? 'rgba(140,120,80,0.08)' : 'rgba(200,164,78,0.06)',
    };
}

/**
 * Apply chart tooltip / axis tokens for the given (or current) theme.
 * Callers pass an explicit theme when they already have one from getTheme().
 */
export function applyChartTheme(chart, theme = getTheme()) {
    if (!chart) return;
    const tc = getChartColors(theme);
    chart.setOption({
        tooltip: {
            backgroundColor: tc.tooltipBg,
            borderColor: tc.tooltipBorder,
            textStyle: { color: tc.tooltipText },
        },
        legend: {
            textStyle: { color: tc.axisLabel },
        },
        xAxis: [
            { axisLine: { lineStyle: { color: tc.axisLine } } },
            {
                axisLine: { lineStyle: { color: tc.axisLine } },
                axisLabel: { color: tc.axisLabel },
            },
        ],
        yAxis: [
            {
                scale: true,
                axisLabel: { color: tc.axisLabel },
                splitLine: { lineStyle: { color: tc.splitLine } },
            },
            { scale: true },
        ],
    });
}
