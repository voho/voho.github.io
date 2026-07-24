// script.js
// Bootstraps the background simulation: two canvases (blurred depth layer
// behind a sharp main layer), camera sway/rotation, pointer/touch/tilt input,
// the load choreography, the animation loop, an fps-driven quality governor
// and reduced-motion handling.

import { config } from './config.js';
import { Simulation } from './network.js';
import { renderDepth, renderMain, screenToLayer } from './renderer.js';

const root = document.documentElement;
const mainCanvas = document.getElementById('background-canvas');
const depthCanvas = document.getElementById('background-canvas-depth');
const mainCtx = mainCanvas.getContext('2d');
const depthCtx = depthCanvas.getContext('2d');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');

const view = {
    w: 0,
    h: 0,
    dpr: 1,
    pointer: { x: 0, y: 0, strength: 0, targetStrength: 0 },
    parallax: { x: 0, y: 0, tx: 0, ty: 0 },
    offset: { x: 0, y: 0 },  // combined parallax + sway, in px
    rot: 0,                  // camera rotation, radians
};

// Lowered once, in steps, if the device cannot hold the frame rate.
const quality = {
    step: 0,
    maxDpr: config.MAX_DPR,
    depthEvery: 2,
    torch: true,
    fgBokeh: true,
};

// Re-applied after every rebuild, which would otherwise restock the
// particles a degraded device has already given up on.
function applyQuality() {
    if (!quality.fgBokeh && simMain) simMain.fgBokeh.length = 0;
}

let simMain = null;
let simDepth = null;
let rafId = null;
let rebuildTimer = 0;
let elapsed = 0;

function fitCanvases() {
    view.w = mainCanvas.clientWidth;
    view.h = mainCanvas.clientHeight;
    view.dpr = Math.min(window.devicePixelRatio || 1, quality.maxDpr);
    mainCanvas.width = Math.round(view.w * view.dpr);
    mainCanvas.height = Math.round(view.h * view.dpr);
    mainCtx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    // The depth canvas renders at reduced resolution; CSS blur hides it.
    const ds = config.DEPTH_RES_SCALE;
    depthCanvas.width = Math.max(1, Math.round(view.w * ds));
    depthCanvas.height = Math.max(1, Math.round(view.h * ds));
    depthCtx.setTransform(ds, 0, 0, ds, 0, 0);
}

function renderBoth() {
    renderDepth(depthCtx, simDepth, view);
    renderMain(mainCtx, simMain, view, quality);
}

function rebuild() {
    fitCanvases();
    if (simMain) {
        simMain.rebuild(view.w, view.h);
        simDepth.rebuild(view.w, view.h);
    } else {
        simMain = new Simulation(view.w, view.h, {
            rotFactor: config.ROT_MAIN,
            fgBokeh: true,
            stars: true,
        });
        simDepth = new Simulation(view.w, view.h, {
            spacingScale: config.DEPTH_SPACING_SCALE,
            rotFactor: config.ROT_DEPTH,
            signalMax: config.DEPTH_SIGNAL_MAX,
            spawnMin: config.DEPTH_SPAWN_MIN_S,
            spawnMax: config.DEPTH_SPAWN_MAX_S,
            speedScale: config.DEPTH_SPEED_SCALE,
            mono: true,
            palette: config.DEPTH_SIGNAL_COLORS,
            bokehColors: config.DEPTH_BOKEH_COLORS,
            bokehAlphaScale: config.DEPTH_BOKEH_ALPHA_SCALE,
            dust: true,
            bokeh: true,
        });
    }
    applyQuality();
    measureButtons();
    if (reducedMotion.matches) renderBoth();
}

function onResize() {
    const dpr = Math.min(window.devicePixelRatio || 1, quality.maxDpr);
    // The canvases are sized with 100lvh, so mobile browser bars toggling the
    // window height do not change them; only genuine size changes get through.
    if (mainCanvas.clientWidth === view.w && mainCanvas.clientHeight === view.h
        && dpr === view.dpr) {
        measureButtons();
        return;
    }
    fitCanvases();
    if (simMain && !reducedMotion.matches) renderBoth();
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(rebuild, 180);
}

// --- Content parallax ------------------------------------------------------
// The text and the glow behind it drift against the camera, which separates
// them from the field instead of pasting them onto it.

let lastFgX = NaN;
let lastFgY = NaN;

function writeParallax() {
    const fx = view.offset.x * config.CONTENT_PARALLAX;
    const fy = view.offset.y * config.CONTENT_PARALLAX;
    if (Math.abs(fx - lastFgX) + Math.abs(fy - lastFgY) < 0.06) return;
    lastFgX = fx;
    lastFgY = fy;
    const bx = view.offset.x * config.BACKDROP_PARALLAX;
    const by = view.offset.y * config.BACKDROP_PARALLAX;
    root.style.setProperty('--fg-x', `${fx.toFixed(2)}px`);
    root.style.setProperty('--fg-y', `${fy.toFixed(2)}px`);
    root.style.setProperty('--bd-x', `${bx.toFixed(2)}px`);
    root.style.setProperty('--bd-y', `${by.toFixed(2)}px`);
}

// --- Magnetic buttons ------------------------------------------------------
// On fine pointers the buttons lean towards the cursor as it approaches.

const buttons = [...document.querySelectorAll('.button')].map(el => ({
    el, cx: 0, cy: 0, x: 0, y: 0, wx: NaN, wy: NaN,
}));

function measureButtons() {
    for (const b of buttons) {
        const r = b.el.getBoundingClientRect();
        b.cx = r.left + r.width / 2;
        b.cy = r.top + r.height / 2;
    }
}

function updateMagnets(dt) {
    if (!finePointer.matches || reducedMotion.matches) return;
    const ease = Math.min(1, config.MAGNET_EASE * dt);
    const R = config.MAGNET_RADIUS;
    for (const b of buttons) {
        let tx = 0, ty = 0;
        if (view.pointer.strength > 0.01) {
            const dx = view.pointer.x - b.cx, dy = view.pointer.y - b.cy;
            const d = Math.hypot(dx, dy);
            if (d < R) {
                // Zero pull at the centre (no direction to lean towards) and
                // at the edge of the field: strongest just off the button.
                const k = config.MAGNET_PULL * (1 - d / R) * view.pointer.strength;
                const scale = Math.min(1, config.MAGNET_MAX / Math.max(1, d * k));
                tx = dx * k * scale;
                ty = dy * k * scale;
            }
        }
        b.x += (tx - b.x) * ease;
        b.y += (ty - b.y) * ease;
        if (Math.abs(b.x - b.wx) + Math.abs(b.y - b.wy) < 0.03) continue;
        b.wx = b.x;
        b.wy = b.y;
        b.el.style.setProperty('--mx', `${b.x.toFixed(2)}px`);
        b.el.style.setProperty('--my', `${b.y.toFixed(2)}px`);
    }
}

// --- Quality governor ------------------------------------------------------

let qFrames = 0;
let qAcc = 0;

function degrade() {
    const step = config.QUALITY_STEPS[quality.step++];
    quality.depthEvery = step.depthEvery;
    if (step.torch === false) quality.torch = false;
    if (step.fgBokeh === false) quality.fgBokeh = false;
    if (step.maxDpr) {
        quality.maxDpr = step.maxDpr;
        fitCanvases();
    }
    applyQuality();
}

function governQuality(dt) {
    if (quality.step >= config.QUALITY_STEPS.length) return;
    if (elapsed < config.QUALITY_GRACE_S) return;
    qFrames++;
    qAcc += dt;
    if (qAcc < config.QUALITY_SAMPLE_S) return;
    if (qFrames / qAcc < config.QUALITY_MIN_FPS) degrade();
    qFrames = 0;
    qAcc = 0;
}

// --- Animation loop --------------------------------------------------------

let last = 0;
let frameNo = 0;

const TAU_SWAY = Math.PI * 2 * config.SWAY_FREQ;
const ROT_SPEED = config.ROT_SPEED_DEG_S * Math.PI / 180;

function frame(now) {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    elapsed += dt;

    const pointerEase = Math.min(1, 5 * dt);
    view.pointer.strength +=
        (view.pointer.targetStrength - view.pointer.strength) * pointerEase;
    const parallaxEase = Math.min(1, config.PARALLAX_EASE * dt);
    view.parallax.x += (view.parallax.tx - view.parallax.x) * parallaxEase;
    view.parallax.y += (view.parallax.ty - view.parallax.y) * parallaxEase;

    // Camera: eased pointer/tilt parallax plus a slow autonomous sway and a
    // continuous slow rotation, so the scene keeps moving on its own.
    view.offset.x = view.parallax.x * config.PARALLAX_PX
        + Math.sin(TAU_SWAY * elapsed + 0.9) * config.SWAY_AMP;
    view.offset.y = view.parallax.y * config.PARALLAX_PX
        + Math.sin(TAU_SWAY * 0.8 * elapsed + 2.3) * config.SWAY_AMP * 0.7;
    view.rot = (ROT_SPEED * elapsed) % (Math.PI * 2);

    writeParallax();
    updateMagnets(dt);

    simMain.update(dt);
    simDepth.update(dt);
    // The depth canvas sits behind a 5px blur, so skipping frames on it is
    // invisible and roughly halves the total fill cost.
    frameNo++;
    if (frameNo % quality.depthEvery === 0) renderDepth(depthCtx, simDepth, view);
    renderMain(mainCtx, simMain, view, quality);

    governQuality(dt);
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

// --- Input -----------------------------------------------------------------

let touchDragging = false;

function aimPointer(x, y) {
    view.pointer.x = x;
    view.pointer.y = y;
    view.pointer.targetStrength = 1;
    // The scene shifts slightly away from the cursor for a depth effect.
    view.parallax.tx = (0.5 - x / Math.max(1, view.w)) * 2;
    view.parallax.ty = (0.5 - y / Math.max(1, view.h)) * 2;
}

const resetPointer = () => {
    touchDragging = false;
    view.pointer.targetStrength = 0;
    view.parallax.tx = 0;
    view.parallax.ty = 0;
};

// A mouse or pen aims the torch just by hovering.
window.addEventListener('pointermove', (ev) => {
    if (ev.pointerType === 'touch') return; // handled by the touch listeners
    aimPointer(ev.clientX, ev.clientY);
}, { passive: true });

// A finger has to be down, so a drag sweeps the light across the mesh
// instead of doing nothing. This uses touch events rather than pointer
// events because browsers fire pointercancel the moment they consider
// claiming the gesture for a scroll, which would cut a drag short.
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

// Click or tap anywhere (except the links) pops the nearest node and
// bursts a few signals out of it.
window.addEventListener('pointerdown', (ev) => {
    dismissHint();
    if (reducedMotion.matches || !simMain) return;
    if (ev.target && ev.target.closest && ev.target.closest('a, button')) return;
    const p = screenToLayer(view, config.OFFSET_MAIN, config.ROT_MAIN,
        ev.clientX, ev.clientY);
    simMain.burstAt(p.x, p.y);
}, { passive: true });

// Tilting a phone drives the same parallax a mouse does. No permission is
// requested: where the browser withholds the sensor the listener simply
// never fires and the scene keeps swaying on its own.
let tiltBase = null;
window.addEventListener('deviceorientation', (ev) => {
    if (reducedMotion.matches || ev.beta === null || ev.gamma === null) return;
    if (!tiltBase) {
        tiltBase = { beta: ev.beta, gamma: ev.gamma };
        return;
    }
    // The neutral pose slowly follows the phone, so a tilted reading pose
    // relaxes back to centre instead of pinning at full deflection.
    tiltBase.beta += (ev.beta - tiltBase.beta) * config.TILT_RECENTER;
    tiltBase.gamma += (ev.gamma - tiltBase.gamma) * config.TILT_RECENTER;
    if (touchDragging) return;
    const range = config.TILT_RANGE_DEG;
    const gx = Math.max(-1, Math.min(1, (ev.gamma - tiltBase.gamma) / range));
    const gy = Math.max(-1, Math.min(1, (ev.beta - tiltBase.beta) / range));
    // Device axes are fixed to the hardware; rotate them into screen axes.
    const a = -(window.screen?.orientation?.angle || 0) * Math.PI / 180;
    const cos = Math.cos(a), sin = Math.sin(a);
    view.parallax.tx = -(gx * cos - gy * sin);
    view.parallax.ty = -(gx * sin + gy * cos);
}, { passive: true });

// Hovering (or keyboard-focusing) a button pushes flares out of the mesh
// right behind it, at most once every three seconds.
let lastButtonFlares = -Infinity;
const fireButtonFlares = (ev) => {
    if (reducedMotion.matches || !simMain) return;
    const now = performance.now();
    if (now - lastButtonFlares < 3000) return;
    lastButtonFlares = now;
    const r = ev.currentTarget.getBoundingClientRect();
    const p = screenToLayer(view, config.OFFSET_MAIN, config.ROT_MAIN,
        r.left + r.width / 2, r.top + r.height / 2);
    simMain.fireFlares(4, p.x, p.y);
};
for (const { el } of buttons) {
    el.addEventListener('pointerenter', fireButtonFlares);
    el.addEventListener('focus', fireButtonFlares);
}

document.documentElement.addEventListener('mouseleave', resetPointer);
window.addEventListener('blur', resetPointer);
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(rebuild, 250);
});

// Nothing to animate for an unseen page; this matters most on phones.
document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopLoop();
    else startLoop();
});

if (typeof reducedMotion.addEventListener === 'function') {
    reducedMotion.addEventListener('change', () => {
        if (reducedMotion.matches) {
            stopLoop();
            view.offset.x = 0;
            view.offset.y = 0;
            view.rot = 0;
            renderBoth();
        } else {
            startLoop();
        }
    });
}

// --- Load choreography -----------------------------------------------------
// The mesh switches on with a wave from the centre while the text rises into
// it. Waiting for the webfont keeps the headline from reflowing mid-reveal.

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
        simMain.ignite(config.IGNITE_DELAY_S);
        simDepth.ignite(config.IGNITE_DEPTH_DELAY_S);
        // The buttons animate in, so their resting places settle late.
        setTimeout(measureButtons, 1800);
        hintTimer = setTimeout(dismissHint, 9000);
    } else {
        root.classList.add('hint-done');
    }
}

rebuild();
startLoop();

const fontsReady = document.fonts ? document.fonts.ready : Promise.resolve();
Promise.race([fontsReady, new Promise(r => setTimeout(r, 900))]).then(reveal);
