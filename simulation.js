// simulation.js
// Pure DOM-free relativistic Black Hole + Paczynski-Wiita particle infall
// simulation. Computes smoothly morphing disk basis vectors (stationary
// sky-locked camera so stars never jump) and compacted 3-state particle
// absorption buffers with time dilation and redshift oblivion fading.

import { config } from './config.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export class BlackHoleSimulation {
    constructor(width, height) {
        this.width = 1;
        this.height = 1;
        this.time = 0;
        this.igniteT = 0;
        this.skyAngle = 0;
        this.dolly = 0; // 1 = pulled back for the intro fly-in, eases to 0
        this.absorbGlow = 0;
        this.targetMood = 0;
        this.capturedCount = 0;
        this.activeCount = 0;
        this.drawCount = 0;
        this._emitAccum = 0;
        this._worldOut = new Float32Array(3);

        this.pointer = { x: 0.5, y: 0.5, vx: 0, vy: 0, down: false, strength: 0 };

        // Smooth black hole orientation & weight state initialized at M87*
        const v0 = config.VARIANTS[0];
        this.curTilt = v0.tilt;
        this.curRoll = v0.roll;
        this.curSpin = v0.spin;
        this.curGm = v0.gm;
        this.curDrag = v0.drag;
        this.wM87 = 1;
        this.wGarg = 0;
        this.wCyg = 0;
        this.bhT1 = new Float32Array([1, 0, 0]);
        this.bhN = new Float32Array([0, 1, 0]);
        this.bhT2 = new Float32Array([0, 0, -1]);

        // Fixed sky-space camera basis (parallax only, invariant to targetMood)
        this.cam = {
            ro: new Float32Array([0, 0, config.CAM_DIST]),
            uu: new Float32Array([1, 0, 0]),
            vv: new Float32Array([0, 1, 0]),
            ww: new Float32Array([0, 0, -1]),
            fov: config.CAM_FOV,
            baseDist: config.CAM_DIST,
            dist: config.CAM_DIST,
        };

        const maxP = config.MAX_PARTICLES;
        this.pState = new Uint8Array(maxP); // 0=free, 1=orbit/infall, 2=oblivion fade
        this.pFade = new Float32Array(maxP);
        this.px = new Float32Array(maxP);
        this.py = new Float32Array(maxP);
        this.pz = new Float32Array(maxP);
        this.pvx = new Float32Array(maxP);
        this.pvy = new Float32Array(maxP);
        this.pvz = new Float32Array(maxP);
        this.pSize = new Float32Array(maxP);
        this.pAge = new Float32Array(maxP);
        this.pLineBuf = new Float32Array(maxP * 12);
        this.pHeadBuf = new Float32Array(maxP * 7);
        this.cursorIdx = 0;
        this.capacity = maxP; // spawn slots in use; lowered by lite quality

        this.resize(width, height);
        this.updateBhBasis(0);
        this.updateCamera(0, 0);

        // Warm up initial orbital spirals for immediate visual depth & reduced-motion
        this.emitShowcaseBurst(48);
        for (let i = 0; i < 12; i++) {
            this.stepParticles(0.016, maxP);
        }
    }

    resize(width, height) {
        this.width = Math.max(1, width);
        this.height = Math.max(1, height);
        const aspect = this.width / this.height;
        this.cam.baseDist = aspect < config.NARROW_ASPECT ? config.NARROW_CAM_DIST : config.CAM_DIST;
        this.cam.fov = config.CAM_FOV;
    }

    updateBhBasis(dt) {
        const targetIdx = (this.targetMood === 1 || this.targetMood === 2) ? this.targetMood : 0;
        const tv = config.VARIANTS[targetIdx];
        const k = dt > 0 ? (1 - Math.exp(-dt * config.BH_MORPH_RATE)) : 1;

        const tilt = tv.tilt + config.TILT_BREATH * Math.sin(this.time * 0.13);
        this.curTilt += (tilt - this.curTilt) * k;
        this.curRoll += (tv.roll - this.curRoll) * k;
        this.curSpin += (tv.spin - this.curSpin) * k;
        this.curGm += (tv.gm - this.curGm) * k;
        this.curDrag += (tv.drag - this.curDrag) * k;

        this.wM87 += ((targetIdx === 0 ? 1 : 0) - this.wM87) * k;
        this.wGarg += ((targetIdx === 1 ? 1 : 0) - this.wGarg) * k;
        this.wCyg += ((targetIdx === 2 ? 1 : 0) - this.wCyg) * k;
        const wSum = this.wM87 + this.wGarg + this.wCyg || 1;
        this.wM87 /= wSum;
        this.wGarg /= wSum;
        this.wCyg /= wSum;

        const cr = Math.cos(this.curRoll), sr = Math.sin(this.curRoll);
        const ct = Math.cos(this.curTilt), st = Math.sin(this.curTilt);
        const t1 = this.bhT1, n = this.bhN, t2 = this.bhT2;
        t1[0] = cr;        t1[1] = sr;        t1[2] = 0;
        n[0]  = -sr * ct;  n[1]  = cr * ct;   n[2]  = st;
        t2[0] = -sr * st;  t2[1] = cr * st;   t2[2] = -ct;
    }

    updateCamera(parallaxX = 0, parallaxY = 0) {
        const cam = this.cam;
        cam.dist = cam.baseDist * (1 + config.INTRO_PULLBACK * this.dolly);
        const yaw = -parallaxX * config.PARALLAX_YAW;
        const pitch = -parallaxY * config.PARALLAX_PITCH;
        const cosP = Math.cos(pitch), sinP = Math.sin(pitch);
        const cosY = Math.cos(yaw), sinY = Math.sin(yaw);

        const rox = cam.dist * cosP * sinY;
        const roy = cam.dist * sinP;
        const roz = cam.dist * cosP * cosY;
        cam.ro[0] = rox; cam.ro[1] = roy; cam.ro[2] = roz;

        const invR = 1 / (Math.sqrt(rox * rox + roy * roy + roz * roz) || 1);
        const wx = -rox * invR, wy = -roy * invR, wz = -roz * invR;
        cam.ww[0] = wx; cam.ww[1] = wy; cam.ww[2] = wz;

        let rx = -wz, rz = wx;
        const invRx = 1 / (Math.sqrt(rx * rx + rz * rz) || 1);
        rx *= invRx; rz *= invRx;

        cam.uu[0] = rx; cam.uu[1] = 0; cam.uu[2] = rz;
        cam.vv[0] = -rz * wy;
        cam.vv[1] = rz * wx - rx * wz;
        cam.vv[2] = rx * wy;
    }

    cursorToWorld(nx, ny, out = this._worldOut) {
        const minDim = Math.max(1, Math.min(this.width, this.height));
        const uvx = (nx * this.width - 0.5 * this.width) / minDim;
        const uvy = ((1 - ny) * this.height - 0.5 * this.height) / minDim;
        const cam = this.cam, bhN = this.bhN;

        const rdx = uvx * cam.uu[0] + uvy * cam.vv[0] + cam.fov * cam.ww[0];
        const rdy = uvx * cam.uu[1] + uvy * cam.vv[1] + cam.fov * cam.ww[1];
        const rdz = uvx * cam.uu[2] + uvy * cam.vv[2] + cam.fov * cam.ww[2];
        const inv = 1 / (Math.sqrt(rdx * rdx + rdy * rdy + rdz * rdz) || 1);
        const dx = rdx * inv, dy = rdy * inv, dz = rdz * inv;

        const denomDisk = dx * bhN[0] + dy * bhN[1] + dz * bhN[2];
        if (Math.abs(denomDisk) > 0.12) {
            const roDotN = cam.ro[0] * bhN[0] + cam.ro[1] * bhN[1] + cam.ro[2] * bhN[2];
            const tPlane = -roDotN / denomDisk;
            if (tPlane > 1.0 && tPlane < cam.dist * 2.2) {
                const hx = cam.ro[0] + dx * tPlane;
                const hy = cam.ro[1] + dy * tPlane;
                const hz = cam.ro[2] + dz * tPlane;
                const hr2 = hx * hx + hy * hy + hz * hz;
                if (hr2 > 2.25 && hr2 < 110.25) {
                    const j = (Math.random() - 0.5) * 0.16;
                    out[0] = hx + bhN[0] * j;
                    out[1] = hy + bhN[1] * j;
                    out[2] = hz + bhN[2] * j;
                    return out;
                }
            }
        }

        const denomCam = dx * cam.ww[0] + dy * cam.ww[1] + dz * cam.ww[2];
        const tOrig = -((cam.ro[0] * cam.ww[0] + cam.ro[1] * cam.ww[1] + cam.ro[2] * cam.ww[2])) / (denomCam || 1);
        out[0] = cam.ro[0] + dx * tOrig;
        out[1] = cam.ro[1] + dy * tOrig;
        out[2] = cam.ro[2] + dz * tOrig;
        return out;
    }

    spawnParticle(x, y, z, biasVx, biasVy, biasVz, orbitalBoost = 0.64) {
        const idx = this.cursorIdx < this.capacity ? this.cursorIdx : 0;
        this.cursorIdx = (idx + 1) % this.capacity;

        const r = Math.max(1.65, Math.sqrt(x * x + y * y + z * z));
        const dr = Math.max(0.32, r - 1.0);
        const vCirc = Math.sqrt((r * this.curGm) / (dr * dr)) * orbitalBoost;

        const bhN = this.bhN, bhT1 = this.bhT1;
        const hPlane = x * bhN[0] + y * bhN[1] + z * bhN[2];
        const rxp = x - hPlane * bhN[0];
        const ryp = y - hPlane * bhN[1];
        const rzp = z - hPlane * bhN[2];
        const rPl = Math.sqrt(rxp * rxp + ryp * ryp + rzp * rzp);

        const ux = rPl >= 0.25 ? rxp / rPl : bhT1[0];
        const uy = rPl >= 0.25 ? ryp / rPl : bhT1[1];
        const uz = rPl >= 0.25 ? rzp / rPl : bhT1[2];
        const tx = bhN[1] * uz - bhN[2] * uy;
        const ty = bhN[2] * ux - bhN[0] * uz;
        const tz = bhN[0] * uy - bhN[1] * ux;
        const spiralIn = -0.26 * vCirc;
        const nj = (Math.random() - 0.5) * 0.14;

        this.pState[idx] = 1;
        this.pFade[idx] = 1.0;
        this.px[idx] = x; this.py[idx] = y; this.pz[idx] = z;
        this.pvx[idx] = tx * vCirc + ux * spiralIn + bhN[0] * nj + biasVx;
        this.pvy[idx] = ty * vCirc + uy * spiralIn + bhN[1] * nj + biasVy;
        this.pvz[idx] = tz * vCirc + uz * spiralIn + bhN[2] * nj + biasVz;
        this.pSize[idx] = 2.0 + Math.random() * 2.8;
        this.pAge[idx] = 0;
    }

    emitCursorStream(nx, ny, vx, vy, count, speedSpread = 0.28, boost = 0.62) {
        const pos = this.cursorToWorld(nx, ny, this._worldOut);
        let cx = pos[0], cy = pos[1], cz = pos[2];
        const r = Math.sqrt(cx * cx + cy * cy + cz * cz);
        if (r < 1.65) {
            const s = 1.9 / Math.max(0.1, r);
            cx *= s; cy *= s; cz *= s;
        }
        const bBaseX = clamp(vx * 5.0, -1.6, 1.6);
        const bBaseY = clamp(-vy * 5.0, -1.6, 1.6);
        for (let k = 0; k < count; k++) {
            const jx = (Math.random() - 0.5) * 0.42;
            const jy = (Math.random() - 0.5) * 0.42;
            const jz = (Math.random() - 0.5) * 0.42;
            const bx = bBaseX + (Math.random() - 0.5) * speedSpread;
            const by = bBaseY + (Math.random() - 0.5) * speedSpread;
            const bz = (Math.random() - 0.5) * speedSpread;
            this.spawnParticle(cx + jx, cy + jy, cz + jz, bx, by, bz, boost);
        }
    }

    emitShowcaseBurst(count = 54) {
        const baseA = Math.random() * Math.PI * 2;
        const t1 = this.bhT1, t2 = this.bhT2, n = this.bhN;
        for (let k = 0; k < count; k++) {
            const arm = (k % 3) * ((Math.PI * 2) / 3);
            const a = baseA + arm + (k / count) * 2.6 + (Math.random() - 0.5) * 0.32;
            const r = 2.1 + Math.random() * 5.2;
            const ca = Math.cos(a), sa = Math.sin(a);
            const hOff = (Math.random() - 0.5) * 0.75;
            this.spawnParticle(
                (t1[0] * ca + t2[0] * sa) * r + n[0] * hOff,
                (t1[1] * ca + t2[1] * sa) * r + n[1] * hOff,
                (t1[2] * ca + t2[2] * sa) * r + n[2] * hOff,
                (Math.random() - 0.5) * 0.20,
                (Math.random() - 0.5) * 0.20,
                (Math.random() - 0.5) * 0.20,
                0.52 + Math.random() * 0.26,
            );
        }
    }

    pointerMove(nx, ny, vx, vy, isDown = false) {
        this.pointer.x = nx;
        this.pointer.y = ny;
        this.pointer.vx = vx;
        this.pointer.vy = vy;
        this.emitCursorStream(nx, ny, vx, vy, isDown ? 4 : 2, isDown ? 0.42 : 0.24, 0.62);
    }

    interactAt(nx, ny) {
        this.pointer.x = nx;
        this.pointer.y = ny;
        this.emitCursorStream(nx, ny, 0, 0, config.CLICK_BURST_COUNT, 0.52, 0.60);
    }

    buttonHoverPulse(nx, ny) {
        this.emitCursorStream(nx, ny, 0, 0, config.BUTTON_PULSE_COUNT, 0.36, 0.64);
    }

    ignite() {
        this.igniteT = 0;
        this.dolly = 1;
        this.absorbGlow = Math.max(this.absorbGlow, 0.65);
        this.emitShowcaseBurst(config.IGNITE_BURST_COUNT);
    }

    stepParticles(dt, maxParticles = config.MAX_PARTICLES) {
        this.capacity = Math.max(1, Math.min(config.MAX_PARTICLES, maxParticles | 0));
        const subDt = dt * 0.5;
        const capR = config.PARTICLE_CAPTURE_R;
        const maxAge = config.PARTICLE_MAX_AGE;
        const bhN = this.bhN, bhT1 = this.bhT1, bhT2 = this.bhT2;
        const cam = this.cam;
        const pState = this.pState, pFade = this.pFade;
        const px = this.px, py = this.py, pz = this.pz;
        const pvx = this.pvx, pvy = this.pvy, pvz = this.pvz;
        const pSize = this.pSize, pAge = this.pAge;
        const pLineBuf = this.pLineBuf, pHeadBuf = this.pHeadBuf;
        const curGm = this.curGm, curDrag = this.curDrag, curSpin = this.curSpin;
        const wCyg = this.wCyg;

        // Ambient cosmic matter infall trickle
        if (Math.random() < dt * config.PARTICLE_AMBIENT_RATE) {
            const a = Math.random() * Math.PI * 2;
            const r = 2.7 + Math.random() * 4.8;
            const ca = Math.cos(a), sa = Math.sin(a);
            const hOff = (Math.random() - 0.5) * 0.45;
            this.spawnParticle(
                (bhT1[0] * ca + bhT2[0] * sa) * r + bhN[0] * hOff,
                (bhT1[1] * ca + bhT2[1] * sa) * r + bhN[1] * hOff,
                (bhT1[2] * ca + bhT2[2] * sa) * r + bhN[2] * hOff,
                0, 0, 0,
                0.54 + Math.random() * 0.22,
            );
        }

        const minDim = Math.max(1, Math.min(this.width, this.height));
        const ndcScaleX = (2 * minDim) / this.width;
        const ndcScaleY = (2 * minDim) / this.height;
        const camWorldRatio = cam.dist / cam.fov;
        const tdDamp = Math.exp(-dt * 2.4);
        const sink = 1 - dt * 0.48;
        const fadeDecay = Math.exp(-dt * 2.0);
        let alive = 0;
        let drawIdx = 0;

        // Every slot is stepped: particles above a lowered capacity live out
        // their age instead of vanishing or freezing until it rises again.
        for (let i = 0; i < config.MAX_PARTICLES; i++) {
            const state = pState[i];
            if (state === 0) continue;

            let x = px[i], y = py[i], z = pz[i];
            let vx = pvx[i], vy = pvy[i], vz = pvz[i];
            let fade = pFade[i];
            const age = pAge[i] + dt;

            if (state === 1) {
                for (let s = 0; s < 2; s++) {
                    const r2 = x * x + y * y + z * z;
                    const r = Math.sqrt(r2);
                    if (r <= capR) {
                        pState[i] = 2;
                        fade = 1.0;
                        this.capturedCount++;
                        this.absorbGlow = Math.min(1.6, this.absorbGlow + 0.065);
                        break;
                    }
                    const dr = r > 1.18 ? r - 1.0 : 0.18;
                    const aMag = -curGm / (dr * dr * r);
                    const dragScale = Math.max(0.75, 1 - curDrag * subDt * (1 + 4.5 / r2));
                    const fd = curSpin / (r2 * r);
                    const hPlane = x * bhN[0] + y * bhN[1] + z * bhN[2];
                    const fdx = (bhN[1] * z - bhN[2] * y) * fd;
                    const fdy = (bhN[2] * x - bhN[0] * z) * fd;
                    const fdz = (bhN[0] * y - bhN[1] * x) * fd;

                    vx = (vx + (x * aMag - bhN[0] * hPlane * 0.26 + fdx) * subDt) * dragScale;
                    vy = (vy + (y * aMag - bhN[1] * hPlane * 0.26 + fdy) * subDt) * dragScale;
                    vz = (vz + (z * aMag - bhN[2] * hPlane * 0.26 + fdz) * subDt) * dragScale;

                    const vn = vx * bhN[0] + vy * bhN[1] + vz * bhN[2];
                    const nDamp = vn * 0.28 * subDt;
                    vx -= bhN[0] * nDamp; vy -= bhN[1] * nDamp; vz -= bhN[2] * nDamp;

                    x += vx * subDt;
                    y += vy * subDt;
                    z += vz * subDt;
                }
            }

            const curState = pState[i];
            if (curState === 2) {
                vx *= tdDamp; vy *= tdDamp; vz *= tdDamp;
                x = x * sink + vx * dt;
                y = y * sink + vy * dt;
                z = z * sink + vz * dt;
                fade *= fadeDecay;
            }

            const r2Now = x * x + y * y + z * z;
            if (fade < 0.012 || age >= maxAge || r2Now > 484) {
                pState[i] = 0;
                continue;
            }

            px[i] = x; py[i] = y; pz[i] = z;
            pvx[i] = vx; pvy[i] = vy; pvz[i] = vz;
            pFade[i] = fade;
            pAge[i] = age;
            alive++;

            const dx = x - cam.ro[0], dy = y - cam.ro[1], dz = z - cam.ro[2];
            const zCam = dx * cam.ww[0] + dy * cam.ww[1] + dz * cam.ww[2];
            if (zCam <= 0.6) continue;

            const xCam = dx * cam.uu[0] + dy * cam.uu[1] + dz * cam.uu[2];
            const yCam = dx * cam.vv[0] + dy * cam.vv[1] + dz * cam.vv[2];
            const invZCam = cam.fov / zCam;
            let ax = xCam * invZCam;
            let ay = yCam * invZCam;

            const bWorld = Math.sqrt(ax * ax + ay * ay) * camWorldRatio;
            const behind = clamp((zCam - cam.dist) * 0.45, 0, 1);
            let lensScale = 1;
            if (behind > 0.01 && bWorld > 0.08) {
                const rE2 = 4.2 * behind;
                lensScale = (0.5 * (bWorld + Math.sqrt(bWorld * bWorld + 4 * rE2))) / bWorld;
                ax *= lensScale;
                ay *= lensScale;
            }

            // Smooth behind-shadow eclipse occlusion
            const bProj = bWorld * lensScale;
            const behindFade = clamp((zCam - (cam.dist + 0.1)) * 1.25, 0, 1);
            const shadowMask = clamp((bProj - 2.05) * 1.42857, 0, 1);
            const occ = 1 - behindFade * (1 - shadowMask);
            if (occ <= 0.008) continue;

            const rNow = Math.sqrt(r2Now);
            const heat = clamp(1.85 / Math.max(1.05, rNow) - 0.14, 0, 1);
            const fadeAgeIn = age < 0.2 ? age * 5.0 : 1;
            const fadeAgeOut = age > (maxAge - 3) ? Math.max(0, (maxAge - age) / 3) : 1;
            const alpha = occ * fadeAgeIn * fadeAgeOut * fade * (0.50 + 0.50 * heat);
            if (alpha <= 0.006) continue;

            const vMag = Math.sqrt(vx * vx + vy * vy + vz * vz);
            const tailDt = Math.min(0.052, 0.36 / (vMag > 0.8 ? vMag : 0.8))
                * (curState === 2 ? (1.0 + (1.0 - fade) * 1.4) : 1.0);
            const txW = x - vx * tailDt, tyW = y - vy * tailDt, tzW = z - vz * tailDt;
            const tdx = txW - cam.ro[0], tdy = tyW - cam.ro[1], tdz = tzW - cam.ro[2];
            const tzCam = Math.max(0.6, tdx * cam.ww[0] + tdy * cam.ww[1] + tdz * cam.ww[2]);
            const invTzScale = (cam.fov / tzCam) * lensScale;
            const tax = (tdx * cam.uu[0] + tdy * cam.uu[1] + tdz * cam.uu[2]) * invTzScale;
            const tay = (tdx * cam.vv[0] + tdy * cam.vv[1] + tdz * cam.vv[2]) * invTzScale;

            const warmR = 0.96 + heat * 0.04;
            const warmG = 0.44 + heat * 0.52;
            const warmB = 0.14 + heat * heat * 0.84;
            const cygR = 0.28 + heat * 0.72;
            const cygG = 0.62 + heat * 0.36;
            const cygB = 1.00;
            let cr = warmR + (cygR - warmR) * wCyg;
            let cg = warmG + (cygG - warmG) * wCyg;
            let cb = warmB + (cygB - warmB) * wCyg;

            if (curState === 2) {
                const sF = Math.sqrt(fade);
                cr *= Math.sqrt(sF) * sF; // fade^0.75
                cg *= fade * sF;           // fade^1.50
                cb *= fade * fade * sF;    // fade^2.50
            }

            const ndcHx = ax * ndcScaleX, ndcHy = ay * ndcScaleY;
            const lineOff = drawIdx * 12;
            pLineBuf[lineOff] = tax * ndcScaleX;
            pLineBuf[lineOff + 1] = tay * ndcScaleY;
            pLineBuf[lineOff + 2] = cr; pLineBuf[lineOff + 3] = cg; pLineBuf[lineOff + 4] = cb;
            pLineBuf[lineOff + 5] = alpha * 0.18;

            pLineBuf[lineOff + 6] = ndcHx;
            pLineBuf[lineOff + 7] = ndcHy;
            pLineBuf[lineOff + 8] = cr; pLineBuf[lineOff + 9] = cg; pLineBuf[lineOff + 10] = cb;
            pLineBuf[lineOff + 11] = alpha * 0.86;

            const headOff = drawIdx * 7;
            pHeadBuf[headOff] = ndcHx;
            pHeadBuf[headOff + 1] = ndcHy;
            pHeadBuf[headOff + 2] = cr; pHeadBuf[headOff + 3] = cg; pHeadBuf[headOff + 4] = cb;
            pHeadBuf[headOff + 5] = alpha;
            pHeadBuf[headOff + 6] = pSize[i] * (0.85 + 0.45 * heat) * (curState === 2 ? (0.35 + 0.65 * fade) : 1.0);
            drawIdx++;
        }

        this.activeCount = alive;
        this.drawCount = drawIdx;
    }

    update(dt, quality = {}, parallax = { x: 0, y: 0 }) {
        const clampedDt = Math.min(0.05, Math.max(0.001, dt));
        this.time += clampedDt;
        this.igniteT += clampedDt;
        this.absorbGlow *= Math.exp(-clampedDt * 2.4);
        this.dolly *= Math.exp(-clampedDt * config.INTRO_EASE);
        this.skyAngle += clampedDt * config.SKY_TURN_RATE;

        if (this.pointer.down) {
            this._emitAccum += clampedDt * config.HOLD_EMIT_RATE;
            while (this._emitAccum >= 1) {
                this._emitAccum -= 1;
                this.emitCursorStream(this.pointer.x, this.pointer.y, this.pointer.vx, this.pointer.vy, 2, 0.36, 0.60);
            }
        } else {
            this._emitAccum = 0;
        }

        this.updateBhBasis(clampedDt);
        this.updateCamera(parallax.x || 0, parallax.y || 0);
        this.stepParticles(clampedDt, quality.maxParticles || config.MAX_PARTICLES);
    }
}
