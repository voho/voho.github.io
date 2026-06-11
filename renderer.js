// renderer.js
// Draws the two layers: a blurred depth canvas (background gradient, dust,
// bokeh, far mesh) and the main canvas (near mesh, signals, sparks,
// foreground bokeh, vignette). Each layer gets its own camera offset and
// rotation; rigid transforms keep every mesh crossing-free.

import { config } from './config.js';

const TAU = Math.PI * 2;
const spriteCache = new Map();
const bgCache = new WeakMap();

function hexToRgba(hex, alpha) {
    const v = parseInt(hex.slice(1), 16);
    return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${alpha})`;
}

function rgba(rgb, alpha) {
    return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
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

function gradients(ctx, w, h) {
    let g = bgCache.get(ctx);
    if (!g || g.w !== w || g.h !== h) {
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
        g = { w, h, lin, glow, vig };
        bgCache.set(ctx, g);
    }
    return g;
}

// Camera transform of one layer: translate by the layer's share of the
// offset, rotate by its share of the rotation around the screen centre.
function applyCamera(ctx, view, offsetFactor, rotFactor) {
    ctx.translate(view.offset.x * offsetFactor, view.offset.y * offsetFactor);
    const rot = view.rot * rotFactor;
    if (rot !== 0) {
        ctx.translate(view.w / 2, view.h / 2);
        ctx.rotate(rot);
        ctx.translate(-view.w / 2, -view.h / 2);
    }
}

// Inverse of applyCamera, for mapping pointer positions into layer space.
export function screenToLayer(view, offsetFactor, rotFactor, sx, sy) {
    const qx = sx - view.offset.x * offsetFactor - view.w / 2;
    const qy = sy - view.offset.y * offsetFactor - view.h / 2;
    const rot = -view.rot * rotFactor;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    return {
        x: view.w / 2 + qx * cos - qy * sin,
        y: view.h / 2 + qx * sin + qy * cos,
    };
}

function drawDust(ctx, dust, time, view) {
    if (dust.length === 0) return;
    ctx.save();
    applyCamera(ctx, view, config.OFFSET_DUST, 0);
    ctx.fillStyle = rgba(config.DUST_COLOR, 1);
    for (const d of dust) {
        ctx.globalAlpha = d.alpha * (0.7 + 0.3 * Math.sin(d.tw * time + d.twPhase));
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, TAU);
        ctx.fill();
    }
    ctx.restore();
}

function drawBokeh(ctx, items, time, view, offsetFactor, rotFactor) {
    if (items.length === 0) return;
    ctx.save();
    applyCamera(ctx, view, offsetFactor, rotFactor);
    ctx.globalCompositeOperation = 'lighter';
    for (const f of items) {
        ctx.globalAlpha = f.alpha * (0.75 + 0.25 * Math.sin(f.tw * time + f.twPhase));
        ctx.drawImage(haloSprite(f.color || '#9fc1ff'),
            f.x - f.r, f.y - f.r, f.r * 2, f.r * 2);
    }
    ctx.restore();
}

// Subtle particles flying slowly towards the viewer: simple perspective
// projection, so they grow and drift outward as they approach.
function drawStars(ctx, stars, view) {
    if (stars.length === 0) return;
    const cx = view.w / 2, cy = view.h / 2;
    const f = Math.min(view.w, view.h) * 0.5;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of stars) {
        const z = Math.max(0.05, s.z);
        const x = cx + s.ux * f / z;
        const y = cy + s.uy * f / z;
        // Fade in when far away, fade out as they get close.
        const fade = Math.min(1, (1 - s.z) * 6) * Math.min(1, (s.z - 0.1) * 4);
        if (fade <= 0) continue;
        ctx.globalAlpha = s.alpha * fade;
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(x, y, s.r / z * 0.6, 0, TAU);
        ctx.fill();
    }
    ctx.restore();
}

// Per-hop easing: blends linear motion with smoothstep for a gentle
// pulse-like rhythm as signals hop from node to node.
function easedLeg(t) {
    const s = t * t * (3 - 2 * t);
    return t + config.SIGNAL_EASE * (s - t);
}

function drawMesh(ctx, sim, view, o) {
    const net = sim.net;
    const time = sim.time;

    ctx.save();
    applyCamera(ctx, view, o.offset, o.rot);
    ctx.lineCap = 'round';

    // Base mesh with a slow shimmer wave travelling across it. Edges are
    // grouped into a few alpha buckets so strokes stay batched.
    const B = config.SHIMMER_BUCKETS;
    const k = TAU / config.SHIMMER_WAVELENGTH;
    const phase = time * config.SHIMMER_SPEED * k;
    for (const e of net.edges) {
        const a = net.nodes[e.a], b = net.nodes[e.b];
        const m = (a.x + b.x + a.y + b.y) * 0.354; // midpoint projected on the diagonal
        const s = (Math.sin(m * k - phase) + 1) / 2;
        e.bucket = Math.min(B - 1, Math.round(s * (B - 1)));
    }
    for (let bkt = 0; bkt < B; bkt++) {
        ctx.beginPath();
        let any = false;
        for (const e of net.edges) {
            if (e.bucket !== bkt) continue;
            const a = net.nodes[e.a], b = net.nodes[e.b];
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            any = true;
        }
        if (!any) continue;
        const wave = (bkt / (B - 1)) * 2 - 1;
        ctx.strokeStyle = rgba(o.edgeRgb, o.edgeAlpha * (1 + config.SHIMMER_DEPTH * wave));
        ctx.lineWidth = config.EDGE_WIDTH;
        ctx.stroke();
    }

    // Nodes, brightened near the pointer (main layer only).
    const p = o.hover
        ? screenToLayer(view, o.offset, o.rot, view.pointer.x, view.pointer.y)
        : null;
    const pointerStrength = o.hover ? view.pointer.strength : 0;
    const hoverR = config.HOVER_RADIUS;
    for (const n of net.nodes) {
        const twinkle = 1 - config.TWINKLE_DEPTH * (0.5 + 0.5 * Math.sin(n.tw * time + n.twPhase));
        let alpha = n.alpha * twinkle * o.nodeAlpha;
        let radius = n.r * o.nodeScale;
        if (n.deg >= config.HUB_DEGREE) {
            radius += config.HUB_BREATH_AMP
                * Math.sin(TAU * config.HUB_BREATH_FREQ * time + n.twPhase);
        }
        let hover = 0;
        if (pointerStrength > 0.01) {
            const dx = n.x - p.x, dy = n.y - p.y;
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
        ctx.fillStyle = n.colorStr;
        ctx.beginPath();
        ctx.arc(n.x, n.y, Math.max(0.4, radius + n.lit * 0.8), 0, TAU);
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
        const size = (24 + n.r * 7) * o.nodeScale;
        ctx.globalAlpha = strength * o.nodeAlpha;
        ctx.drawImage(halo, n.x - size / 2, n.y - size / 2, size, size);
    }
    ctx.globalAlpha = 1;

    // Signals: charge-up glow while waiting, then the lit part of the
    // current hop plus a glowing head.
    for (const s of sim.signals) {
        const a = net.nodes[s.path[s.leg]];
        if (s.wait > 0) {
            const charge = 1 - s.wait / config.SIGNAL_LAUNCH_DELAY_S;
            const size = (10 + charge * 24) * o.nodeScale;
            ctx.globalAlpha = 0.25 + 0.5 * charge;
            ctx.drawImage(headSprite(s.color), a.x - size / 2, a.y - size / 2, size, size);
            ctx.globalAlpha = 1;
            continue;
        }
        const b = net.nodes[s.path[s.leg + 1]];
        const tt = easedLeg(s.t);
        const hx = a.x + (b.x - a.x) * tt;
        const hy = a.y + (b.y - a.y) * tt;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(hx, hy);
        ctx.strokeStyle = hexToRgba(s.color, 0.7);
        ctx.lineWidth = 1.4;
        ctx.stroke();
        const hs = 28 * o.nodeScale;
        ctx.globalAlpha = 0.9;
        ctx.drawImage(headSprite(s.color), hx - hs / 2, hy - hs / 2, hs, hs);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#eaf6ff';
        ctx.beginPath();
        ctx.arc(hx, hy, 1.7 * o.nodeScale, 0, TAU);
        ctx.fill();
    }

    // Sparks flying out of arrivals.
    for (const spark of sim.sparks) {
        const f = Math.min(1, spark.t / config.SPARK_DURATION_S);
        const dist = config.SPARK_SPEED
            * (1 - Math.exp(-config.SPARK_DECEL * spark.t)) / config.SPARK_DECEL;
        const x = spark.node.x + Math.cos(spark.angle) * dist;
        const y = spark.node.y + Math.sin(spark.angle) * dist;
        ctx.globalAlpha = (1 - f) * (1 - f) * 0.9;
        ctx.fillStyle = spark.color;
        ctx.beginPath();
        ctx.arc(x, y, 1.3 * o.nodeScale, 0, TAU);
        ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Expanding rings where a signal arrived (echo rings start delayed).
    for (const ring of sim.rings) {
        if (ring.t < 0) continue;
        const pr = Math.min(1, ring.t / config.RING_DURATION_S);
        const radius = (config.RING_RADIUS_FROM
            + (config.RING_RADIUS_TO - config.RING_RADIUS_FROM) * easeOutCubic(pr))
            * o.nodeScale;
        ctx.beginPath();
        ctx.arc(ring.node.x, ring.node.y, radius, 0, TAU);
        ctx.strokeStyle = hexToRgba(ring.color,
            config.RING_ALPHA * (1 - pr) * (ring.alphaScale || 1) * o.ringScale);
        ctx.lineWidth = 1.6;
        ctx.stroke();
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
}

// The blurred far canvas: background gradient, dust, bokeh and the far mesh.
export function renderDepth(ctx, sim, view) {
    const { w, h } = view;
    const g = gradients(ctx, w, h);
    ctx.fillStyle = g.lin;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = g.glow;
    ctx.fillRect(0, 0, w, h);

    drawDust(ctx, sim.dust, sim.time, view);
    drawBokeh(ctx, sim.bokeh, sim.time, view, config.OFFSET_DUST, 0);
    drawMesh(ctx, sim, view, {
        offset: config.OFFSET_DEPTH,
        rot: config.ROT_DEPTH,
        edgeRgb: config.DEPTH_EDGE_RGB,
        edgeAlpha: config.DEPTH_EDGE_ALPHA,
        nodeAlpha: config.DEPTH_NODE_ALPHA,
        nodeScale: config.DEPTH_NODE_SCALE,
        hover: false,
        ringScale: config.DEPTH_RING_SCALE,
    });
}

// The sharp near canvas: main mesh, foreground bokeh and the vignette.
export function renderMain(ctx, sim, view) {
    const { w, h } = view;
    ctx.clearRect(0, 0, w, h);

    drawMesh(ctx, sim, view, {
        offset: config.OFFSET_MAIN,
        rot: config.ROT_MAIN,
        edgeRgb: config.EDGE_RGB,
        edgeAlpha: config.EDGE_ALPHA,
        nodeAlpha: 1,
        nodeScale: 1,
        hover: true,
        ringScale: 1,
    });

    drawBokeh(ctx, sim.fgBokeh, sim.time, view, config.OFFSET_FG, config.ROT_MAIN);
    drawStars(ctx, sim.stars, view);

    // Soft vignette keeps the corners calm and the centre readable.
    ctx.fillStyle = gradients(ctx, w, h).vig;
    ctx.fillRect(0, 0, w, h);
}
