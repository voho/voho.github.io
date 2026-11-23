// script.js
// Bootstraps the relativistic Black Hole simulation: WebGL2 geodesic raymarch
// + HDR bloom renderer with automatic Canvas 2D fallback, fixed sky-locked
// starfield, cursor matter emission & horizon oblivion absorption, link-hover
// spacetime transitions (M87* -> Gargantua / Cygnus X-1), adaptive quality
// governor with a ~60 fps cap, and reduced-motion handling.

import { config } from './config.js';
import { BlackHoleSimulation } from './simulation.js';
import { WebGL2Renderer, Canvas2DRenderer } from './renderer.js';
import { QualityGovernor } from './quality.js';

const root = document.documentElement;
const glCanvas = document.getElementById('bg-gl');
const c2dCanvas = document.getElementById('bg-2d');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const view = {
    w: 1,
    h: 1,
    dpr: 1,
    pointer: { x: 0.5, y: 0.5, strength: 0, targetStrength: 0 },
    parallax: { x: 0, y: 0, tx: 0, ty: 0 },
};

// Weak or power-saving devices start at a lower render scale; the governor
// takes it from there in both directions.
const lowPower = (navigator.hardwareConcurrency || 8) <= 4
    || (navigator.deviceMemory || 8) <= 4
    || navigator.connection?.saveData === true
    || window.matchMedia('(pointer: coarse)').matches;
const governor = new QualityGovernor(lowPower);
let quality = governor.settings;

let sim = null;
let glRenderer = null;
let c2dRenderer = null;
let useWebGL = false;
let rafId = null;
let rebuildTimer = 0;
const camOffset = { x: 0, y: 0 };

function setBackend(webglActive) {
    useWebGL = webglActive;
    glCanvas.hidden = !webglActive;
    c2dCanvas.hidden = webglActive;
}

function fitCanvases() {
    const refCanvas = useWebGL ? glCanvas : c2dCanvas;
    view.w = Math.max(1, refCanvas.clientWidth || window.innerWidth);
    view.h = Math.max(1, refCanvas.clientHeight || window.innerHeight);
    view.dpr = Math.min(window.devicePixelRatio || 1, config.MAX_DPR);

    const pw = Math.max(2, Math.round(view.w * view.dpr));
    const ph = Math.max(2, Math.round(view.h * view.dpr));

    glCanvas.width = pw;
    glCanvas.height = ph;
    c2dCanvas.width = pw;
    c2dCanvas.height = ph;
    if (c2dRenderer?.ctx) {
        c2dRenderer.ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    }
}

function renderOnce() {
    if (!sim) return;
    if (useWebGL && glRenderer?.ready) {
        glRenderer.render(sim, view, quality);
    } else if (c2dRenderer) {
        c2dRenderer.render(sim, view);
    }
}

function rebuildSim() {
    fitCanvases();
    if (sim) {
        sim.resize(view.w, view.h);
    } else {
        sim = new BlackHoleSimulation(view.w, view.h);
    }
    if (reducedMotion.matches) renderOnce();
}

function onResize() {
    const refCanvas = useWebGL ? glCanvas : c2dCanvas;
    const cw = Math.max(1, refCanvas.clientWidth || window.innerWidth);
    const ch = Math.max(1, refCanvas.clientHeight || window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, config.MAX_DPR);
    if (cw === view.w && ch === view.h && dpr === view.dpr) return;

    fitCanvases();
    if (sim && !reducedMotion.matches) renderOnce();
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(rebuildSim, config.RESIZE_DEBOUNCE_MS);
}

// --- Animation loop ---------------------------------------------------------

// The first rAF callbacks only time the display, without rendering, so a slow
// GPU cannot pass for a slow screen. High-refresh displays then render every
// Nth callback (~60 fps): a background should not double the GPU load.
const CALIBRATION_FRAMES = 12;
const rafTimes = [];
let frameEvery = 1;
let targetFps = 60;
let rafCount = 0;
let last = 0;

function calibrate(now) {
    rafTimes.push(now);
    if (rafTimes.length < CALIBRATION_FRAMES) return;
    const gaps = rafTimes.slice(1).map((t, i) => t - rafTimes[i]).sort((a, b) => a - b);
    const hz = Math.max(30, Math.min(240, 1000 / gaps[gaps.length >> 1]));
    frameEvery = Math.max(1, Math.floor(hz / 60 + 0.25));
    targetFps = hz / frameEvery;
    last = now;
}

function frame(now) {
    rafId = requestAnimationFrame(frame);
    if (rafTimes.length < CALIBRATION_FRAMES) {
        calibrate(now);
        return;
    }
    if (++rafCount % frameEvery) return;

    const rawDt = (now - last) / 1000;
    const dt = Math.min(rawDt, 0.05);
    last = now;

    const pEase = Math.min(1, 5 * dt);
    view.pointer.strength += (view.pointer.targetStrength - view.pointer.strength) * pEase;
    sim.pointer.strength = view.pointer.strength;

    const parEase = Math.min(1, config.PARALLAX_EASE * dt);
    view.parallax.x += (view.parallax.tx - view.parallax.x) * parEase;
    view.parallax.y += (view.parallax.ty - view.parallax.y) * parEase;

    camOffset.x = view.parallax.x + config.DRIFT_X * Math.sin(sim.time * 0.11);
    camOffset.y = view.parallax.y + config.DRIFT_Y * Math.sin(sim.time * 0.077 + 1.3);
    sim.update(dt, quality, camOffset);
    renderOnce();
    if (useWebGL && governor.sample(rawDt, targetFps)) quality = governor.settings;
}

function startLoop() {
    if (rafId !== null || reducedMotion.matches) return;
    last = performance.now();
    rafId = requestAnimationFrame(frame);
}

function stopLoop() {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
}

// --- Input ------------------------------------------------------------------

let touchDragging = false;
let prevNormX = 0.5;
let prevNormY = 0.5;

function aimPointer(clientX, clientY) {
    const nx = Math.max(0, Math.min(1, clientX / Math.max(1, view.w)));
    const ny = Math.max(0, Math.min(1, clientY / Math.max(1, view.h)));
    const vx = nx - prevNormX;
    const vy = ny - prevNormY;
    prevNormX = nx;
    prevNormY = ny;

    view.pointer.x = nx;
    view.pointer.y = ny;
    view.pointer.targetStrength = 1;
    view.parallax.tx = (0.5 - nx) * 2;
    view.parallax.ty = (ny - 0.5) * 2;

    if (sim && !reducedMotion.matches) {
        sim.pointerMove(nx, ny, vx, vy, sim.pointer.down);
    }
}

const resetPointer = () => {
    touchDragging = false;
    view.pointer.targetStrength = 0;
    view.parallax.tx = 0;
    view.parallax.ty = 0;
    if (sim) sim.pointer.down = false;
};

window.addEventListener('pointermove', (ev) => {
    if (ev.pointerType === 'touch') return;
    aimPointer(ev.clientX, ev.clientY);
}, { passive: true });

// Touch drag uses touch events so mobile scroll arbitration doesn't cancel drags
const onTouch = (ev) => {
    const touch = ev.touches[0];
    if (!touch) return;
    touchDragging = true;
    aimPointer(touch.clientX, touch.clientY);
};
window.addEventListener('touchstart', onTouch, { passive: true });
window.addEventListener('touchmove', onTouch, { passive: true });
window.addEventListener('touchend', resetPointer, { passive: true });
window.addEventListener('touchcancel', resetPointer, { passive: true });

window.addEventListener('pointerdown', (ev) => {
    dismissHint();
    if (reducedMotion.matches || !sim) return;
    if (ev.target && ev.target.closest && ev.target.closest('a, button')) return;
    sim.pointer.down = true;
    const nx = Math.max(0, Math.min(1, ev.clientX / Math.max(1, view.w)));
    const ny = Math.max(0, Math.min(1, ev.clientY / Math.max(1, view.h)));
    sim.interactAt(nx, ny);
}, { passive: true });

const releaseHold = () => {
    if (sim) sim.pointer.down = false;
};
window.addEventListener('pointerup', releaseHold, { passive: true });
window.addEventListener('pointercancel', releaseHold, { passive: true });

let tiltBase = null;
window.addEventListener('deviceorientation', (ev) => {
    if (reducedMotion.matches || ev.beta === null || ev.gamma === null) return;
    if (!tiltBase) {
        tiltBase = { beta: ev.beta, gamma: ev.gamma };
        return;
    }
    tiltBase.beta += (ev.beta - tiltBase.beta) * config.TILT_RECENTER;
    tiltBase.gamma += (ev.gamma - tiltBase.gamma) * config.TILT_RECENTER;
    if (touchDragging) return;
    const range = config.TILT_RANGE_DEG;
    const gx = Math.max(-1, Math.min(1, (ev.gamma - tiltBase.gamma) / range));
    const gy = Math.max(-1, Math.min(1, (ev.beta - tiltBase.beta) / range));
    const a = -(window.screen?.orientation?.angle || 0) * Math.PI / 180;
    const cos = Math.cos(a), sin = Math.sin(a);
    view.parallax.tx = -(gx * cos - gy * sin);
    view.parallax.ty = gx * sin + gy * cos;
}, { passive: true });

let lastButtonPulse = -Infinity;
for (const el of document.querySelectorAll('[data-mood]')) {
    if (el.classList.contains('button')) {
        el.addEventListener('pointermove', (ev) => {
            const r = el.getBoundingClientRect();
            el.style.setProperty('--mx', `${ev.clientX - r.left}px`);
            el.style.setProperty('--my', `${ev.clientY - r.top}px`);
        }, { passive: true });
    }

    const mood = Number(el.dataset.mood || 0);
    const onEnter = (ev) => {
        if (!sim || reducedMotion.matches) return;
        sim.targetMood = mood;
        const now = performance.now();
        if (now - lastButtonPulse < config.BUTTON_PULSE_COOLDOWN_MS) return;
        lastButtonPulse = now;
        const r = ev.currentTarget.getBoundingClientRect();
        const nx = (r.left + r.width / 2) / Math.max(1, view.w);
        const ny = (r.top + r.height / 2) / Math.max(1, view.h);
        sim.buttonHoverPulse(nx, ny);
    };

    const onLeave = () => {
        if (sim && sim.targetMood === mood) sim.targetMood = 0;
    };

    el.addEventListener('pointerenter', onEnter);
    el.addEventListener('focus', onEnter);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('blur', onLeave);
}

root.addEventListener('mouseleave', resetPointer);
window.addEventListener('blur', resetPointer);
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(rebuildSim, config.ORIENTATION_DEBOUNCE_MS);
});

document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopLoop();
    else startLoop();
});

if (typeof reducedMotion.addEventListener === 'function') {
    reducedMotion.addEventListener('change', () => {
        if (reducedMotion.matches) {
            stopLoop();
            view.parallax.x = 0;
            view.parallax.y = 0;
            renderOnce();
        } else {
            startLoop();
        }
    });
}

// --- WebGL2 context loss & recovery -----------------------------------------

glCanvas.addEventListener('webglcontextlost', (ev) => {
    ev.preventDefault();
    setBackend(false);
    fitCanvases();
    renderOnce();
});

glCanvas.addEventListener('webglcontextrestored', () => {
    if (sim && glRenderer?.rebuildResources(sim)) {
        setBackend(true);
        fitCanvases();
        renderOnce();
    }
});

// --- Load choreography ------------------------------------------------------

let hintTimer = 0;

function dismissHint() {
    clearTimeout(hintTimer);
    root.classList.add('hint-done');
}

let revealed = false;

function reveal() {
    if (revealed) return;
    revealed = true;
    root.classList.add('is-ready');
    if (!reducedMotion.matches) {
        sim.ignite();
        hintTimer = setTimeout(dismissHint, config.HINT_TIMEOUT_MS);
    } else {
        root.classList.add('hint-done');
    }
}

// Bootstrap
c2dRenderer = new Canvas2DRenderer(c2dCanvas);
glRenderer = new WebGL2Renderer(glCanvas);
fitCanvases();
sim = new BlackHoleSimulation(view.w, view.h);
const glReady = glRenderer.init(sim);
setBackend(glReady);
fitCanvases();
renderOnce();
startLoop();

const fontsReady = document.fonts ? document.fonts.ready : Promise.resolve();
Promise.race([
    fontsReady,
    new Promise((r) => setTimeout(r, config.FONT_WAIT_MS)),
]).then(reveal);
