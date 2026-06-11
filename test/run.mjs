// test/run.mjs
// Headless checks for the background simulation. Run with: npm test
//
// Guards the core invariants: no crossing edges on either layer (also under
// drift, clicks and flares), full coverage of the rotation circle, graph
// connectivity, the monochrome depth palette, the rainbow main palette and
// the hard signal cap.

import { Simulation } from '../network.js';
import { config } from '../config.js';

function orient(ax, ay, bx, by, cx, cy) {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function properCross(a, b, c, d) {
    const d1 = orient(c.x, c.y, d.x, d.y, a.x, a.y);
    const d2 = orient(c.x, c.y, d.x, d.y, b.x, b.y);
    const d3 = orient(a.x, a.y, b.x, b.y, c.x, c.y);
    const d4 = orient(a.x, a.y, b.x, b.y, d.x, d.y);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

function countCrossings(net) {
    let count = 0;
    const E = net.edges, N = net.nodes;
    for (let i = 0; i < E.length; i++) {
        const e = E[i];
        for (let j = i + 1; j < E.length; j++) {
            const f = E[j];
            if (e.a === f.a || e.a === f.b || e.b === f.a || e.b === f.b) continue;
            if (properCross(N[e.a], N[e.b], N[f.a], N[f.b])) count++;
        }
    }
    return count;
}

function connected(net) {
    const seen = new Set([0]);
    const queue = [0];
    while (queue.length) {
        const u = queue.pop();
        for (const { n } of net.adj[u]) {
            if (!seen.has(n)) { seen.add(n); queue.push(n); }
        }
    }
    return seen.size === net.nodes.length;
}

// Rotating layers must cover the viewport's circumcircle (sampled boundary).
function coversCircle(net, w, h) {
    const slack = config.PARALLAX_PX + config.SWAY_AMP + 30;
    const R = Math.hypot(w, h) / 2 + slack - 2;
    const cellDiag = Math.hypot(
        w / Math.round(w / net.spacing), h / Math.round(h / net.spacing));
    for (let k = 0; k < 72; k++) {
        const ang = k / 72 * 2 * Math.PI;
        const px = w / 2 + Math.cos(ang) * R, py = h / 2 + Math.sin(ang) * R;
        let ok = false;
        for (const n of net.nodes) {
            const dx = n.hx - px, dy = n.hy - py;
            if (dx * dx + dy * dy < cellDiag * cellDiag * 2.25) { ok = true; break; }
        }
        if (!ok) return false;
    }
    return true;
}

function isGrey(colorStr) {
    const m = colorStr.match(/rgb\((\d+), (\d+), (\d+)\)/);
    const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return Math.max(r, g, b) - Math.min(r, g, b) <= 14;
}

const mainOpts = { rotFactor: config.ROT_MAIN, fgBokeh: true, stars: true };
const depthOpts = {
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
};

let failed = false;
const check = (label, ok) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
    if (!ok) failed = true;
};

// --- Static layout checks across viewport sizes -------------------------------
for (const [w, h] of [[1440, 900], [390, 844], [3840, 2160]]) {
    for (const [name, opts] of [['main', mainOpts], ['depth', depthOpts]]) {
        const t0 = process.hrtime.bigint();
        const sim = new Simulation(w, h, opts);
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        const net = sim.net;
        const label = `${w}x${h} ${name} (${net.nodes.length} nodes, `
            + `${net.edges.length} edges, ${ms.toFixed(0)} ms)`;
        check(`${label}: planar`, countCrossings(net) === 0);
        check(`${label}: connected`, connected(net));
        check(`${label}: covers rotation circle`, coversCircle(net, w, h));
    }
}

// --- Palette checks -------------------------------------------------------------
const sim = new Simulation(1440, 900, mainOpts);
const simD = new Simulation(1440, 900, depthOpts);
check('depth nodes are grey', simD.net.nodes.every(n => isGrey(n.colorStr)));
check('main nodes are colourful',
    sim.net.nodes.filter(n => !isGrey(n.colorStr)).length > sim.net.nodes.length * 0.6);
check('depth bokeh uses the grey palette',
    simD.bokeh.every(b => config.DEPTH_BOKEH_COLORS.includes(b.color)));

// --- Soak: 60 simulated seconds with clicks and button flares --------------------
let crossings = 0, maxSignals = 0;
const mainTrail = new Set(), depthTrail = new Set();
for (let step = 0; step < 60 * 20; step++) {
    sim.update(0.05);
    simD.update(0.05);
    if (step % 60 === 30) sim.burstAt(Math.random() * 1440, Math.random() * 900);
    if (step % 65 === 40) sim.fireFlares(5);
    maxSignals = Math.max(maxSignals, sim.signals.length);
    for (const e of sim.net.edges) if (e.color) mainTrail.add(e.color);
    for (const e of simD.net.edges) if (e.color) depthTrail.add(e.color);
    if (step % 20 === 19) crossings += countCrossings(sim.net) + countCrossings(simD.net);
}
check('no crossings during the soak', crossings === 0);
check(`signal hard cap respected (max seen ${maxSignals})`,
    maxSignals > 0 && maxSignals <= config.SIGNAL_HARD_CAP);
check(`main trails span the rainbow (${mainTrail.size} colours)`, mainTrail.size >= 6);
check('depth trails stay monochrome',
    depthTrail.size > 0 && [...depthTrail].every(c => config.DEPTH_SIGNAL_COLORS.includes(c)));
check('stars stay in a valid state',
    sim.stars.length > 0 && sim.stars.every(s => s.z > 0.05 && s.z <= 1.05 && s.fade >= 0));

// --- Per-frame update cost --------------------------------------------------------
const t0 = process.hrtime.bigint();
for (let i = 0; i < 600; i++) {
    sim.update(1 / 60);
    simD.update(1 / 60);
}
const perFrame = Number(process.hrtime.bigint() - t0) / 1e6 / 600;
console.log(`info update cost, both layers: ${perFrame.toFixed(3)} ms/frame`);
check('update cost under 1 ms/frame', perFrame < 1);

console.log(failed ? '\nFAILED' : '\nALL OK');
process.exit(failed ? 1 : 0);
