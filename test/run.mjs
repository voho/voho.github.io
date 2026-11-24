// test/run.mjs
// Headless checks for the BlackHoleSimulation engine and WebGL2 shaders.
// Run with: npm test

import { BlackHoleSimulation } from '../simulation.js';
import { SHADERS } from '../renderer.js';
import { config } from '../config.js';
import { QualityGovernor } from '../quality.js';

let failed = false;
const check = (label, ok) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
    if (!ok) failed = true;
};

function allFinite(arr) {
    for (let i = 0; i < arr.length; i++) {
        if (!Number.isFinite(arr[i])) return false;
    }
    return true;
}

function dot3(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

// --- 1. Adaptive camera framing & sky invariance across hover moods ---------
for (const [w, h] of [[1440, 900], [390, 844], [844, 390], [3840, 2160]]) {
    const sim = new BlackHoleSimulation(w, h);
    const cam0 = [sim.cam.ro[0], sim.cam.ro[1], sim.cam.ro[2]];
    const dir0 = [sim.cam.ww[0], sim.cam.ww[1], sim.cam.ww[2]];
    sim.targetMood = 1;
    for (let i = 0; i < 60; i++) sim.update(0.016, {}, { x: 0, y: 0 });
    sim.targetMood = 2;
    for (let i = 0; i < 60; i++) sim.update(0.016, {}, { x: 0, y: 0 });

    const camDrift = Math.hypot(sim.cam.ro[0] - cam0[0], sim.cam.ro[1] - cam0[1], sim.cam.ro[2] - cam0[2]);
    const dirDrift = Math.hypot(sim.cam.ww[0] - dir0[0], sim.cam.ww[1] - dir0[1], sim.cam.ww[2] - dir0[2]);
    check(`${w}x${h} (dist=${sim.cam.dist.toFixed(1)}): camera stays locked on mood switches (stationary starfield)`,
        camDrift === 0 && dirDrift === 0 && sim.activeCount > 10);
}

// --- 2. Smooth black hole morphing & orthonormal basis ----------------------
{
    const sim = new BlackHoleSimulation(1440, 900);
    const startActive = sim.activeCount;
    check('starts on M87* Horizon baseline (wM87 = 1)',
        sim.wM87 > 0.99 && sim.wGarg < 0.01 && sim.wCyg < 0.01);

    sim.targetMood = 1; // Gargantua
    for (let i = 0; i < 90; i++) sim.update(0.016);
    const gargOk = sim.wGarg > 0.95 && Math.abs(sim.curTilt - config.VARIANTS[1].tilt) < 0.05;

    sim.targetMood = 2; // Cygnus X-1
    for (let i = 0; i < 90; i++) sim.update(0.016);
    const cygOk = sim.wCyg > 0.95 && Math.abs(sim.curTilt - config.VARIANTS[2].tilt) < 0.05;

    const o1 = Math.abs(dot3(sim.bhT1, sim.bhN));
    const o2 = Math.abs(dot3(sim.bhT1, sim.bhT2));
    const o3 = Math.abs(dot3(sim.bhN, sim.bhT2));
    const n1 = Math.hypot(sim.bhT1[0], sim.bhT1[1], sim.bhT1[2]);
    const n2 = Math.hypot(sim.bhN[0], sim.bhN[1], sim.bhN[2]);
    const n3 = Math.hypot(sim.bhT2[0], sim.bhT2[1], sim.bhT2[2]);
    const basisOk = o1 < 1e-5 && o2 < 1e-5 && o3 < 1e-5
        && Math.abs(n1 - 1) < 1e-5 && Math.abs(n2 - 1) < 1e-5 && Math.abs(n3 - 1) < 1e-5;

    sim.targetMood = 0; // Return to M87*
    for (let i = 0; i < 120; i++) sim.update(0.016);
    const returnOk = sim.wM87 > 0.96 && sim.activeCount > 10 && startActive > 10;

    check(`smooth transitions M87* -> Gargantua -> Cygnus X-1 -> M87* with orthonormal basis & preserved particles`,
        gargOk && cygOk && basisOk && returnOk);
}

// --- 3. Cursor particle emission, infall, oblivion fade & horizon absorption
{
    const sim = new BlackHoleSimulation(1440, 900);
    sim.interactAt(0.72, 0.35);
    sim.interactAt(0.28, 0.65);
    let sawOblivionPhase = false;
    for (let step = 0; step < 180; step++) {
        if (step % 15 === 0) {
            sim.pointerMove(0.3 + (step % 5) * 0.1, 0.25 + (step % 3) * 0.15, 0.01, -0.01, false);
        }
        sim.update(0.016);
        for (let i = 0; i < config.MAX_PARTICLES; i++) {
            if (sim.pState[i] === 2 && sim.pFade[i] > 0 && sim.pFade[i] < 1) {
                sawOblivionPhase = true;
                break;
            }
        }
    }
    check(`particles fall in, enter horizon oblivion fade, increment capturedCount=${sim.capturedCount}, pulse absorbGlow=${sim.absorbGlow.toFixed(3)}`,
        sim.capturedCount > 5 && sim.absorbGlow > 0.01 && sawOblivionPhase);
}

// --- 4. 180-step coupled soak test (0 NaNs) ---------------------------------
{
    const sim = new BlackHoleSimulation(1440, 900);
    for (let step = 0; step < 180; step++) {
        const t = step * 0.016;
        const nx = 0.5 + Math.cos(t * 2) * 0.3;
        const ny = 0.5 + Math.sin(t * 2) * 0.3;
        sim.pointerMove(nx, ny, -0.02 * Math.sin(t * 2), 0.02 * Math.cos(t * 2), step % 20 < 8);
        if (step % 45 === 10) sim.interactAt(0.5, 0.5);
        sim.targetMood = step < 60 ? 0 : step < 120 ? 1 : 2;
        sim.update(0.016, {}, { x: Math.cos(t) * 0.5, y: Math.sin(t) * 0.3 });
    }

    const drawCountOk = sim.drawCount > 0 && sim.drawCount <= config.MAX_PARTICLES;
    const arraysOk = drawCountOk
        && allFinite(sim.px) && allFinite(sim.py) && allFinite(sim.pz)
        && allFinite(sim.pvx) && allFinite(sim.pvy) && allFinite(sim.pvz)
        && allFinite(sim.pFade)
        && allFinite(sim.pLineBuf.subarray(0, sim.drawCount * 12))
        && allFinite(sim.pHeadBuf.subarray(0, sim.drawCount * 7))
        && allFinite(sim.bhT1) && allFinite(sim.bhN) && allFinite(sim.bhT2);
    check(`180-step soak leaves all simulation arrays finite (0 NaNs, drawCount=${sim.drawCount})`, arraysOk);
}

// --- 5. Per-frame CPU update cost -------------------------------------------
{
    const sim = new BlackHoleSimulation(1440, 900);
    sim.interactAt(0.7, 0.3);
    for (let i = 0; i < 20; i++) sim.update(1 / 60); // JIT warmup
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 180; i++) sim.update(1 / 60);
    const perFrame = Number(process.hrtime.bigint() - t0) / 1e6 / 180;
    console.log(`info black hole CPU update cost: ${perFrame.toFixed(3)} ms/frame`);
    check('CPU update cost under 0.5 ms/frame', perFrame < 0.5);
}

// --- 6. GLSL shader syntax & delimiter checks -------------------------------
const shaderNames = Object.keys(SHADERS);
check('renderer exports all 10 expected shaders', shaderNames.length === 10);
for (const [name, src] of Object.entries(SHADERS)) {
    const hasVer = src.startsWith('#version 300 es');
    let braces = 0;
    let parens = 0;
    let balanced = true;
    for (const ch of src) {
        if (ch === '{') braces++;
        else if (ch === '}') braces--;
        else if (ch === '(') parens++;
        else if (ch === ')') parens--;
        if (braces < 0 || parens < 0) balanced = false;
    }
    check(`shader ${name}: valid #version 300 es (byte 0) & balanced delimiters`,
        hasVer && balanced && braces === 0 && parens === 0);
}

// --- 7. Intro fly-in settles on the framed distance -------------------------
{
    const sim = new BlackHoleSimulation(1440, 900);
    const settled = sim.cam.dist;
    sim.ignite();
    sim.update(0.016);
    const pulledBack = sim.cam.dist;
    for (let i = 0; i < 600; i++) sim.update(0.016);
    check('ignite pulls the camera back, then eases it to the framed distance',
        pulledBack > settled * 1.2 && Math.abs(sim.cam.dist - settled) < 0.01);
}

// --- 8. Adaptive quality governor -------------------------------------------
{
    const run = (gov, fps, seconds) => {
        for (let i = 0; i < fps * seconds; i++) gov.sample(1 / fps, 60);
    };

    const slow = new QualityGovernor(false);
    run(slow, 20, 30);
    const s = slow.settings;
    check('a slow device bottoms out at minimum scale with lite effects',
        s.scale === config.SCALE_MIN && s.bloom === false && s.marchSteps === config.LITE.marchSteps);

    const fast = new QualityGovernor(true);
    run(fast, 60, 60);
    check('a fast device climbs from the low-power start to full quality',
        fast.scale === 1 && !fast.lite && fast.settings.dust === config.DUST_COUNT);

    const hiccup = new QualityGovernor(false);
    run(hiccup, 60, 5);
    hiccup.sample(0.4, 60);
    run(hiccup, 60, 5);
    check('a single long frame does not cost quality', hiccup.scale === 1 && !hiccup.lite);

    // A device that only holds 60 fps below scale 0.8: each failed probe
    // upward must double the wait before the next one.
    const edge = new QualityGovernor(false);
    let changes = 0;
    for (let i = 0; i < 60 * 240; i++) {
        const fps = edge.scale > 0.8 ? 40 : 60;
        if (edge.sample(1 / fps, 60)) changes++;
    }
    const reading = new QualityGovernor(true);
    for (let i = 0; i < 30 * 60; i++) reading.sample(1 / 30, 30, false);
    check('quality never rises while the visitor is idle (reading)',
        reading.scale === config.SCALE_START_LOW_POWER);
    for (let i = 0; i < 30 * 60; i++) reading.sample(1 / 10, 30, false);
    check('quality can still drop while idle', reading.scale < config.SCALE_START_LOW_POWER);

    check(`a borderline device stops oscillating (${changes} level changes in 4 min, wait=${edge.probeAfter}s)`,
        changes <= 12 && edge.probeAfter === config.QUALITY_PROBE_MAX_S && edge.scale <= 0.92);
}

// --- 9. Lowered particle capacity --------------------------------------------
{
    const sim = new BlackHoleSimulation(1440, 900);
    sim.cursorIdx = 900;
    sim.spawnParticle(4, 0, 0, 0, 0, 0);
    const before = sim.px[900];
    sim.update(0.016, { maxParticles: 500 });
    check('particles above a lowered capacity keep moving', sim.px[900] !== before);
    sim.spawnParticle(4, 0, 0, 0, 0, 0);
    check('new particles spawn inside the lowered capacity', sim.cursorIdx < 500);
}

console.log(failed ? '\nFAILED' : '\nALL OK');
process.exit(failed ? 1 : 0);
