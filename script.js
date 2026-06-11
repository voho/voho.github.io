// script.js
// Bootstraps the background simulation: canvas sizing, pointer tracking,
// the animation loop and reduced-motion handling.

import { config } from './config.js';
import { Simulation } from './network.js';
import { render } from './renderer.js';

const canvas = document.getElementById('background-canvas');
const ctx = canvas.getContext('2d');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const view = {
    w: 0,
    h: 0,
    dpr: 1,
    pointer: { x: 0, y: 0, strength: 0, targetStrength: 0 },
    parallax: { x: 0, y: 0, tx: 0, ty: 0 },
};

let sim = null;
let rafId = null;
let rebuildTimer = 0;

function fitCanvas() {
    view.w = canvas.clientWidth;
    view.h = canvas.clientHeight;
    view.dpr = Math.min(window.devicePixelRatio || 1, config.MAX_DPR);
    canvas.width = Math.round(view.w * view.dpr);
    canvas.height = Math.round(view.h * view.dpr);
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
}

function rebuild() {
    fitCanvas();
    if (sim) sim.rebuild(view.w, view.h);
    else sim = new Simulation(view.w, view.h);
    if (reducedMotion.matches) render(ctx, sim, view);
}

function onResize() {
    const dpr = Math.min(window.devicePixelRatio || 1, config.MAX_DPR);
    // The canvas is sized with 100lvh, so mobile browser bars toggling the
    // window height do not change it; only genuine size changes get through.
    if (canvas.clientWidth === view.w && canvas.clientHeight === view.h
        && dpr === view.dpr) return;
    fitCanvas();
    if (sim && !reducedMotion.matches) render(ctx, sim, view);
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(rebuild, 180);
}

let last = 0;

function frame(now) {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;

    const pointerEase = Math.min(1, 5 * dt);
    view.pointer.strength +=
        (view.pointer.targetStrength - view.pointer.strength) * pointerEase;
    const parallaxEase = Math.min(1, config.PARALLAX_EASE * dt);
    view.parallax.x += (view.parallax.tx - view.parallax.x) * parallaxEase;
    view.parallax.y += (view.parallax.ty - view.parallax.y) * parallaxEase;

    sim.update(dt);
    render(ctx, sim, view);
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
            render(ctx, sim, view);
        } else {
            startLoop();
        }
    });
}

rebuild();
if (!reducedMotion.matches) startLoop();
