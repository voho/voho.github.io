// renderer.js
// Draws one frame: background, dust, mesh, nodes, signal trails and rings.

import { config } from './config.js';

const TAU = Math.PI * 2;
const spriteCache = new Map();

function hexToRgba(hex, alpha) {
    const v = parseInt(hex.slice(1), 16);
    return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${alpha})`;
}

// Pre-rendered radial gradients; much cheaper and softer than shadowBlur.
function sprite(key, build) {
    let s = spriteCache.get(key);
    if (!s) {
        s = document.createElement('canvas');
        s.width = s.height = 64;
        build(s.getContext('2d'));
        spriteCache.set(key, s);
    }
    return s;
}

function headSprite(color) {
    return sprite(`head:${color}`, (g) => {
        const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        grad.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
        grad.addColorStop(0.25, hexToRgba(color, 0.55));
        grad.addColorStop(1, hexToRgba(color, 0));
        g.fillStyle = grad;
        g.fillRect(0, 0, 64, 64);
    });
}

function haloSprite(color) {
    return sprite(`halo:${color}`, (g) => {
        const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        grad.addColorStop(0, hexToRgba(color, 0.55));
        grad.addColorStop(1, hexToRgba(color, 0));
        g.fillStyle = grad;
        g.fillRect(0, 0, 64, 64);
    });
}

function easeOutCubic(t) {
    const u = 1 - t;
    return 1 - u * u * u;
}

let bg = null;

function ensureBackground(ctx, w, h) {
    if (bg && bg.w === w && bg.h === h) return;
    const lin = ctx.createLinearGradient(0, 0, 0, h);
    lin.addColorStop(0, config.BG_TOP);
    lin.addColorStop(1, config.BG_BOTTOM);
    const glow = ctx.createRadialGradient(
        w / 2, h * 0.46, 0, w / 2, h * 0.46, Math.max(w, h) * 0.55);
    glow.addColorStop(0, config.BG_CENTER_GLOW);
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    const vig = ctx.createRadialGradient(
        w / 2, h / 2, Math.min(w, h) * 0.42, w / 2, h / 2, Math.hypot(w, h) * 0.6);
    vig.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vig.addColorStop(1, config.VIGNETTE);
    bg = { w, h, lin, glow, vig };
}

export function render(ctx, sim, view) {
    const { w, h } = view;
    const net = sim.net;
    const time = sim.time;

    ensureBackground(ctx, w, h);
    ctx.fillStyle = bg.lin;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = bg.glow;
    ctx.fillRect(0, 0, w, h);
    ctx.lineCap = 'round';

    // Far dust layer: plain particles, so nothing back here can ever cross.
    ctx.save();
    ctx.translate(view.parallax.x * config.PARALLAX_FAR,
        view.parallax.y * config.PARALLAX_FAR);
    ctx.fillStyle = `rgb(${config.DUST_COLOR.join(', ')})`;
    for (const d of sim.dust) {
        ctx.globalAlpha = d.alpha * (0.7 + 0.3 * Math.sin(d.tw * time + d.twPhase));
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, TAU);
        ctx.fill();
    }
    ctx.restore();

    ctx.save();
    const ox = view.parallax.x * config.PARALLAX_NEAR;
    const oy = view.parallax.y * config.PARALLAX_NEAR;
    ctx.translate(ox, oy);
    ctx.globalAlpha = 1;

    // Base mesh, batched into a single stroke.
    ctx.beginPath();
    for (const e of net.edges) {
        const a = net.nodes[e.a], b = net.nodes[e.b];
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
    }
    ctx.strokeStyle = config.EDGE_COLOR;
    ctx.lineWidth = config.EDGE_WIDTH;
    ctx.stroke();

    // Nodes, brightened near the pointer.
    const px = view.pointer.x - ox;
    const py = view.pointer.y - oy;
    const pointerStrength = view.pointer.strength;
    const hoverR = config.HOVER_RADIUS;
    ctx.fillStyle = `rgb(${config.NODE_COLOR.join(', ')})`;
    for (const n of net.nodes) {
        const twinkle = 1 - config.TWINKLE_DEPTH * (0.5 + 0.5 * Math.sin(n.tw * time + n.twPhase));
        let alpha = n.alpha * twinkle;
        let radius = n.r;
        let hover = 0;
        if (pointerStrength > 0.01) {
            const dx = n.x - px, dy = n.y - py;
            const d2 = dx * dx + dy * dy;
            if (d2 < hoverR * hoverR) {
                const falloff = 1 - Math.sqrt(d2) / hoverR;
                hover = falloff * falloff * pointerStrength;
                alpha = Math.min(1, alpha + hover * config.HOVER_NODE_BOOST);
                radius += hover * config.HOVER_NODE_BOOST * 1.6;
            }
        }
        n.hover = hover;
        ctx.globalAlpha = Math.min(1, alpha + n.lit * 0.6);
        ctx.beginPath();
        ctx.arc(n.x, n.y, radius + n.lit * 0.8, 0, TAU);
        ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Light passes are additive so overlapping glows blend nicely.
    ctx.globalCompositeOperation = 'lighter';

    // Fading trails on recently travelled edges.
    for (const e of net.edges) {
        if (e.lit <= 0.02 || !e.color) continue;
        const a = net.nodes[e.a], b = net.nodes[e.b];
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = hexToRgba(e.color, 0.15 * e.lit);
        ctx.lineWidth = 3.4;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = hexToRgba(e.color, 0.7 * e.lit);
        ctx.lineWidth = 1.4;
        ctx.stroke();
    }

    // Node halos: hubs, recently routed nodes and nodes near the pointer.
    const halo = haloSprite('#7fb4ff');
    for (const n of net.nodes) {
        const strength = Math.max(
            n.deg >= config.HUB_DEGREE ? config.HUB_GLOW_ALPHA : 0,
            n.lit * 0.5,
            n.hover * 0.35);
        if (strength < 0.02) continue;
        const size = 24 + n.r * 7;
        ctx.globalAlpha = strength;
        ctx.drawImage(halo, n.x - size / 2, n.y - size / 2, size, size);
    }
    ctx.globalAlpha = 1;

    // Signals: the lit part of the current hop plus a glowing head.
    for (const s of sim.signals) {
        const a = net.nodes[s.path[s.leg]];
        const b = net.nodes[s.path[s.leg + 1]];
        const hx = a.x + (b.x - a.x) * s.t;
        const hy = a.y + (b.y - a.y) * s.t;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(hx, hy);
        ctx.strokeStyle = hexToRgba(s.color, 0.7);
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.globalAlpha = 0.9;
        ctx.drawImage(headSprite(s.color), hx - 14, hy - 14, 28, 28);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#eaf6ff';
        ctx.beginPath();
        ctx.arc(hx, hy, 1.7, 0, TAU);
        ctx.fill();
    }

    // Expanding rings where a signal arrived.
    for (const ring of sim.rings) {
        const p = Math.min(1, ring.t / config.RING_DURATION_S);
        const radius = config.RING_RADIUS_FROM
            + (config.RING_RADIUS_TO - config.RING_RADIUS_FROM) * easeOutCubic(p);
        ctx.beginPath();
        ctx.arc(ring.node.x, ring.node.y, radius, 0, TAU);
        ctx.strokeStyle = hexToRgba(ring.color, config.RING_ALPHA * (1 - p));
        ctx.lineWidth = 1.6;
        ctx.stroke();
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();

    // Soft vignette keeps the corners calm and the centre readable.
    ctx.fillStyle = bg.vig;
    ctx.fillRect(0, 0, w, h);
}
