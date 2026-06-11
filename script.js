// script.js
// Bootstraps the background simulation: two canvases (blurred depth layer
// behind a sharp main layer), camera sway/rotation, pointer tracking, click
// bursts, the animation loop and reduced-motion handling.

import { config } from './config.js';
import { Simulation } from './network.js';
import { renderDepth, renderMain, screenToLayer } from './renderer.js';

const mainCanvas = document.getElementById('background-canvas');
const depthCanvas = document.getElementById('background-canvas-depth');
const mainCtx = mainCanvas.getContext('2d');
const depthCtx = depthCanvas.getContext('2d');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const view = {
    w: 0,
    h: 0,
    dpr: 1,
    pointer: { x: 0, y: 0, strength: 0, targetStrength: 0 },
    parallax: { x: 0, y: 0, tx: 0, ty: 0 },
    offset: { x: 0, y: 0 },  // combined parallax + sway, in px
    rot: 0,                  // camera rotation, radians
};

let simMain = null;
let simDepth = null;
let rafId = null;
let rebuildTimer = 0;
let elapsed = 0;

function fitCanvases() {
    view.w = mainCanvas.clientWidth;
    view.h = mainCanvas.clientHeight;
    view.dpr = Math.min(window.devicePixelRatio || 1, config.MAX_DPR);
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
    renderMain(mainCtx, simMain, view);
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
            dust: true,
            bokeh: true,
        });
    }
    if (reducedMotion.matches) renderBoth();
}

function onResize() {
    const dpr = Math.min(window.devicePixelRatio || 1, config.MAX_DPR);
    // The canvases are sized with 100lvh, so mobile browser bars toggling the
    // window height do not change them; only genuine size changes get through.
    if (mainCanvas.clientWidth === view.w && mainCanvas.clientHeight === view.h
        && dpr === view.dpr) return;
    fitCanvases();
    if (simMain && !reducedMotion.matches) renderBoth();
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(rebuild, 180);
}

let last = 0;

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

    // Camera: eased pointer parallax plus a slow autonomous sway and a
    // continuous slow rotation, so the scene keeps moving on its own.
    view.offset.x = view.parallax.x * config.PARALLAX_PX
        + Math.sin(TAU_SWAY * elapsed + 0.9) * config.SWAY_AMP;
    view.offset.y = view.parallax.y * config.PARALLAX_PX
        + Math.sin(TAU_SWAY * 0.8 * elapsed + 2.3) * config.SWAY_AMP * 0.7;
    view.rot = ROT_SPEED * elapsed;

    simMain.update(dt);
    simDepth.update(dt);
    renderBoth();
}

function startLoop() {
    if (rafId !== null) return;
    last = performance.now();
    rafId = requestAnimationFrame(frame);
}

function stopLoop() {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
}

window.addEventListener('resize', onResize);

window.addEventListener('pointermove', (ev) => {
    if (ev.pointerType === 'touch') return;
    view.pointer.x = ev.clientX;
    view.pointer.y = ev.clientY;
    view.pointer.targetStrength = 1;
    // The scene shifts slightly away from the cursor for a depth effect.
    view.parallax.tx = (0.5 - ev.clientX / Math.max(1, view.w)) * 2;
    view.parallax.ty = (0.5 - ev.clientY / Math.max(1, view.h)) * 2;
}, { passive: true });

// Click or tap anywhere (except the links) pops the nearest node and
// bursts a few signals out of it.
window.addEventListener('pointerdown', (ev) => {
    if (reducedMotion.matches || !simMain) return;
    if (ev.target && ev.target.closest && ev.target.closest('a, button')) return;
    const p = screenToLayer(view, config.OFFSET_MAIN, config.ROT_MAIN,
        ev.clientX, ev.clientY);
    simMain.burstAt(p.x, p.y);
}, { passive: true });

// Hovering (or keyboard-focusing) any button fires flares from random
// nodes, at most once every three seconds.
let lastButtonFlares = -Infinity;
const fireButtonFlares = () => {
    if (reducedMotion.matches || !simMain) return;
    const now = performance.now();
    if (now - lastButtonFlares < 3000) return;
    lastButtonFlares = now;
    simMain.fireFlares(5);
};
for (const button of document.querySelectorAll('.button')) {
    button.addEventListener('pointerenter', fireButtonFlares);
    button.addEventListener('focus', fireButtonFlares);
}

const resetPointer = () => {
    view.pointer.targetStrength = 0;
    view.parallax.tx = 0;
    view.parallax.ty = 0;
};
document.documentElement.addEventListener('mouseleave', resetPointer);
window.addEventListener('blur', resetPointer);

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

rebuild();
if (!reducedMotion.matches) startLoop();
