// simulation.js
// Pure, DOM-free coupled procedural simulation:
//   1. Adaptive incompressible Navier-Stokes (Stable Fluids) Eulerian grid
//      with solid-body obstacle coupling around the central 3D core
//   2. 96x64 Gray-Scott reaction-diffusion PDE + 2D damped wave PDE
//   3. Lagrangian tracer particles advected along the solved velocity field

import { config } from './config.js';

const TAU = Math.PI * 2;

const PALETTE_RGB = config.PALETTE.map((hex) => {
    const v = parseInt(hex.slice(1), 16);
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
});

function clamp(x, lo, hi) {
    return x < lo ? lo : x > hi ? hi : x;
}

export class CoupledSimulation {
    constructor(width, height) {
        this.time = 0;
        this.igniteT = 0;
        this.width = 1;
        this.height = 1;
        this.gw = 0;
        this.gh = 0;
        this.gSize = 0;
        this.coreScale = 1;
        this.coreScreenRadiusFrac = config.CORE_FLUID_RADIUS_FRAC;

        // Smoothed interaction state
        this.wLinkedIn = 0;
        this.wSpotify = 0;
        this.targetMood = 0;
        this.pointer = { x: 0.5, y: 0.5, vx: 0, vy: 0, strength: 0 };
        this.buttonSpot = { x: 0.5, y: 0.65 };

        // Turing & wave PDE fields (fixed spherical grid)
        this.tw = config.TURING_W;
        this.th = config.TURING_H;
        const tSize = this.tw * this.th;
        this.gsU = new Float32Array(tSize);
        this.gsV = new Float32Array(tSize);
        this.gsU2 = new Float32Array(tSize);
        this.gsV2 = new Float32Array(tSize);
        this.waveH = new Float32Array(tSize);
        this.wavePrev = new Float32Array(tSize);
        this.waveNext = new Float32Array(tSize);
        this.turingTexBytes = new Uint8Array(tSize * 4);
        this.gsF = config.GS_F_BASE;
        this.gsK = config.GS_K_BASE;

        // Lagrangian tracer buffers
        const maxT = config.TRACER_COUNT;
        this.tx = new Float32Array(maxT);
        this.ty = new Float32Array(maxT);
        this.tAge = new Float32Array(maxT);
        this.tLife = new Float32Array(maxT);
        this.tHue = new Float32Array(maxT);
        this.tracerBuf = new Float32Array(maxT * 5);

        this.resize(width, height);
        this._initTracers();
        this.seed(config.GS_WARMUP_INIT);
    }

    resize(width, height) {
        this.width = Math.max(1, width);
        this.height = Math.max(1, height);
        const rawAspect = this.width / this.height;
        this.coreScale = rawAspect < config.CORE_NARROW_ASPECT ? config.CORE_NARROW_SCALE : 1.0;

        const rEff = config.CORE_WORLD_RADIUS * this.coreScale;
        const camZ = config.CORE_CAM_Z;
        this.coreScreenRadiusFrac = (rEff / Math.sqrt(camZ * camZ - rEff * rEff)) * config.CORE_CAM_FOV;

        const clampedAspect = clamp(rawAspect, 1 / config.FLUID_MAX_ASPECT, config.FLUID_MAX_ASPECT);
        const gh = Math.max(config.FLUID_MIN_AXIS, Math.round(Math.sqrt(config.FLUID_TARGET_CELLS / clampedAspect)));
        const gw = Math.max(config.FLUID_MIN_AXIS, Math.round(gh * clampedAspect));

        if (gw === this.gw && gh === this.gh) return false;

        this.gw = gw;
        this.gh = gh;
        this.gSize = gw * gh;
        const n = this.gSize;

        this.u = new Float32Array(n);
        this.v = new Float32Array(n);
        this.u0 = new Float32Array(n);
        this.v0 = new Float32Array(n);
        this.div = new Float32Array(n);
        this.p = new Float32Array(n);
        this.curl = new Float32Array(n);
        this.dr = new Float32Array(n);
        this.dg = new Float32Array(n);
        this.db = new Float32Array(n);
        this.dr0 = new Float32Array(n);
        this.dg0 = new Float32Array(n);
        this.db0 = new Float32Array(n);
        this.fluidTexBytes = new Uint8Array(n * 4);
        return true;
    }

    _resetTracer(i) {
        // Spawn away from the deep interior of the core so tracers frame it cleanly
        let x = Math.random();
        let y = Math.random();
        const minDim = Math.min(this.width, this.height);
        const sx = (x - 0.5) * this.width / minDim;
        const sy = (y - 0.5) * this.height / minDim;
        if (Math.hypot(sx, sy) < this.coreScreenRadiusFrac * 0.92) {
            const ang = Math.random() * TAU;
            const rr = this.coreScreenRadiusFrac * (1.02 + Math.random() * 0.28);
            x = clamp(0.5 + (Math.cos(ang) * rr * minDim) / this.width, 0.02, 0.98);
            y = clamp(0.5 + (Math.sin(ang) * rr * minDim) / this.height, 0.02, 0.98);
        }
        this.tx[i] = x;
        this.ty[i] = y;
        this.tAge[i] = 0;
        this.tLife[i] = config.TRACER_LIFE_MIN
            + Math.random() * (config.TRACER_LIFE_MAX - config.TRACER_LIFE_MIN);
        this.tHue[i] = Math.random();
    }

    _initTracers() {
        for (let i = 0; i < config.TRACER_COUNT; i++) {
            this._resetTracer(i);
            this.tAge[i] = Math.random() * this.tLife[i];
        }
    }

    seed(turingWarmup = config.GS_WARMUP_INIT) {
        this.igniteT = 0;
        this.u.fill(0); this.v.fill(0);
        this.u0.fill(0); this.v0.fill(0);
        this.p.fill(0); this.div.fill(0); this.curl.fill(0);
        this.dr.fill(0); this.dg.fill(0); this.db.fill(0);
        this.dr0.fill(0); this.dg0.fill(0); this.db0.fill(0);

        this.gsU.fill(1.0);
        this.gsV.fill(0.0);
        this.waveH.fill(0.0);
        this.wavePrev.fill(0.0);
        this.waveNext.fill(0.0);

        // Symmetric chemical seeds around equatorial band and mid-latitudes
        for (let k = 0; k < 7; k++) {
            const su = (k / 7 + 0.07) % 1.0;
            const sv = 0.5 + 0.16 * Math.sin(k * 2.1);
            this.disturbTuring(su, sv, 0.9, 0.52, 4.0);
        }
        this.disturbTuring(0.25, 0.28, 0.55, 0.45, 3.5);
        this.disturbTuring(0.75, 0.72, 0.55, 0.45, 3.5);
        this.stepTuring(0.016, turingWarmup, true);

        // Radiate 4 symmetric swirling jets outward from the core rim
        this._emitCoreRimJets(4, 1.0, 0);
        for (let i = 0; i < 10; i++) {
            this.stepFluid(0.016, config.FLUID_PRESSURE_ITERS, config.TRACER_COUNT, false);
        }
    }

    ignite() {
        this.seed(config.GS_WARMUP_IGNITE);
    }

    _emitCoreRimJets(count, strength = 1.0, moodOverride = 0) {
        const minDim = Math.min(this.width, this.height);
        const rimR = this.coreScreenRadiusFrac * 1.12;
        for (let k = 0; k < count; k++) {
            const a = (k / count) * TAU + this.time * 0.35 + 0.4;
            const nx = 0.5 + (Math.cos(a) * rimR * minDim) / this.width;
            const ny = 0.5 - (Math.sin(a) * rimR * minDim) / this.height;
            const gx = clamp(nx, 0.05, 0.95) * (this.gw - 2) + 1;
            const gy = clamp(1 - ny, 0.05, 0.95) * (this.gh - 2) + 1;
            const fx = Math.cos(a + 0.55) * config.FLUID_BURST_FORCE * strength;
            const fy = Math.sin(a + 0.55) * config.FLUID_BURST_FORCE * strength;
            const col = this._moodColor(moodOverride, k * 2);
            this.splatFluid(gx, gy, 4.4, fx, fy, col[0] * 0.95, col[1] * 0.95, col[2] * 0.95);
        }
    }

    _moodColor(moodOverride, offset = 0) {
        if (moodOverride === 1) return [0.28, 0.78, 1.0];
        if (moodOverride === 2) return [0.18, 0.94, 0.68];
        const idx = (Math.floor(this.time * 2.2) + offset) % PALETTE_RGB.length;
        return PALETTE_RGB[idx < 0 ? idx + PALETTE_RGB.length : idx];
    }

    // Maps normalized screen [0..1]^2 coordinates to front hemisphere UV of the 3D core
    screenToCoreUv(nx, ny) {
        const minDim = Math.min(this.width, this.height);
        const uvX = (nx - 0.5) * this.width / minDim;
        const uvY = (0.5 - ny) * this.height / minDim;
        const r = this.coreScreenRadiusFrac;
        const sx = uvX / r;
        const sy = uvY / r;
        const r2 = sx * sx + sy * sy;
        if (r2 > 0.98) return null;
        const sz = Math.sqrt(Math.max(0, 1 - r2));

        // Un-rotate by core's continuous spin so clicks hit exact visible surface point
        const a = -this.time * config.CORE_SPIN_RAD_S;
        const rx = sx * Math.cos(a) - sz * Math.sin(a);
        const rz = sx * Math.sin(a) + sz * Math.cos(a);
        const u = ((Math.atan2(rz, rx) / TAU + 0.5) % 1 + 1) % 1;
        const v = Math.acos(clamp(sy, -1, 1)) / Math.PI;
        return { u, v };
    }

    disturbTuring(su, sv, waveAmp = 0.65, chemAmp = 0.35, radius = 3.2) {
        const tw = this.tw, th = this.th;
        const gx = ((su % 1) + 1) % 1 * tw;
        const gy = clamp(sv * th, 2, th - 3);
        const rCeil = Math.ceil(radius);
        for (let dy = -rCeil; dy <= rCeil; dy++) {
            const y = Math.round(gy + dy);
            if (y < 1 || y >= th - 1) continue;
            for (let dx = -rCeil; dx <= rCeil; dx++) {
                const d2 = dx * dx + dy * dy;
                if (d2 > radius * radius) continue;
                const x = ((Math.round(gx + dx) % tw) + tw) % tw;
                const w = Math.exp(-d2 / (radius * 0.9));
                const idx = y * tw + x;
                this.waveH[idx] = clamp(this.waveH[idx] + waveAmp * w, -config.WAVE_CLAMP, config.WAVE_CLAMP);
                if (chemAmp > 0) {
                    this.gsV[idx] = Math.min(1, this.gsV[idx] + chemAmp * w);
                    this.gsU[idx] = Math.max(0, this.gsU[idx] - chemAmp * 0.6 * w);
                }
            }
        }
    }

    splatFluid(gx, gy, rad, fx, fy, r, g, b) {
        const gw = this.gw, gh = this.gh;
        const x0 = Math.max(1, Math.floor(gx - rad));
        const x1 = Math.min(gw - 2, Math.ceil(gx + rad));
        const y0 = Math.max(1, Math.floor(gy - rad));
        const y1 = Math.min(gh - 2, Math.ceil(gy + rad));
        const invR2 = 1 / Math.max(0.5, rad * rad);
        for (let j = y0; j <= y1; j++) {
            const dy = j - gy;
            const row = j * gw;
            for (let i = x0; i <= x1; i++) {
                const dx = i - gx;
                const w = Math.exp(-(dx * dx + dy * dy) * invR2 * 2.2);
                const idx = row + i;
                this.u[idx] += fx * w;
                this.v[idx] += fy * w;
                this.dr[idx] = Math.min(2.2, this.dr[idx] + r * w);
                this.dg[idx] = Math.min(2.2, this.dg[idx] + g * w);
                this.db[idx] = Math.min(2.2, this.db[idx] + b * w);
            }
        }
    }

    pointerMove(nx, ny, vx, vy) {
        this.pointer.x = nx;
        this.pointer.y = ny;
        this.pointer.vx = vx;
        this.pointer.vy = vy;
        this.pointer.strength = 1;

        const uv = this.screenToCoreUv(nx, ny);
        if (uv) {
            this.disturbTuring(uv.u, uv.v, 0.14, 0.03, 2.2);
        }
    }

    interactAt(nx, ny, moodOverride = 0) {
        const coreUv = this.screenToCoreUv(nx, ny);
        if (coreUv) {
            // Striking the core creates a standing wave + fresh Turing seed AND blasts outward into the fluid
            this.disturbTuring(coreUv.u, coreUv.v, 1.15, 0.55, 4.2);
            this._emitCoreRimJets(4, 0.9, moodOverride);
            return 'core';
        }

        const gx = clamp(nx, 0.03, 0.97) * (this.gw - 2) + 1;
        const gy = clamp(1 - ny, 0.03, 0.97) * (this.gh - 2) + 1;
        const col = this._moodColor(moodOverride, 1);
        const f = config.FLUID_BURST_FORCE;
        this.splatFluid(gx - 1.5, gy, 4.4, 0, f, col[0] * 0.95, col[1] * 0.95, col[2] * 0.95);
        this.splatFluid(gx + 1.5, gy, 4.4, 0, -f, col[0] * 0.75, col[1] * 0.85, col[2] * 1.1);
        return 'fluid';
    }

    buttonHoverPulse(nx, ny, mood) {
        this.buttonSpot.x = nx;
        this.buttonSpot.y = ny;
        const gx = clamp(nx, 0.05, 0.95) * (this.gw - 2) + 1;
        const gy = clamp(1 - ny, 0.05, 0.95) * (this.gh - 2) + 1;
        const col = this._moodColor(mood, 0);
        this.splatFluid(gx, gy, 4.5, 0, 18, col[0] * 0.45, col[1] * 0.45, col[2] * 0.45);
        const frontUv = this.screenToCoreUv(nx, ny) || this.screenToCoreUv(0.5, 0.58);
        if (frontUv) this.disturbTuring(frontUv.u, frontUv.v, 0.45, 0.25, 3.0);
    }

    _setBnd(b, x) {
        const gw = this.gw, gh = this.gh;
        for (let i = 1; i < gw - 1; i++) {
            x[i] = b === 2 ? -x[gw + i] : x[gw + i];
            x[(gh - 1) * gw + i] = b === 2 ? -x[(gh - 2) * gw + i] : x[(gh - 2) * gw + i];
        }
        for (let j = 1; j < gh - 1; j++) {
            x[j * gw] = b === 1 ? -x[j * gw + 1] : x[j * gw + 1];
            x[j * gw + gw - 1] = b === 1 ? -x[j * gw + gw - 2] : x[j * gw + gw - 2];
        }
        x[0] = 0.5 * (x[1] + x[gw]);
        x[gw - 1] = 0.5 * (x[gw - 2] + x[2 * gw - 1]);
        x[(gh - 1) * gw] = 0.5 * (x[(gh - 2) * gw] + x[(gh - 1) * gw + 1]);
        x[gh * gw - 1] = 0.5 * (x[gh * gw - 2] + x[(gh - 1) * gw - 1]);
    }

    _advect(b, d, d0, velU, velV, dt, damp) {
        const gw = this.gw, gh = this.gh;
        const maxX = gw - 1.5;
        const maxY = gh - 1.5;
        for (let j = 1; j < gh - 1; j++) {
            const row = j * gw;
            for (let i = 1; i < gw - 1; i++) {
                const idx = row + i;
                let x = i - dt * velU[idx];
                let y = j - dt * velV[idx];
                if (x < 0.5) x = 0.5; else if (x > maxX) x = maxX;
                if (y < 0.5) y = 0.5; else if (y > maxY) y = maxY;
                const i0 = x | 0, i1 = i0 + 1;
                const j0 = y | 0, j1 = j0 + 1;
                const s1 = x - i0, s0 = 1 - s1;
                const t1 = y - j0, t0 = 1 - t1;
                const r0 = j0 * gw, r1 = j1 * gw;
                d[idx] = damp * (
                    s0 * (t0 * d0[r0 + i0] + t1 * d0[r1 + i0]) +
                    s1 * (t0 * d0[r0 + i1] + t1 * d0[r1 + i1])
                );
            }
        }
        this._setBnd(b, d);
    }

    _vorticityConfinement(dt) {
        const gw = this.gw, gh = this.gh;
        const u = this.u, v = this.v, curl = this.curl;
        for (let j = 1; j < gh - 1; j++) {
            const row = j * gw;
            for (let i = 1; i < gw - 1; i++) {
                const idx = row + i;
                curl[idx] = 0.5 * ((v[idx + 1] - v[idx - 1]) - (u[idx + gw] - u[idx - gw]));
            }
        }
        const eps = config.FLUID_VORTICITY;
        for (let j = 2; j < gh - 2; j++) {
            const row = j * gw;
            for (let i = 2; i < gw - 2; i++) {
                const idx = row + i;
                const dwDx = (Math.abs(curl[idx + 1]) - Math.abs(curl[idx - 1])) * 0.5;
                const dwDy = (Math.abs(curl[idx + gw]) - Math.abs(curl[idx - gw])) * 0.5;
                const len = Math.sqrt(dwDx * dwDx + dwDy * dwDy) + 1e-5;
                const c = curl[idx];
                u[idx] += eps * (dwDy / len) * c * dt;
                v[idx] -= eps * (dwDx / len) * c * dt;
            }
        }
    }

    _applyCoreBoundary(dt, coupleWaves) {
        const gw = this.gw, gh = this.gh;
        const minDim = Math.min(this.width, this.height);
        const scaleX = this.width / minDim;
        const scaleY = this.height / minDim;
        const coreR = this.coreScreenRadiusFrac;
        const invR = 1 / coreR;
        const innerR2 = (coreR * 0.85) ** 2;
        const outerR2 = (coreR * 1.12) ** 2;
        const spinOffset = this.time * config.CORE_SPIN_RAD_S;

        for (let j = 1; j < gh - 1; j++) {
            const sy = ((j + 0.5) / gh - 0.5) * scaleY;
            const sy2 = sy * sy;
            const row = j * gw;
            for (let i = 1; i < gw - 1; i++) {
                const sx = ((i + 0.5) / gw - 0.5) * scaleX;
                const d2 = sx * sx + sy2;
                if (d2 >= outerR2) continue;

                const idx = row + i;
                if (d2 < innerR2) {
                    // Solid-body interior damping so streams split smoothly around the obsidian core
                    this.u[idx] *= 0.65;
                    this.v[idx] *= 0.65;
                    this.dr[idx] *= 0.78;
                    this.dg[idx] *= 0.78;
                    this.db[idx] *= 0.78;
                } else {
                    // Boundary layer deflection & fluid-to-core wave coupling
                    const len = Math.sqrt(d2) + 1e-5;
                    const nx = sx / len, ny = sy / len;
                    const vn = this.u[idx] * nx + this.v[idx] * ny;
                    if (vn < 0) {
                        this.u[idx] -= vn * nx * 0.9;
                        this.v[idx] -= vn * ny * 0.9;
                    }
                    if (coupleWaves && ((i + j) & 1) === 0) {
                        const speed2 = this.u[idx] * this.u[idx] + this.v[idx] * this.v[idx];
                        if (speed2 > 72.25) {
                            const speed = Math.sqrt(speed2);
                            const az = Math.atan2(0.2, sx * invR) - spinOffset;
                            const su = ((az / TAU + 0.5) % 1 + 1) % 1;
                            const sv = Math.acos(clamp(sy * invR, -0.96, 0.96)) / Math.PI;
                            const gx = ((su * this.tw) | 0) % this.tw;
                            const gy = clamp((sv * this.th) | 0, 1, this.th - 2);
                            const wIdx = gy * this.tw + gx;
                            const ripple = Math.min(0.04, (speed - 8.5) * 0.0022 * dt * 60);
                            this.waveH[wIdx] = clamp(this.waveH[wIdx] + ripple, -config.WAVE_CLAMP, config.WAVE_CLAMP);
                        }
                    }
                }
            }
        }
    }

    _project(iters) {
        const gw = this.gw, gh = this.gh;
        const u = this.u, v = this.v, div = this.div, p = this.p;
        for (let j = 1; j < gh - 1; j++) {
            const row = j * gw;
            for (let i = 1; i < gw - 1; i++) {
                const idx = row + i;
                div[idx] = -0.5 * (u[idx + 1] - u[idx - 1] + v[idx + gw] - v[idx - gw]);
                p[idx] *= 0.78;
            }
        }
        this._setBnd(0, div);
        this._setBnd(0, p);

        for (let k = 0; k < iters; k++) {
            for (let j = 1; j < gh - 1; j++) {
                const row = j * gw;
                for (let i = 1; i < gw - 1; i++) {
                    const idx = row + i;
                    p[idx] = (div[idx] + p[idx - 1] + p[idx + 1] + p[idx - gw] + p[idx + gw]) * 0.25;
                }
            }
            this._setBnd(0, p);
        }

        const maxV = config.FLUID_MAX_VEL;
        for (let j = 1; j < gh - 1; j++) {
            const row = j * gw;
            for (let i = 1; i < gw - 1; i++) {
                const idx = row + i;
                u[idx] = clamp(u[idx] - 0.5 * (p[idx + 1] - p[idx - 1]), -maxV, maxV);
                v[idx] = clamp(v[idx] - 0.5 * (p[idx + gw] - p[idx - gw]), -maxV, maxV);
            }
        }
        this._setBnd(1, u);
        this._setBnd(2, v);
    }

    computeMeanDivergence() {
        const gw = this.gw, gh = this.gh;
        const minDim = Math.min(this.width, this.height);
        const scaleX = this.width / minDim;
        const scaleY = this.height / minDim;
        const invR = 1 / this.coreScreenRadiusFrac;
        let sum = 0;
        let count = 0;
        for (let j = 2; j < gh - 2; j++) {
            const sy = ((j + 0.5) / gh - 0.5) * scaleY;
            const row = j * gw;
            for (let i = 2; i < gw - 2; i++) {
                const sx = ((i + 0.5) / gw - 0.5) * scaleX;
                if (Math.hypot(sx, sy) * invR <= 1.15) continue;
                const idx = row + i;
                const d = 0.5 * (this.u[idx + 1] - this.u[idx - 1] + this.v[idx + gw] - this.v[idx - gw]);
                sum += Math.abs(d);
                count++;
            }
        }
        return count > 0 ? sum / count : 0;
    }

    stepFluid(dt, pressureIters = config.FLUID_PRESSURE_ITERS, tracerCount = config.TRACER_COUNT, coupleWaves = true) {
        const sdt = Math.min(dt, 0.025);
        const t = this.time;
        const gw = this.gw, gh = this.gh;

        // Ambient counter-rotating orbital jets keep smooth currents alive
        for (let k = 0; k < 2; k++) {
            const a = t * (k === 0 ? 0.52 : -0.40) + k * Math.PI;
            const gx = gw * (0.5 + Math.cos(a) * 0.37);
            const gy = gh * (0.5 + Math.sin(a) * 0.35);
            const f = config.FLUID_AMBIENT_FORCE * (k === 0 ? 1 : -0.9);
            const fx = -Math.sin(a) * f * sdt * 8;
            const fy = Math.cos(a) * f * sdt * 8;
            const r = k === 0 ? 0.09 + this.wLinkedIn * 0.04 : 0.16 + this.wSpotify * 0.06;
            const g = k === 0 ? 0.22 + this.wSpotify * 0.14 : 0.12 + this.wSpotify * 0.16;
            const b = k === 0 ? 0.36 + this.wLinkedIn * 0.14 : 0.34;
            this.splatFluid(gx, gy, 3.6, fx, fy, r * sdt * 3.8, g * sdt * 3.8, b * sdt * 3.8);
        }

        // Pointer drag momentum & dye
        if (this.pointer.strength > 0.05 && (Math.abs(this.pointer.vx) > 0.002 || Math.abs(this.pointer.vy) > 0.002)) {
            const gx = this.pointer.x * (gw - 2) + 1;
            const gy = (1 - this.pointer.y) * (gh - 2) + 1;
            const col = this._moodColor(this.targetMood, 0);
            const fx = clamp(this.pointer.vx * config.FLUID_POINTER_FORCE, -36, 36);
            const fy = clamp(-this.pointer.vy * config.FLUID_POINTER_FORCE, -36, 36);
            this.splatFluid(gx, gy, 3.5, fx, fy, col[0] * 0.45, col[1] * 0.45, col[2] * 0.45);
        }

        // Hover laminar swirl behind hovered button
        if (this.targetMood > 0) {
            const gx = this.buttonSpot.x * (gw - 2) + 1;
            const gy = (1 - this.buttonSpot.y) * (gh - 2) + 1;
            const col = this._moodColor(this.targetMood, 0);
            this.splatFluid(gx, gy, 4.0, Math.cos(t * 3) * 8 * sdt * 8, 12 * sdt * 8,
                col[0] * 0.055, col[1] * 0.055, col[2] * 0.055);
        }

        this._vorticityConfinement(sdt);

        let tmp = this.u; this.u = this.u0; this.u0 = tmp;
        tmp = this.v; this.v = this.v0; this.v0 = tmp;
        this._advect(1, this.u, this.u0, this.u0, this.v0, sdt, config.FLUID_VEL_DAMP);
        this._advect(2, this.v, this.v0, this.u0, this.v0, sdt, config.FLUID_VEL_DAMP);
        this._applyCoreBoundary(sdt, coupleWaves);
        this._project(pressureIters);

        tmp = this.dr; this.dr = this.dr0; this.dr0 = tmp;
        tmp = this.dg; this.dg = this.dg0; this.dg0 = tmp;
        tmp = this.db; this.db = this.db0; this.db0 = tmp;
        this._advect(0, this.dr, this.dr0, this.u, this.v, sdt, config.FLUID_DYE_DAMP);
        this._advect(0, this.dg, this.dg0, this.u, this.v, sdt, config.FLUID_DYE_DAMP);
        this._advect(0, this.db, this.db0, this.u, this.v, sdt, config.FLUID_DYE_DAMP);

        // Pack RGBA8 fluid texture
        const bytes = this.fluidTexBytes;
        for (let i = 0; i < this.gSize; i++) {
            const o = i * 4;
            bytes[o] = clamp((this.dr[i] * 185) | 0, 0, 255);
            bytes[o + 1] = clamp((this.dg[i] * 185) | 0, 0, 255);
            bytes[o + 2] = clamp((this.db[i] * 185) | 0, 0, 255);
            bytes[o + 3] = clamp((Math.abs(this.curl[i]) * 26) | 0, 0, 255);
        }

        // Advect Lagrangian tracers sampling the solved (u, v) field
        const minDim = Math.min(this.width, this.height);
        const aspect = this.width / minDim;
        const aspectY = this.height / minDim;
        const invCoreR = 1 / this.coreScreenRadiusFrac;
        const resetR2 = (this.coreScreenRadiusFrac * 0.85) ** 2;
        const count = Math.min(config.TRACER_COUNT, tracerCount);
        for (let i = 0; i < count; i++) {
            this.tAge[i] += sdt;
            let nx = this.tx[i];
            let ny = this.ty[i];
            const sx = (nx - 0.5) * aspect;
            const sy = (ny - 0.5) * aspectY;
            let dist2 = sx * sx + sy * sy;
            if (this.tAge[i] > this.tLife[i] || nx <= 0.01 || nx >= 0.99 || ny <= 0.01 || ny >= 0.99
                || dist2 < resetR2) {
                this._resetTracer(i);
                nx = this.tx[i];
                ny = this.ty[i];
                const nsx = (nx - 0.5) * aspect;
                const nsy = (ny - 0.5) * aspectY;
                dist2 = nsx * nsx + nsy * nsy;
            }
            const gx = nx * (gw - 2) + 1;
            const gy = ny * (gh - 2) + 1;
            const i0 = clamp(gx | 0, 0, gw - 2);
            const j0 = clamp(gy | 0, 0, gh - 2);
            const fx = gx - i0, fy = gy - j0;
            const r0 = j0 * gw + i0, r1 = r0 + gw;
            const vx = (1 - fy) * ((1 - fx) * this.u[r0] + fx * this.u[r0 + 1]) +
                       fy * ((1 - fx) * this.u[r1] + fx * this.u[r1 + 1]);
            const vy = (1 - fy) * ((1 - fx) * this.v[r0] + fx * this.v[r0 + 1]) +
                       fy * ((1 - fx) * this.v[r1] + fx * this.v[r1 + 1]);

            nx += (vx / gw) * sdt;
            ny += (vy / gh) * sdt;
            this.tx[i] = nx;
            this.ty[i] = ny;

            const speed = Math.min(1.5, Math.sqrt(vx * vx + vy * vy) * 0.06);
            const angleHue = (Math.atan2(vy, vx) / TAU + 1.0) % 1.0;
            const rCore = Math.sqrt(dist2) * invCoreR;
            const coreFade = clamp((rCore - 0.88) / 0.18, 0, 1);
            const alpha = Math.sin((this.tAge[i] / this.tLife[i]) * Math.PI)
                * (0.28 + 0.52 * Math.min(1, speed)) * coreFade;

            const vo = i * 5;
            this.tracerBuf[vo] = nx;
            this.tracerBuf[vo + 1] = ny;
            this.tracerBuf[vo + 2] = speed;
            this.tracerBuf[vo + 3] = (angleHue * 0.65 + this.tHue[i] * 0.35) % 1.0;
            this.tracerBuf[vo + 4] = alpha;
        }
    }

    stepTuring(dt, substeps = config.GS_SUBSTEPS, stepWave = true) {
        const tw = this.tw, th = this.th;
        const Du = config.GS_DU, Dv = config.GS_DV;

        const targetF = config.GS_F_BASE
            + this.wLinkedIn * (config.GS_F_LINKEDIN - config.GS_F_BASE)
            + this.wSpotify * (config.GS_F_SPOTIFY - config.GS_F_BASE);
        const targetK = config.GS_K_BASE
            + this.wLinkedIn * (config.GS_K_LINKEDIN - config.GS_K_BASE)
            + this.wSpotify * (config.GS_K_SPOTIFY - config.GS_K_BASE);
        const rate = Math.min(1, dt * 4.5);
        this.gsF += (targetF - this.gsF) * rate;
        this.gsK += (targetK - this.gsK) * rate;
        const F = this.gsF;
        const k = this.gsK;

        for (let s = 0; s < substeps; s++) {
            const gsU = this.gsU, gsV = this.gsV;
            const gsU2 = this.gsU2, gsV2 = this.gsV2;
            for (let y = 0; y < th; y++) {
                const ym = y > 0 ? y - 1 : 0;
                const yp = y < th - 1 ? y + 1 : th - 1;
                const rC = y * tw, rU = ym * tw, rD = yp * tw;
                for (let x = 0; x < tw; x++) {
                    const xm = x > 0 ? x - 1 : tw - 1;
                    const xp = x < tw - 1 ? x + 1 : 0;
                    const idx = rC + x;
                    const u = gsU[idx];
                    const v = gsV[idx];

                    const lapU = 0.2 * (gsU[rC + xm] + gsU[rC + xp] + gsU[rU + x] + gsU[rD + x])
                               + 0.05 * (gsU[rU + xm] + gsU[rU + xp] + gsU[rD + xm] + gsU[rD + xp]) - u;
                    const lapV = 0.2 * (gsV[rC + xm] + gsV[rC + xp] + gsV[rU + x] + gsV[rD + x])
                               + 0.05 * (gsV[rU + xm] + gsV[rU + xp] + gsV[rD + xm] + gsV[rD + xp]) - v;

                    const uvv = u * v * v;
                    gsU2[idx] = clamp(u + (Du * lapU - uvv + F * (1 - u)), 0, 1);
                    gsV2[idx] = clamp(v + (Dv * lapV + uvv - (F + k) * v), 0, 1);
                }
            }
            this.gsU = gsU2; this.gsU2 = gsU;
            this.gsV = gsV2; this.gsV2 = gsV;
        }

        if (stepWave) {
            const waveH = this.waveH, wavePrev = this.wavePrev, waveNext = this.waveNext;
            const c2 = config.WAVE_C2, damp = config.WAVE_DAMP, wClamp = config.WAVE_CLAMP;
            for (let y = 1; y < th - 1; y++) {
                const rC = y * tw, rU = (y - 1) * tw, rD = (y + 1) * tw;
                for (let x = 0; x < tw; x++) {
                    const xm = x > 0 ? x - 1 : tw - 1;
                    const xp = x < tw - 1 ? x + 1 : 0;
                    const idx = rC + x;
                    const hC = waveH[idx];
                    const lap = waveH[rC + xm] + waveH[rC + xp] + waveH[rU + x] + waveH[rD + x] - 4 * hC;
                    waveNext[idx] = clamp((2 * hC - wavePrev[idx] + c2 * lap) * damp, -wClamp, wClamp);
                }
            }
            this.wavePrev = waveH;
            this.waveH = waveNext;
            this.waveNext = wavePrev;
        }

        const gsU = this.gsU, gsV = this.gsV, waveH = this.waveH;
        const bytes = this.turingTexBytes;
        for (let y = 0; y < th; y++) {
            const ym = y > 0 ? y - 1 : 0;
            const yp = y < th - 1 ? y + 1 : th - 1;
            const rC = y * tw, rU = ym * tw, rD = yp * tw;
            for (let x = 0; x < tw; x++) {
                const xm = x > 0 ? x - 1 : tw - 1;
                const xp = x < tw - 1 ? x + 1 : 0;
                const idx = rC + x;
                const slope = Math.abs(gsV[rC + xp] - gsV[rC + xm]) + Math.abs(gsV[rD + x] - gsV[rU + x]);
                const o = idx * 4;
                bytes[o] = clamp((gsV[idx] * 560) | 0, 0, 255);
                bytes[o + 1] = clamp((gsU[idx] * 255) | 0, 0, 255);
                bytes[o + 2] = clamp(((waveH[idx] * 0.45 + 0.5) * 255) | 0, 0, 255);
                bytes[o + 3] = clamp((slope * 510) | 0, 0, 255);
            }
        }
    }

    update(dt, opts = {}) {
        const sdt = Math.min(dt, 0.05);
        this.time += sdt;
        this.igniteT += sdt;

        const mRate = Math.min(1, sdt * 4.5);
        this.wLinkedIn += ((this.targetMood === 1 ? 1 : 0) - this.wLinkedIn) * mRate;
        this.wSpotify += ((this.targetMood === 2 ? 1 : 0) - this.wSpotify) * mRate;
        this.pointer.vx *= Math.exp(-sdt * 8);
        this.pointer.vy *= Math.exp(-sdt * 8);

        this.stepFluid(sdt, opts.pressureIters ?? config.FLUID_PRESSURE_ITERS,
            opts.tracers ?? config.TRACER_COUNT, true);
        this.stepTuring(sdt, opts.gsSubsteps ?? config.GS_SUBSTEPS, true);
    }
}
