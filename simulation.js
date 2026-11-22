// simulation.js
// Pure, DOM-free coupled procedural simulation:
//   1. Adaptive incompressible Navier-Stokes (Stable Fluids) Eulerian grid
//      with SOR pressure projection, fused advection, and core obstacle coupling
//   2. 96x64 Gray-Scott reaction-diffusion PDE + 2D damped wave PDE
//   3. Trig-free & sqrt-free Lagrangian tracer advection

import { config } from './config.js';

const TAU = Math.PI * 2;
const LINKEDIN_RGB = [0.28, 0.78, 1.0];
const SPOTIFY_RGB = [0.18, 0.94, 0.68];

const PALETTE_RGB = config.PALETTE.map((hex) => {
    const v = parseInt(hex.slice(1), 16);
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
});

function clamp(x, lo, hi) {
    return x < lo ? lo : x > hi ? hi : x;
}

function packTuringPixel(bytes, idx, vVal, uVal, waveVal, slope) {
    const o = idx * 4;
    let b0 = (vVal * 560) | 0; if (b0 > 255) b0 = 255; else if (b0 < 0) b0 = 0;
    let b1 = (uVal * 255) | 0; if (b1 > 255) b1 = 255; else if (b1 < 0) b1 = 0;
    let b2 = ((waveVal * 0.45 + 0.5) * 255) | 0; if (b2 > 255) b2 = 255; else if (b2 < 0) b2 = 0;
    let b3 = (slope * 510) | 0; if (b3 > 255) b3 = 255; else if (b3 < 0) b3 = 0;
    bytes[o] = b0;
    bytes[o + 1] = b1;
    bytes[o + 2] = b2;
    bytes[o + 3] = b3;
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

        this.wLinkedIn = 0;
        this.wSpotify = 0;
        this.targetMood = 0;
        this.pointer = { x: 0.5, y: 0.5, vx: 0, vy: 0, strength: 0 };
        this.buttonSpot = { x: 0.5, y: 0.65 };

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
        let x = Math.random();
        let y = Math.random();
        const minDim = Math.min(this.width, this.height);
        const sx = (x - 0.5) * this.width / minDim;
        const sy = (y - 0.5) * this.height / minDim;
        const r = this.coreScreenRadiusFrac;
        if (sx * sx + sy * sy < r * r * 0.8464) {
            const ang = Math.random() * TAU;
            const rr = r * (1.02 + Math.random() * 0.28);
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

        for (let k = 0; k < 7; k++) {
            const su = (k / 7 + 0.07) % 1.0;
            const sv = 0.5 + 0.16 * Math.sin(k * 2.1);
            this.disturbTuring(su, sv, 0.9, 0.52, 4.0);
        }
        this.disturbTuring(0.25, 0.28, 0.55, 0.45, 3.5);
        this.disturbTuring(0.75, 0.72, 0.55, 0.45, 3.5);
        this.stepTuring(0.016, turingWarmup, true);

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
        if (moodOverride === 1) return LINKEDIN_RGB;
        if (moodOverride === 2) return SPOTIFY_RGB;
        const idx = (Math.floor(this.time * 2.2) + offset) % PALETTE_RGB.length;
        return PALETTE_RGB[idx < 0 ? idx + PALETTE_RGB.length : idx];
    }

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

        const a = -this.time * config.CORE_SPIN_RAD_S;
        const cosA = Math.cos(a), sinA = Math.sin(a);
        const rx = sx * cosA - sz * sinA;
        const rz = sx * sinA + sz * cosA;
        const u = ((Math.atan2(rz, rx) / TAU + 0.5) % 1 + 1) % 1;
        const v = Math.acos(clamp(sy, -1, 1)) / Math.PI;
        return { u, v };
    }

    disturbTuring(su, sv, waveAmp = 0.65, chemAmp = 0.35, radius = 3.2) {
        const tw = this.tw, th = this.th;
        const gx = ((su % 1) + 1) % 1 * tw;
        const gy = clamp(sv * th, 2, th - 3);
        const rCeil = Math.ceil(radius);
        const r2Max = radius * radius;
        const invScale = 1 / (radius * 0.9);
        for (let dy = -rCeil; dy <= rCeil; dy++) {
            const y = Math.round(gy + dy);
            if (y < 1 || y >= th - 1) continue;
            const row = y * tw;
            for (let dx = -rCeil; dx <= rCeil; dx++) {
                const d2 = dx * dx + dy * dy;
                if (d2 > r2Max) continue;
                const x = ((Math.round(gx + dx) % tw) + tw) % tw;
                const w = Math.exp(-d2 * invScale);
                const idx = row + x;
                const wh = this.waveH[idx] + waveAmp * w;
                this.waveH[idx] = wh > config.WAVE_CLAMP ? config.WAVE_CLAMP
                    : wh < -config.WAVE_CLAMP ? -config.WAVE_CLAMP : wh;
                if (chemAmp > 0) {
                    const nv = this.gsV[idx] + chemAmp * w;
                    const nu = this.gsU[idx] - chemAmp * 0.6 * w;
                    this.gsV[idx] = nv > 1 ? 1 : nv;
                    this.gsU[idx] = nu < 0 ? 0 : nu;
                }
            }
        }
    }

    splatFluid(gx, gy, rad, fx, fy, r, g, b) {
        const gw = this.gw, gh = this.gh;
        const u = this.u, v = this.v, dr = this.dr, dg = this.dg, db = this.db;
        const x0 = Math.max(1, Math.floor(gx - rad));
        const x1 = Math.min(gw - 2, Math.ceil(gx + rad));
        const y0 = Math.max(1, Math.floor(gy - rad));
        const y1 = Math.min(gh - 2, Math.ceil(gy + rad));
        const invR2 = 2.2 / Math.max(0.5, rad * rad);
        for (let j = y0; j <= y1; j++) {
            const dy = j - gy;
            const dy2 = dy * dy;
            const row = j * gw;
            for (let i = x0; i <= x1; i++) {
                const dx = i - gx;
                const w = Math.exp(-(dx * dx + dy2) * invR2);
                const idx = row + i;
                u[idx] += fx * w;
                v[idx] += fy * w;
                const rr = dr[idx] + r * w; dr[idx] = rr > 2.2 ? 2.2 : rr;
                const gg = dg[idx] + g * w; dg[idx] = gg > 2.2 ? 2.2 : gg;
                const bb = db[idx] + b * w; db[idx] = bb > 2.2 ? 2.2 : bb;
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
        if (uv) this.disturbTuring(uv.u, uv.v, 0.14, 0.03, 2.2);
    }

    interactAt(nx, ny, moodOverride = 0) {
        const coreUv = this.screenToCoreUv(nx, ny);
        if (coreUv) {
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
        const topRow = (gh - 1) * gw;
        const prevRow = (gh - 2) * gw;
        if (b === 2) {
            for (let i = 1; i < gw - 1; i++) {
                x[i] = -x[gw + i];
                x[topRow + i] = -x[prevRow + i];
            }
        } else {
            for (let i = 1; i < gw - 1; i++) {
                x[i] = x[gw + i];
                x[topRow + i] = x[prevRow + i];
            }
        }
        if (b === 1) {
            for (let j = 1; j < gh - 1; j++) {
                const row = j * gw;
                x[row] = -x[row + 1];
                x[row + gw - 1] = -x[row + gw - 2];
            }
        } else {
            for (let j = 1; j < gh - 1; j++) {
                const row = j * gw;
                x[row] = x[row + 1];
                x[row + gw - 1] = x[row + gw - 2];
            }
        }
        x[0] = 0.5 * (x[1] + x[gw]);
        x[gw - 1] = 0.5 * (x[gw - 2] + x[2 * gw - 1]);
        x[topRow] = 0.5 * (x[prevRow] + x[topRow + 1]);
        x[gh * gw - 1] = 0.5 * (x[gh * gw - 2] + x[topRow - 1]);
    }

    // Fused velocity advection: computes backtrace & bilinear weights once for (u, v)
    _advectVel2(dt, damp) {
        const gw = this.gw, gh = this.gh;
        const u = this.u, v = this.v, u0 = this.u0, v0 = this.v0;
        const maxX = gw - 1.5;
        const maxY = gh - 1.5;
        for (let j = 1; j < gh - 1; j++) {
            const row = j * gw;
            for (let i = 1; i < gw - 1; i++) {
                const idx = row + i;
                let x = i - dt * u0[idx];
                let y = j - dt * v0[idx];
                if (x < 0.5) x = 0.5; else if (x > maxX) x = maxX;
                if (y < 0.5) y = 0.5; else if (y > maxY) y = maxY;
                const i0 = x | 0, i1 = i0 + 1;
                const j0 = y | 0, j1 = j0 + 1;
                const s1 = x - i0, s0 = 1 - s1;
                const t1 = y - j0, t0 = 1 - t1;
                const r0 = j0 * gw + i0, r1 = j1 * gw + i0;
                const w00 = s0 * t0, w10 = s0 * t1, w01 = s1 * t0, w11 = s1 * t1;
                u[idx] = damp * (w00 * u0[r0] + w10 * u0[r1] + w01 * u0[r0 + 1] + w11 * u0[r1 + 1]);
                v[idx] = damp * (w00 * v0[r0] + w10 * v0[r1] + w01 * v0[r0 + 1] + w11 * v0[r1 + 1]);
            }
        }
        this._setBnd(1, u);
        this._setBnd(2, v);
    }

    // Fused 3-channel dye advection + RGBA8 texture byte packing in one pass
    _advectDyeAndPack(dt, damp) {
        const gw = this.gw, gh = this.gh;
        const u = this.u, v = this.v, curl = this.curl;
        const dr = this.dr, dg = this.dg, db = this.db;
        const dr0 = this.dr0, dg0 = this.dg0, db0 = this.db0;
        const bytes = this.fluidTexBytes;
        const maxX = gw - 1.5;
        const maxY = gh - 1.5;

        for (let j = 1; j < gh - 1; j++) {
            const row = j * gw;
            for (let i = 1; i < gw - 1; i++) {
                const idx = row + i;
                let x = i - dt * u[idx];
                let y = j - dt * v[idx];
                if (x < 0.5) x = 0.5; else if (x > maxX) x = maxX;
                if (y < 0.5) y = 0.5; else if (y > maxY) y = maxY;
                const i0 = x | 0;
                const j0 = y | 0;
                const s1 = x - i0, s0 = 1 - s1;
                const t1 = y - j0, t0 = 1 - t1;
                const r0 = j0 * gw + i0, r1 = r0 + gw;
                const w00 = s0 * t0, w10 = s0 * t1, w01 = s1 * t0, w11 = s1 * t1;

                const nr = damp * (w00 * dr0[r0] + w10 * dr0[r1] + w01 * dr0[r0 + 1] + w11 * dr0[r1 + 1]);
                const ng = damp * (w00 * dg0[r0] + w10 * dg0[r1] + w01 * dg0[r0 + 1] + w11 * dg0[r1 + 1]);
                const nb = damp * (w00 * db0[r0] + w10 * db0[r1] + w01 * db0[r0 + 1] + w11 * db0[r1 + 1]);
                dr[idx] = nr;
                dg[idx] = ng;
                db[idx] = nb;

                const o = idx * 4;
                let br = (nr * 185) | 0; if (br > 255) br = 255; else if (br < 0) br = 0;
                let bg = (ng * 185) | 0; if (bg > 255) bg = 255; else if (bg < 0) bg = 0;
                let bb = (nb * 185) | 0; if (bb > 255) bb = 255; else if (bb < 0) bb = 0;
                const c = curl[idx];
                let bc = ((c < 0 ? -c : c) * 26) | 0; if (bc > 255) bc = 255;
                bytes[o] = br;
                bytes[o + 1] = bg;
                bytes[o + 2] = bb;
                bytes[o + 3] = bc;
            }
        }
        this._setBnd(0, dr);
        this._setBnd(0, dg);
        this._setBnd(0, db);
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
                const cr = curl[idx + 1], cl = curl[idx - 1];
                const cu = curl[idx + gw], cd = curl[idx - gw];
                const dwDx = ((cr < 0 ? -cr : cr) - (cl < 0 ? -cl : cl)) * 0.5;
                const dwDy = ((cu < 0 ? -cu : cu) - (cd < 0 ? -cd : cd)) * 0.5;
                const len = Math.sqrt(dwDx * dwDx + dwDy * dwDy) + 1e-5;
                const c = curl[idx];
                u[idx] += eps * (dwDy / len) * c * dt;
                v[idx] -= eps * (dwDx / len) * c * dt;
            }
        }
    }

    _applyCoreBoundary(dt, coupleWaves) {
        const gw = this.gw, gh = this.gh;
        const u = this.u, v = this.v, dr = this.dr, dg = this.dg, db = this.db;
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
                    u[idx] *= 0.65;
                    v[idx] *= 0.65;
                    dr[idx] *= 0.78;
                    dg[idx] *= 0.78;
                    db[idx] *= 0.78;
                } else {
                    const len = Math.sqrt(d2) + 1e-5;
                    const nx = sx / len, ny = sy / len;
                    const vn = u[idx] * nx + v[idx] * ny;
                    if (vn < 0) {
                        u[idx] -= vn * nx * 0.9;
                        v[idx] -= vn * ny * 0.9;
                    }
                    if (coupleWaves && ((i + j) & 1) === 0) {
                        const speed2 = u[idx] * u[idx] + v[idx] * v[idx];
                        if (speed2 > 72.25) {
                            const speed = Math.sqrt(speed2);
                            const az = Math.atan2(0.2, sx * invR) - spinOffset;
                            const su = ((az / TAU + 0.5) % 1 + 1) % 1;
                            const sv = Math.acos(clamp(sy * invR, -0.96, 0.96)) / Math.PI;
                            const gx = ((su * this.tw) | 0) % this.tw;
                            const gy = clamp((sv * this.th) | 0, 1, this.th - 2);
                            const wIdx = gy * this.tw + gx;
                            const ripple = Math.min(0.04, (speed - 8.5) * 0.0022 * dt * 60);
                            const wh = this.waveH[wIdx] + ripple;
                            this.waveH[wIdx] = wh > config.WAVE_CLAMP ? config.WAVE_CLAMP : wh;
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

        const omega = config.FLUID_SOR_OMEGA;
        const oneMinusW = 1 - omega;
        const wQuarter = omega * 0.25;
        const gwM1 = gw - 1, ghM1 = gh - 1;
        for (let k = 0; k < iters; k++) {
            // Red pass: (i + j) even — zero loop-carried neighbor dependency
            for (let j = 1; j < ghM1; j++) {
                const row = j * gw;
                for (let i = 2 - (j & 1); i < gwM1; i += 2) {
                    const idx = row + i;
                    p[idx] = oneMinusW * p[idx]
                        + wQuarter * (div[idx] + p[idx - 1] + p[idx + 1] + p[idx - gw] + p[idx + gw]);
                }
            }
            // Black pass: (i + j) odd
            for (let j = 1; j < ghM1; j++) {
                const row = j * gw;
                for (let i = 1 + (j & 1); i < gwM1; i += 2) {
                    const idx = row + i;
                    p[idx] = oneMinusW * p[idx]
                        + wQuarter * (div[idx] + p[idx - 1] + p[idx + 1] + p[idx - gw] + p[idx + gw]);
                }
            }
            if ((k & 1) === 1 || k === iters - 1) this._setBnd(0, p);
        }

        const maxV = config.FLUID_MAX_VEL;
        const minV = -maxV;
        for (let j = 1; j < gh - 1; j++) {
            const row = j * gw;
            for (let i = 1; i < gw - 1; i++) {
                const idx = row + i;
                let nu = u[idx] - 0.5 * (p[idx + 1] - p[idx - 1]);
                let nv = v[idx] - 0.5 * (p[idx + gw] - p[idx - gw]);
                if (nu > maxV) nu = maxV; else if (nu < minV) nu = minV;
                if (nv > maxV) nv = maxV; else if (nv < minV) nv = minV;
                u[idx] = nu;
                v[idx] = nv;
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

        if (this.pointer.strength > 0.05 && (Math.abs(this.pointer.vx) > 0.002 || Math.abs(this.pointer.vy) > 0.002)) {
            const gx = this.pointer.x * (gw - 2) + 1;
            const gy = (1 - this.pointer.y) * (gh - 2) + 1;
            const col = this._moodColor(this.targetMood, 0);
            const fx = clamp(this.pointer.vx * config.FLUID_POINTER_FORCE, -36, 36);
            const fy = clamp(-this.pointer.vy * config.FLUID_POINTER_FORCE, -36, 36);
            this.splatFluid(gx, gy, 3.5, fx, fy, col[0] * 0.45, col[1] * 0.45, col[2] * 0.45);
        }

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
        this._advectVel2(sdt, config.FLUID_VEL_DAMP);
        this._applyCoreBoundary(sdt, coupleWaves);
        this._project(pressureIters);

        tmp = this.dr; this.dr = this.dr0; this.dr0 = tmp;
        tmp = this.dg; this.dg = this.dg0; this.dg0 = tmp;
        tmp = this.db; this.db = this.db0; this.db0 = tmp;
        this._advectDyeAndPack(sdt, config.FLUID_DYE_DAMP);

        // Trig-free & sqrt-free Lagrangian tracer advection
        const tx = this.tx, ty = this.ty, tAge = this.tAge, tLife = this.tLife, tHue = this.tHue;
        const u = this.u, v = this.v, tracerBuf = this.tracerBuf;
        const minDim = Math.min(this.width, this.height);
        const aspect = this.width / minDim;
        const aspectY = this.height / minDim;
        const coreR = this.coreScreenRadiusFrac;
        const resetR2 = (coreR * 0.85) ** 2;
        const fadeIn2 = (coreR * 0.88) ** 2;
        const fadeOut2 = (coreR * 1.06) ** 2;
        const invFadeSpan2 = 1 / Math.max(1e-6, fadeOut2 - fadeIn2);
        const gwM2 = gw - 2, ghM2 = gh - 2;
        const invGwDt = sdt / gw, invGhDt = sdt / gh;
        const count = Math.min(config.TRACER_COUNT, tracerCount);

        for (let i = 0; i < count; i++) {
            const age = tAge[i] + sdt;
            tAge[i] = age;
            let nx = tx[i];
            let ny = ty[i];
            const sx = (nx - 0.5) * aspect;
            const sy = (ny - 0.5) * aspectY;
            let dist2 = sx * sx + sy * sy;
            if (age > tLife[i] || nx <= 0.01 || nx >= 0.99 || ny <= 0.01 || ny >= 0.99 || dist2 < resetR2) {
                this._resetTracer(i);
                nx = tx[i];
                ny = ty[i];
                const nsx = (nx - 0.5) * aspect;
                const nsy = (ny - 0.5) * aspectY;
                dist2 = nsx * nsx + nsy * nsy;
            }
            const gx = nx * gwM2 + 1;
            const gy = ny * ghM2 + 1;
            let i0 = gx | 0; if (i0 < 0) i0 = 0; else if (i0 > gwM2) i0 = gwM2;
            let j0 = gy | 0; if (j0 < 0) j0 = 0; else if (j0 > ghM2) j0 = ghM2;
            const fx = gx - i0, fy = gy - j0;
            const omfx = 1 - fx, omfy = 1 - fy;
            const r0 = j0 * gw + i0, r1 = r0 + gw;
            const w00 = omfx * omfy, w10 = fx * omfy, w01 = omfx * fy, w11 = fx * fy;
            const vx = w00 * u[r0] + w10 * u[r0 + 1] + w01 * u[r1] + w11 * u[r1 + 1];
            const vy = w00 * v[r0] + w10 * v[r0 + 1] + w01 * v[r1] + w11 * v[r1 + 1];

            nx += vx * invGwDt;
            ny += vy * invGhDt;
            tx[i] = nx;
            ty[i] = ny;

            const ax = vx < 0 ? -vx : vx;
            const ay = vy < 0 ? -vy : vy;
            const l1 = (ax + ay) * 0.05;
            const speed = l1 > 1.5 ? 1.5 : l1;
            const sum = ax + ay + 1e-6;
            const qAng = (ay / sum) * 0.25;
            const angleHue = vx >= 0
                ? (vy >= 0 ? qAng : 1.0 - qAng)
                : (vy >= 0 ? 0.5 - qAng : 0.5 + qAng);

            const frac = tAge[i] / tLife[i];
            const bell = 4 * frac * (1 - frac);
            let coreFade = (dist2 - fadeIn2) * invFadeSpan2;
            if (coreFade < 0) coreFade = 0; else if (coreFade > 1) coreFade = 1;
            const spClamp = speed > 1 ? 1 : speed;
            const alpha = bell * (0.28 + 0.52 * spClamp) * coreFade;

            const vo = i * 5;
            tracerBuf[vo] = nx;
            tracerBuf[vo + 1] = ny;
            tracerBuf[vo + 2] = speed;
            const rawHue = angleHue * 0.65 + tHue[i] * 0.35;
            tracerBuf[vo + 3] = rawHue >= 1 ? rawHue - 1 : rawHue;
            tracerBuf[vo + 4] = alpha;
        }
    }

    stepTuring(dt, substeps = config.GS_SUBSTEPS, stepWave = true) {
        const tw = this.tw, th = this.th;
        const twM1 = tw - 1, thM1 = th - 1;
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
        const FpK = F + this.gsK;

        for (let s = 0; s < substeps; s++) {
            const gsU = this.gsU, gsV = this.gsV;
            const gsU2 = this.gsU2, gsV2 = this.gsV2;
            for (let y = 0; y < th; y++) {
                const rC = y * tw;
                const rU = (y > 0 ? y - 1 : 0) * tw;
                const rD = (y < thM1 ? y + 1 : thM1) * tw;

                // x = 0 (wrapped left neighbor = twM1)
                {
                    const u = gsU[rC], v = gsV[rC];
                    const lapU = 0.2 * (gsU[rC + twM1] + gsU[rC + 1] + gsU[rU] + gsU[rD])
                               + 0.05 * (gsU[rU + twM1] + gsU[rU + 1] + gsU[rD + twM1] + gsU[rD + 1]) - u;
                    const lapV = 0.2 * (gsV[rC + twM1] + gsV[rC + 1] + gsV[rU] + gsV[rD])
                               + 0.05 * (gsV[rU + twM1] + gsV[rU + 1] + gsV[rD + twM1] + gsV[rD + 1]) - v;
                    const uvv = u * v * v;
                    let nu = u + (Du * lapU - uvv + F * (1 - u));
                    let nv = v + (Dv * lapV + uvv - FpK * v);
                    gsU2[rC] = nu < 0 ? 0 : nu > 1 ? 1 : nu;
                    gsV2[rC] = nv < 0 ? 0 : nv > 1 ? 1 : nv;
                }

                // Interior 1 <= x < twM1 (zero branch wrapping)
                for (let x = 1; x < twM1; x++) {
                    const idx = rC + x;
                    const u = gsU[idx], v = gsV[idx];
                    const uIdx = rU + x, dIdx = rD + x;
                    const lapU = 0.2 * (gsU[idx - 1] + gsU[idx + 1] + gsU[uIdx] + gsU[dIdx])
                               + 0.05 * (gsU[uIdx - 1] + gsU[uIdx + 1] + gsU[dIdx - 1] + gsU[dIdx + 1]) - u;
                    const lapV = 0.2 * (gsV[idx - 1] + gsV[idx + 1] + gsV[uIdx] + gsV[dIdx])
                               + 0.05 * (gsV[uIdx - 1] + gsV[uIdx + 1] + gsV[dIdx - 1] + gsV[dIdx + 1]) - v;
                    const uvv = u * v * v;
                    let nu = u + (Du * lapU - uvv + F * (1 - u));
                    let nv = v + (Dv * lapV + uvv - FpK * v);
                    gsU2[idx] = nu < 0 ? 0 : nu > 1 ? 1 : nu;
                    gsV2[idx] = nv < 0 ? 0 : nv > 1 ? 1 : nv;
                }

                // x = twM1 (wrapped right neighbor = 0)
                {
                    const idx = rC + twM1;
                    const xm = twM1 - 1;
                    const u = gsU[idx], v = gsV[idx];
                    const lapU = 0.2 * (gsU[rC + xm] + gsU[rC] + gsU[rU + twM1] + gsU[rD + twM1])
                               + 0.05 * (gsU[rU + xm] + gsU[rU] + gsU[rD + xm] + gsU[rD]) - u;
                    const lapV = 0.2 * (gsV[rC + xm] + gsV[rC] + gsV[rU + twM1] + gsV[rD + twM1])
                               + 0.05 * (gsV[rU + xm] + gsV[rU] + gsV[rD + xm] + gsV[rD]) - v;
                    const uvv = u * v * v;
                    let nu = u + (Du * lapU - uvv + F * (1 - u));
                    let nv = v + (Dv * lapV + uvv - FpK * v);
                    gsU2[idx] = nu < 0 ? 0 : nu > 1 ? 1 : nu;
                    gsV2[idx] = nv < 0 ? 0 : nv > 1 ? 1 : nv;
                }
            }
            this.gsU = gsU2; this.gsU2 = gsU;
            this.gsV = gsV2; this.gsV2 = gsV;
        }

        const gsU = this.gsU, gsV = this.gsV;
        const bytes = this.turingTexBytes;

        if (stepWave) {
            const waveH = this.waveH, wavePrev = this.wavePrev, waveNext = this.waveNext;
            const c2 = config.WAVE_C2, damp = config.WAVE_DAMP, wClamp = config.WAVE_CLAMP, negClamp = -wClamp;
            // Fused wave PDE update + RGBA8 texture packing for interior rows 1..th-2
            for (let y = 1; y < thM1; y++) {
                const rC = y * tw, rU = (y - 1) * tw, rD = (y + 1) * tw;
                {
                    const hC = waveH[rC];
                    const lap = waveH[rC + twM1] + waveH[rC + 1] + waveH[rU] + waveH[rD] - 4 * hC;
                    let hn = (2 * hC - wavePrev[rC] + c2 * lap) * damp;
                    if (hn > wClamp) hn = wClamp; else if (hn < negClamp) hn = negClamp;
                    waveNext[rC] = hn;

                    const dx = gsV[rC + 1] - gsV[rC + twM1];
                    const dy = gsV[rD] - gsV[rU];
                    packTuringPixel(bytes, rC, gsV[rC], gsU[rC], hn,
                        (dx < 0 ? -dx : dx) + (dy < 0 ? -dy : dy));
                }
                for (let x = 1; x < twM1; x++) {
                    const idx = rC + x;
                    const hC = waveH[idx];
                    const lap = waveH[idx - 1] + waveH[idx + 1] + waveH[rU + x] + waveH[rD + x] - 4 * hC;
                    let hn = (2 * hC - wavePrev[idx] + c2 * lap) * damp;
                    if (hn > wClamp) hn = wClamp; else if (hn < negClamp) hn = negClamp;
                    waveNext[idx] = hn;

                    const dx = gsV[idx + 1] - gsV[idx - 1];
                    const dy = gsV[rD + x] - gsV[rU + x];
                    packTuringPixel(bytes, idx, gsV[idx], gsU[idx], hn,
                        (dx < 0 ? -dx : dx) + (dy < 0 ? -dy : dy));
                }
                {
                    const idx = rC + twM1;
                    const hC = waveH[idx];
                    const lap = waveH[idx - 1] + waveH[rC] + waveH[rU + twM1] + waveH[rD + twM1] - 4 * hC;
                    let hn = (2 * hC - wavePrev[idx] + c2 * lap) * damp;
                    if (hn > wClamp) hn = wClamp; else if (hn < negClamp) hn = negClamp;
                    waveNext[idx] = hn;

                    const dx = gsV[rC] - gsV[idx - 1];
                    const dy = gsV[rD + twM1] - gsV[rU + twM1];
                    packTuringPixel(bytes, idx, gsV[idx], gsU[idx], hn,
                        (dx < 0 ? -dx : dx) + (dy < 0 ? -dy : dy));
                }
            }
            this.wavePrev = waveH;
            this.waveH = waveNext;
            this.waveNext = wavePrev;

            const wNew = this.waveH;
            for (const y of [0, thM1]) {
                const rC = y * tw;
                const rU = (y > 0 ? y - 1 : 0) * tw;
                const rD = (y < thM1 ? y + 1 : thM1) * tw;
                for (let x = 0; x < tw; x++) {
                    const xm = x > 0 ? x - 1 : twM1;
                    const xp = x < twM1 ? x + 1 : 0;
                    const idx = rC + x;
                    const dx = gsV[rC + xp] - gsV[rC + xm];
                    const dy = gsV[rD + x] - gsV[rU + x];
                    packTuringPixel(bytes, idx, gsV[idx], gsU[idx], wNew[idx],
                        (dx < 0 ? -dx : dx) + (dy < 0 ? -dy : dy));
                }
            }
        } else {
            const waveH = this.waveH;
            for (let y = 0; y < th; y++) {
                const rC = y * tw;
                const rU = (y > 0 ? y - 1 : 0) * tw;
                const rD = (y < thM1 ? y + 1 : thM1) * tw;
                for (let x = 0; x < tw; x++) {
                    const xm = x > 0 ? x - 1 : twM1;
                    const xp = x < twM1 ? x + 1 : 0;
                    const idx = rC + x;
                    const dx = gsV[rC + xp] - gsV[rC + xm];
                    const dy = gsV[rD + x] - gsV[rU + x];
                    packTuringPixel(bytes, idx, gsV[idx], gsU[idx], waveH[idx],
                        (dx < 0 ? -dx : dx) + (dy < 0 ? -dy : dy));
                }
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
        const pDecay = Math.exp(-sdt * 8);
        this.pointer.vx *= pDecay;
        this.pointer.vy *= pDecay;

        this.stepFluid(sdt, opts.pressureIters ?? config.FLUID_PRESSURE_ITERS,
            opts.tracers ?? config.TRACER_COUNT, true);
        this.stepTuring(sdt, opts.gsSubsteps ?? config.GS_SUBSTEPS, true);
    }
}
