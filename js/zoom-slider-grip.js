/**
 * 复盘 K 线 drag-to-zoom slider: bigger touch targets + silky drag.
 *
 * ECharts still paints the slider strip (paper background, mini price line, selected fill);
 * this module lays a DOM "grip" over that strip that owns the pointer:
 *   - 44px-tall hit band with touch-action:none (the page never scrolls while dragging the
 *     slider; everywhere else on the chart keeps its default touch behaviour + pinch),
 *   - hand-drawn pill handles inside 44px-wide targets, press state in ~80ms,
 *   - pointer moves coalesced to one dataZoom dispatch per animation frame (flushed in-frame),
 *   - on release the handles ease onto the nearest bar boundary (the window the chart shows).
 * Pinch / wheel on the chart itself still go through ECharts' inside dataZoom; the grip follows
 * via the `datazoom` event.
 *
 * Pure helpers are exported for unit tests (no DOM at import time).
 */

export const GRIP_HIT_PX = 44;
export const GRIP_MIN_SPAN = 8; // same as the inside (pinch) dataZoom minSpan
export const SETTLE_MS = 140;
export const JUMP_MS = 160;
/** Per-frame drag updates: no series tween (a restarted 300ms tween every frame made the bars trail). */
export const DRAG_ANIMATION = { duration: 0 };

export function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

/** Slider strip geometry in chart px from the slider option (left/right px, bottom/height px). */
export function sliderRect(spec, chartW, chartH) {
    const left = Number(spec.left) || 0;
    const right = Number(spec.right) || 0;
    const height = Number(spec.height) || 30;
    const bottom = Number(spec.bottom) || 0;
    const w = Math.max(1, chartW - left - right);
    const top = chartH - bottom - height;
    return { x0: left, x1: left + w, w, top, height, cy: top + height / 2 };
}

/** Which part a press at x grabs: 'start' | 'end' | 'move' | 'jump'. */
export function hitTest(x, ps, pe, hit = GRIP_HIT_PX / 2) {
    const ds = Math.abs(x - ps);
    const de = Math.abs(x - pe);
    if (ds <= hit || de <= hit) {
        if (ds < de) return 'start';
        if (de < ds) return 'end';
        // Handles overlap: decide by side so the window can always be re-opened.
        return x < ps ? 'start' : 'end';
    }
    if (x > ps && x < pe) return 'move';
    return 'jump';
}

/** New [start,end] (percent) for a drag of dPct from window [s0,e0]. */
export function dragWindow(mode, s0, e0, dPct, minSpan = GRIP_MIN_SPAN) {
    const span = e0 - s0;
    if (mode === 'start') return [clamp(s0 + dPct, 0, Math.max(0, e0 - minSpan)), e0];
    if (mode === 'end') return [s0, clamp(e0 + dPct, Math.min(100, s0 + minSpan), 100)];
    const s = clamp(s0 + dPct, 0, 100 - span);
    return [s, s + span];
}

/** Window of the same span centred on pct (tap outside the selection). */
export function centerWindow(pct, s0, e0) {
    const span = e0 - s0;
    const s = clamp(pct - span / 2, 0, 100 - span);
    return [s, s + span];
}

/** Snap a percent to the nearest category (bar) boundary — what the main chart actually shows. */
export function snapPct(pct, barCount) {
    const n = (barCount | 0) - 1;
    if (!(n > 0)) return pct;
    return (Math.round((clamp(pct, 0, 100) / 100) * n) / n) * 100;
}

export function easeOutCubic(t) {
    const u = 1 - clamp(t, 0, 1);
    return 1 - u * u * u;
}

/** Paper-style slider colours (light / dark). Clean ink + wash, no texture. */
export function getSliderColors(theme) {
    const dark = theme === 'dark';
    return dark
        ? {
              backgroundColor: 'rgba(239,230,212,0.035)',
              borderColor: 'rgba(207,196,176,0.42)',
              fillerColor: 'rgba(224,137,106,0.17)',
              dataLine: 'rgba(207,196,176,0.5)',
              dataArea: 'rgba(207,196,176,0.08)',
              selLine: 'rgba(236,150,116,0.95)',
              selArea: 'rgba(236,150,116,0.2)',
          }
        : {
              backgroundColor: 'rgba(255,252,244,0.6)',
              borderColor: 'rgba(58,53,48,0.42)',
              fillerColor: 'rgba(196,92,58,0.13)',
              dataLine: 'rgba(90,82,72,0.5)',
              dataArea: 'rgba(90,82,72,0.07)',
              selLine: 'rgba(196,92,58,0.95)',
              selArea: 'rgba(196,92,58,0.16)',
          };
}

/** ECharts option patch (for the slider dataZoom) with the theme colours. */
export function sliderThemePatch(theme) {
    const c = getSliderColors(theme);
    return {
        backgroundColor: c.backgroundColor,
        borderColor: c.borderColor,
        fillerColor: c.fillerColor,
        dataBackground: {
            lineStyle: { color: c.dataLine, width: 1.2, opacity: 1 },
            areaStyle: { color: c.dataArea, opacity: 1 },
        },
        selectedDataBackground: {
            lineStyle: { color: c.selLine, width: 1.5, opacity: 1 },
            areaStyle: { color: c.selArea, opacity: 1 },
        },
    };
}

function sliderIndex(option) {
    const dz = (option && option.dataZoom) || [];
    return dz.findIndex((d) => d && d.type === 'slider');
}

/** Re-colour the slider of a chart for the theme (no-op when the chart has no slider). */
export function applySliderTheme(chart, theme, option) {
    if (!chart || chart.isDisposed?.()) return;
    const idx = sliderIndex(option || (chart.getOption && chart.getOption()));
    if (idx < 0) return;
    const dataZoom = [];
    for (let i = 0; i < idx; i++) dataZoom.push({});
    dataZoom.push(sliderThemePatch(theme));
    chart.setOption({ dataZoom });
}

function readPercentRange(chart, sIdx) {
    try {
        const m = chart.getModel && chart.getModel();
        const dz = m && m.getComponent('dataZoom', sIdx);
        const r = dz && dz.getPercentRange && dz.getPercentRange();
        if (r && isFinite(r[0]) && isFinite(r[1])) return [r[0], r[1]];
    } catch (_) {}
    return null;
}

/**
 * Attach the grip over the slider of `chart` (built from `option`). Returns { destroy } or null
 * when the chart has no slider / no DOM. The native ECharts handles are hidden only once the
 * grip is in place, so a failure here leaves the stock slider usable.
 */
export function attachZoomSliderGrip(chart, option, { barCount = 0 } = {}) {
    if (typeof document === 'undefined' || !chart) return null;
    const sIdx = sliderIndex(option);
    if (sIdx < 0) return null;
    const spec = option.dataZoom[sIdx];
    const host = chart.getDom && chart.getDom();
    if (!host) return null;
    if (host.__zsGrip) host.__zsGrip.destroy();
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

    const root = document.createElement('div');
    root.className = 'zs-grip';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML =
        '<div class="zs-grip-win"></div>' +
        '<div class="zs-grip-handle" data-side="start"><span class="zs-grip-pill"><i></i><i></i></span></div>' +
        '<div class="zs-grip-handle" data-side="end"><span class="zs-grip-pill"><i></i><i></i></span></div>';
    host.appendChild(root);
    const winEl = root.querySelector('.zs-grip-win');
    const hS = root.querySelector('[data-side="start"]');
    const hE = root.querySelector('[data-side="end"]');

    let rect = sliderRect(spec, chart.getWidth(), chart.getHeight());
    let win = readPercentRange(chart, sIdx) || [Number(spec.start) || 0, spec.end != null ? Number(spec.end) : 100];
    let drag = null; // { id, mode, x0, s0, e0 }
    let pending = null;
    let raf = 0;
    let settleRaf = 0;
    let settleAfterGlide = false;
    let destroyed = false;

    function layout() {
        rect = sliderRect(spec, chart.getWidth(), chart.getHeight());
        root.style.left = rect.x0 - GRIP_HIT_PX / 2 + 'px';
        root.style.width = rect.w + GRIP_HIT_PX + 'px';
        root.style.top = rect.cy - GRIP_HIT_PX / 2 + 'px';
        root.style.height = GRIP_HIT_PX + 'px';
        root.style.setProperty('--zs-bar-h', rect.height + 'px');
        paintHandles();
    }
    function pxOf(pct) {
        return GRIP_HIT_PX / 2 + (pct / 100) * rect.w; // in root coords
    }
    function paintHandles() {
        const a = pxOf(win[0]);
        const b = pxOf(win[1]);
        hS.style.transform = 'translate3d(' + (a - GRIP_HIT_PX / 2).toFixed(2) + 'px,0,0)';
        hE.style.transform = 'translate3d(' + (b - GRIP_HIT_PX / 2).toFixed(2) + 'px,0,0)';
        winEl.style.transform = 'translate3d(' + a.toFixed(2) + 'px,0,0)';
        winEl.style.width = Math.max(0, b - a).toFixed(2) + 'px';
    }
    function dispatch(s, e) {
        win = [s, e];
        paintHandles();
        chart.dispatchAction({ type: 'dataZoom', start: s, end: e, animation: DRAG_ANIMATION }, { flush: true });
    }
    function frame() {
        raf = 0;
        if (destroyed || !pending) return;
        const p = pending;
        pending = null;
        dispatch(p[0], p[1]);
    }
    function queue(s, e) {
        pending = [s, e];
        if (!raf) raf = requestAnimationFrame(frame);
    }
    function cancelSettle() {
        if (settleRaf) cancelAnimationFrame(settleRaf);
        settleRaf = 0;
        settleAfterGlide = false;
    }
    /** Ease the window to `to` (handles + chart move together, one dispatch per frame). */
    function animateTo(to, ms) {
        cancelSettle();
        const from = win.slice();
        if (Math.abs(to[0] - from[0]) < 0.01 && Math.abs(to[1] - from[1]) < 0.01) return;
        const t0 = performance.now();
        const step = (now) => {
            if (destroyed) return;
            const k = easeOutCubic((now - t0) / ms);
            dispatch(from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k);
            settleRaf = k < 1 ? requestAnimationFrame(step) : 0;
            if (!settleRaf && settleAfterGlide) {
                settleAfterGlide = false;
                settle();
            }
        };
        settleRaf = requestAnimationFrame(step);
    }
    function settle() {
        animateTo([snapPct(win[0], barCount), snapPct(win[1], barCount)], SETTLE_MS);
    }
    function localX(ev) {
        const r = root.getBoundingClientRect();
        // root may be CSS-scaled (page zoom); map back to layout px.
        const scale = r.width / (root.offsetWidth || r.width || 1) || 1;
        return (ev.clientX - r.left) / scale;
    }
    function setPressed(mode) {
        hS.classList.toggle('is-pressed', mode === 'start' || mode === 'move');
        hE.classList.toggle('is-pressed', mode === 'end' || mode === 'move');
        root.classList.toggle('is-dragging', !!mode);
        root.classList.toggle('is-moving', mode === 'move');
    }

    function onDown(ev) {
        if (drag || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
        ev.preventDefault();
        cancelSettle();
        const x = localX(ev);
        let mode = hitTest(x, pxOf(win[0]), pxOf(win[1]));
        let base = win;
        if (mode === 'jump') {
            // Tap beside the selection: glide the window there, then keep dragging it.
            const pct = clamp(((x - GRIP_HIT_PX / 2) / rect.w) * 100, 0, 100);
            base = centerWindow(pct, win[0], win[1]);
            animateTo(base, JUMP_MS);
            mode = 'move';
        }
        drag = { id: ev.pointerId, mode, x0: x, s0: base[0], e0: base[1], moved: false };
        try { root.setPointerCapture(ev.pointerId); } catch (_) {}
        setPressed(mode);
    }
    function onMove(ev) {
        if (!drag) {
            if (ev.pointerType === 'mouse') {
                const m = hitTest(localX(ev), pxOf(win[0]), pxOf(win[1]));
                root.style.cursor = m === 'move' ? 'grab' : m === 'jump' ? 'pointer' : 'ew-resize';
            }
            return;
        }
        if (ev.pointerId !== drag.id) return;
        ev.preventDefault();
        const x = localX(ev);
        if (!drag.moved) {
            if (Math.abs(x - drag.x0) < 1) return; // jitter while pressing: keep the glide going
            drag.moved = true;
            cancelSettle();
        }
        const d = ((x - drag.x0) / rect.w) * 100;
        const w2 = dragWindow(drag.mode, drag.s0, drag.e0, d);
        queue(w2[0], w2[1]);
    }
    function onUp(ev) {
        if (!drag || ev.pointerId !== drag.id) return;
        drag = null;
        try { root.releasePointerCapture(ev.pointerId); } catch (_) {}
        if (raf) { cancelAnimationFrame(raf); frame(); }
        setPressed(null);
        if (!settleRaf) settle(); // a tap-jump glide already ends on its target; snap after it
        else settleAfterGlide = true;
    }
    function onZoom(params) {
        if (drag || settleRaf || pending) return;
        const r = readPercentRange(chart, sIdx);
        const b = params && (params.batch ? params.batch[0] : params);
        const next = r || (b && b.start != null && b.end != null ? [b.start, b.end] : null);
        if (next) {
            win = next;
            paintHandles();
        }
    }
    const stop = (ev) => ev.stopPropagation();

    root.addEventListener('pointerdown', onDown);
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerup', onUp);
    root.addEventListener('pointercancel', onUp);
    root.addEventListener('lostpointercapture', onUp);
    // Keep the press inside the grip: no ECharts tooltip / page gestures from the strip.
    root.addEventListener('touchstart', stop, { passive: true });
    root.addEventListener('mousedown', stop);
    root.addEventListener('contextmenu', (ev) => ev.preventDefault());
    chart.on('datazoom', onZoom);
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(() => layout());
        ro.observe(host);
    }

    // Grip is live: hide the stock canvas handles (the strip, line and fill stay ECharts').
    const hide = [];
    for (let i = 0; i < sIdx; i++) hide.push({});
    hide.push({
        handleStyle: { opacity: 0 },
        moveHandleSize: 0,
        moveHandleStyle: { opacity: 0 },
        emphasis: { handleStyle: { opacity: 0 }, moveHandleStyle: { opacity: 0 } },
    });
    chart.setOption({ dataZoom: hide });
    layout();

    const api = {
        el: root,
        getWindow: () => win.slice(),
        destroy() {
            if (destroyed) return;
            destroyed = true;
            cancelSettle();
            if (raf) cancelAnimationFrame(raf);
            try { chart.off('datazoom', onZoom); } catch (_) {}
            if (ro) ro.disconnect();
            root.remove();
            if (host.__zsGrip === api) host.__zsGrip = null;
        },
    };
    host.__zsGrip = api;
    return api;
}
