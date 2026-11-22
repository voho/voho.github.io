// test/run.mjs
// Headless checks for the coupled Navier-Stokes + Turing Core simulation
// and WebGL2 shaders. Run with: npm test

import { CoupledSimulation } from '../simulation.js';
import { SHADERS } from '../renderer.js';
import { config } from '../config.js';

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

// --- 1. Adaptive fluid grid & core framing across viewport sizes ------------
for (const [w, h] of [[1440, 900], [390, 844], [844, 390], [3840, 2160]]) {
    const sim = new CoupledSimulation(w, h);
    const label = `${w}x${h} (fluid ${sim.gw}x${sim.gh}, coreR=${sim.coreScreenRadiusFrac.toFixed(3)})`;
    check(`${label}: fluid axes >= min`,
        sim.gw >= config.FLUID_MIN_AXIS && sim.gh >= config.FLUID_MIN_AXIS);
    check(`${label}: core fits safely within short axis`,
        sim.coreScreenRadiusFrac > 0.2 && sim.coreScreenRadiusFrac < 0.42);
    check(`${label}: initial Turing morphogenesis active`,
        Math.max(...sim.gsV) > 0.2 && Math.min(...sim.gsV) < 0.05);
}

// --- 2. Interactive core-to-fluid & wave coupling ---------------------------
{
    const sim = new CoupledSimulation(1440, 900);
    sim.u.fill(0);
    sim.v.fill(0);
    sim.waveH.fill(0);
    const kindCore = sim.interactAt(0.5, 0.5, 0);
    let maxWave = 0;
    let fluidEnergy = 0;
    for (let i = 0; i < sim.waveH.length; i++) maxWave = Math.max(maxWave, Math.abs(sim.waveH[i]));
    for (let i = 0; i < sim.u.length; i++) fluidEnergy += Math.hypot(sim.u[i], sim.v[i]);
    check('core click returns "core", excites wave PDE & emits rim jets',
        kindCore === 'core' && maxWave > 0.5 && fluidEnergy > 50);

    sim.u.fill(0);
    sim.v.fill(0);
    const kindFluid = sim.interactAt(0.08, 0.5, 0);
    let outerEnergy = 0;
    for (let i = 0; i < sim.u.length; i++) outerEnergy += Math.hypot(sim.u[i], sim.v[i]);
    check('outer click returns "fluid" & injects vortex dipole',
        kindFluid === 'fluid' && outerEnergy > 40);
}

// --- 2b. Morphogenetic Core -> Fluid emission & Fluid -> Core viscous torque
{
    const sim = new CoupledSimulation(1440, 900);
    sim.u.fill(0); sim.v.fill(0);
    sim.dr.fill(0); sim.dg.fill(0); sim.db.fill(0);
    for (let i = 0; i < 12; i++) sim.update(0.016);
    let velEnergy = 0;
    let dyeEnergy = 0;
    for (let i = 0; i < sim.u.length; i++) {
        velEnergy += Math.hypot(sim.u[i], sim.v[i]);
        dyeEnergy += sim.dr[i] + sim.dg[i] + sim.db[i];
    }
    check(`Turing core autonomously exhales fluid + dye (vel=${velEnergy.toFixed(1)}, dye=${dyeEnergy.toFixed(1)})`,
        velEnergy > 15 && dyeEnergy > 1);

    const injectSwirl = (s, dir) => {
        const minDim = Math.min(s.width, s.height);
        const rimR = s.coreScreenRadiusFrac * 1.0;
        for (let k = 0; k < 12; k++) {
            const a = (k / 12) * Math.PI * 2;
            const nx = 0.5 + (Math.cos(a) * rimR * minDim) / s.width;
            const ny = 0.5 - (Math.sin(a) * rimR * minDim) / s.height;
            const gx = nx * (s.gw - 2) + 1;
            const gy = (1 - ny) * (s.gh - 2) + 1;
            s.splatFluid(gx, gy, 3.2, -Math.sin(a) * 18 * dir, Math.cos(a) * 18 * dir, 0, 0, 0);
        }
    };

    const ccw = new CoupledSimulation(1440, 900);
    for (let step = 0; step < 20; step++) {
        injectSwirl(ccw, 1);
        ccw.update(0.016);
    }
    const ccwSpin = ccw.coreSpinVel;

    const cw = new CoupledSimulation(1440, 900);
    for (let step = 0; step < 20; step++) {
        injectSwirl(cw, -1);
        cw.update(0.016);
    }
    const cwSpin = cw.coreSpinVel;

    check(`fluid torque accelerates & reverses core spin (CCW=${ccwSpin.toFixed(3)} > base=${config.CORE_SPIN_RAD_S} > CW=${cwSpin.toFixed(3)})`,
        ccwSpin > config.CORE_SPIN_RAD_S + 0.08 && cwSpin < config.CORE_SPIN_RAD_S - 0.08);
}

// --- 3. Phase-diagram mood steering -----------------------------------------
{
    const sim = new CoupledSimulation(1440, 900);
    sim.targetMood = 1; // LinkedIn
    for (let i = 0; i < 60; i++) sim.update(0.016);
    const fLinkedIn = sim.gsF;

    sim.targetMood = 2; // Spotify
    for (let i = 0; i < 60; i++) sim.update(0.016);
    const fSpotify = sim.gsF;

    check(`Gray-Scott F shifts with mood (LinkedIn=${fLinkedIn.toFixed(4)} > Spotify=${fSpotify.toFixed(4)})`,
        fLinkedIn > fSpotify + 0.008);
}

// --- 4. 120-step coupled soak test & incompressibility ----------------------
{
    const sim = new CoupledSimulation(1440, 900);
    for (let step = 0; step < 120; step++) {
        const t = step * 0.016;
        const nx = 0.5 + Math.cos(t * 2) * 0.3;
        const ny = 0.5 + Math.sin(t * 2) * 0.3;
        sim.pointerMove(nx, ny, -0.02 * Math.sin(t * 2), 0.02 * Math.cos(t * 2));
        if (step % 30 === 10) sim.interactAt(0.5, 0.5, 1);
        if (step % 30 === 25) sim.interactAt(0.15, 0.75, 2);
        sim.targetMood = step < 40 ? 0 : step < 80 ? 1 : 2;
        sim.update(0.016);
    }

    const arraysOk = allFinite(sim.u) && allFinite(sim.v) && allFinite(sim.div) && allFinite(sim.p)
        && allFinite(sim.dr) && allFinite(sim.dg) && allFinite(sim.db)
        && allFinite(sim.gsU) && allFinite(sim.gsV) && allFinite(sim.waveH)
        && allFinite(sim.tracerLineBuf) && allFinite(sim.starLineBuf) && allFinite(sim.starPointBuf);
    check('120-step soak leaves all simulation fields finite (0 NaNs)', arraysOk);

    const meanDiv = sim.computeMeanDivergence();
    check(`free-fluid divergence remains small (mean |div|=${meanDiv.toFixed(4)} < 0.35)`,
        meanDiv < 0.35);

    const maxV = Math.max(...sim.gsV);
    const minV = Math.min(...sim.gsV);
    check(`Turing morphogenesis structure preserved (gsV in [${minV.toFixed(3)}, ${maxV.toFixed(3)}])`,
        maxV > 0.2 && minV < 0.05);
}

// --- 4b. 3D hyperspace starfield warp deceleration & activity ---------------
{
    const sim = new CoupledSimulation(1440, 900);
    sim.ignite();
    sim.update(0.016);
    const warpSpeed = sim.starSpeed;
    for (let i = 0; i < 150; i++) sim.update(0.016);
    const cruiseSpeed = sim.starSpeed;
    let visibleStars = 0;
    for (let i = 0; i < config.STAR_COUNT; i++) {
        if (sim.starLineBuf[i * 12 + 11] > 0.04 && sim.starPointBuf[i * 7 + 5] > 0.04) visibleStars++;
    }
    check(`hyperspace starfield decelerates to cruise & stays active (warp=${warpSpeed.toFixed(3)} -> cruise=${cruiseSpeed.toFixed(3)}, visible=${visibleStars})`,
        warpSpeed > cruiseSpeed * 3 && visibleStars > 150);
}

// --- 5. Per-frame CPU update cost -------------------------------------------
{
    const sim = new CoupledSimulation(1440, 900);
    for (let i = 0; i < 20; i++) sim.update(1 / 60); // JIT warmup
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 180; i++) sim.update(1 / 60);
    const perFrame = Number(process.hrtime.bigint() - t0) / 1e6 / 180;
    console.log(`info coupled update cost: ${perFrame.toFixed(3)} ms/frame`);
    check('coupled update cost under 1.0 ms/frame', perFrame < 1.0);
}

// --- 6. GLSL shader syntax & delimiter checks -------------------------------
for (const [name, src] of Object.entries(SHADERS)) {
    const trimmed = src.trimStart();
    const hasVer = trimmed.startsWith('#version 300 es');
    let braces = 0;
    let parens = 0;
    let balanced = true;
    for (const ch of trimmed) {
        if (ch === '{') braces++;
        else if (ch === '}') braces--;
        else if (ch === '(') parens++;
        else if (ch === ')') parens--;
        if (braces < 0 || parens < 0) balanced = false;
    }
    check(`shader ${name}: valid #version 300 es & balanced delimiters`,
        hasVer && balanced && braces === 0 && parens === 0);
}

console.log(failed ? '\nFAILED' : '\nALL OK');
process.exit(failed ? 1 : 0);
