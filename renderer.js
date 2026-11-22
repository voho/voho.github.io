// renderer.js
// Unified high-performance renderer:
//   - WebGL2: precomputed core rotation matrix, analytical shell skip,
//     tetrahedral SDF normals, early core-hit background skip, 3-tap fluid
//     composite, vertex-shaded tracer palette, and cached buffer views
//   - Canvas2DRenderer: graceful fallback with precomputed 128x128 sphere LUT

import { config } from './config.js';

const TAU = Math.PI * 2;
const SPHERE_LUT_SIZE = 128;

function clamp(x, lo, hi) {
    return x < lo ? lo : x > hi ? hi : x;
}

export const SHADERS = {
    FS_VS: `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID == 1) ? 3.0 : -1.0, (gl_VertexID == 2) ? 3.0 : -1.0);
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`,

    MAIN_FS: `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uFluidTex; // R,G,B = dye, A = |curl|
uniform sampler2D uSimTex;   // R = Turing v, G = u, B = wave, A = ridge slope
uniform vec2 uRes;
uniform vec2 uFluidTexel;
uniform float uTime;
uniform vec2 uParallax;
uniform vec2 uPointer;
uniform float uPointerStrength;
uniform vec2 uMood;
uniform float uIgniteT;
uniform float uCoreScale;
uniform float uCamZ;
uniform float uCamFov;
uniform float uCoreRadius;
uniform float uMarchSteps;
uniform mat3 uCoreRot;

float sdOctahedron(vec3 p, float s) {
  p = abs(p);
  return (p.x + p.y + p.z - s) * 0.57735027;
}

vec4 sampleSimLocal(vec3 q, float len) {
  vec2 suv = vec2(atan(q.z, q.x) * 0.159154943 + 0.5,
                  acos(clamp(q.y / max(1e-4, len), -1.0, 1.0)) * 0.318309886);
  return textureLod(uSimTex, suv, 0.0);
}

float mapCoreLocal(vec3 q) {
  float len = length(q);
  float shellDist = len - uCoreRadius;
  // Analytical shell skip outside max Turing/crystal envelope
  if (shellDist > 0.40) return shellDist - 0.28;

  vec4 sim = sampleSimLocal(q, len);
  float morph = sim.r;
  float wave = (sim.b - 0.5) * 2.0;

  float facetAmt = clamp(0.10 + uMood.x * 0.34 - uMood.y * 0.08, 0.02, 0.45);
  float crystal = sdOctahedron(q, uCoreRadius * 1.32) - 0.11;
  float base = mix(shellDist, crystal, facetAmt);
  return (base - morph * 0.14 - wave * 0.072) * 0.72;
}

// 4-tap tetrahedral gradient normal (33% fewer taps than central difference)
vec3 calcNormalLocal(vec3 q) {
  const float h = 0.0032;
  const vec2 k = vec2(1.0, -1.0);
  return normalize(
    k.xyy * mapCoreLocal(q + k.xyy * h) +
    k.yyx * mapCoreLocal(q + k.yyx * h) +
    k.yxy * mapCoreLocal(q + k.yxy * h) +
    k.xxx * mapCoreLocal(q + k.xxx * h)
  );
}

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float starField(vec2 uv, float scale) {
  vec2 gv = fract(uv * scale) - 0.5;
  vec2 id = floor(uv * scale);
  float h = hash21(id);
  if (h < 0.80) return 0.0;
  vec2 off = vec2(hash21(id + 2.1), hash21(id + 9.4)) - 0.5;
  float d = length(gv - off * 0.65);
  float tw = 0.55 + 0.45 * sin(uTime * (1.3 + h * 1.9) + h * 25.0);
  return smoothstep(0.075, 0.0, d) * tw * (0.45 + 0.55 * fract(h * 17.0));
}

vec3 thinFilm(float x, float shift) {
  return 0.5 + 0.5 * cos(6.28318 * (x * 1.4 + shift + vec3(0.0, 0.33, 0.67)));
}

vec3 sampleFluidFast(vec2 uv) {
  vec4 c0 = texture(uFluidTex, uv);
  vec2 disp = normalize(uv - 0.5 + 1e-4) * uFluidTexel * 0.85;
  float rD = texture(uFluidTex, uv + disp).r;
  float bD = texture(uFluidTex, uv - disp).b;
  vec3 dye = vec3(mix(c0.r, rD, 0.5), c0.g, mix(c0.b, bD, 0.5));

  vec3 vortTint = mix(vec3(0.45, 0.85, 1.0), vec3(0.30, 0.96, 0.78), uMood.y);
  vortTint = mix(vortTint, vec3(0.55, 0.68, 1.0), uMood.x);
  return dye + vortTint * c0.a * 0.40;
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  float minDim = max(1.0, min(uRes.x, uRes.y));
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / minDim;
  vec2 ptr = (uPointer - 0.5) * vec2(uRes.x / minDim, uRes.y / minDim);

  // Ray setup & core raymarch FIRST so solid core pixels skip background work
  vec3 ro = vec3(uParallax.x * 0.16, uParallax.y * 0.16, uCamZ);
  vec3 ww = normalize(-ro);
  vec3 uu = normalize(cross(vec3(0.0, 1.0, 0.0), ww));
  vec3 vv = cross(ww, uu);
  vec3 rd = normalize(uv.x * uu + uv.y * vv + uCamFov * ww);

  float seedScale = mix(0.26, 1.0, 1.0 - exp(-uIgniteT * 3.1));
  float invScale = 1.0 / max(0.05, seedScale * uCoreScale);
  float boundR = 1.42 * uCoreScale;
  float b = dot(ro, rd);
  float c = dot(ro, ro) - boundR * boundR;
  float h = b * b - c;

  vec3 moodAura = mix(vec3(0.28, 0.60, 1.0), vec3(0.18, 0.88, 0.72), uMood.y);
  moodAura = mix(moodAura, vec3(0.36, 0.78, 1.0), uMood.x);

  bool hit = false;
  float minD = 1e6;
  vec3 qHit = vec3(0.0);

  if (h > 0.0) {
    vec3 roL = uCoreRot * (ro * invScale);
    vec3 rdL = uCoreRot * (rd * invScale);
    float tStart = max(0.0, -b - sqrt(h));
    float tEnd = -b + sqrt(h);
    float t = tStart;
    int maxSteps = int(uMarchSteps);

    for (int i = 0; i < 48; i++) {
      if (i >= maxSteps) break;
      vec3 q = roL + rdL * t;
      float dLocal = mapCoreLocal(q);
      minD = min(minD, dLocal);
      if (dLocal < 0.003) {
        hit = true;
        qHit = q;
        break;
      }
      t += dLocal / invScale;
      if (t > tEnd) break;
    }
  }

  vec3 col;
  if (hit) {
    vec3 NL = calcNormalLocal(qHit);
    vec3 N = NL * uCoreRot; // uCoreRot is orthonormal: transpose == inverse
    vec3 V = -rd;
    vec4 sim = sampleSimLocal(qHit, length(qHit));
    float morph = sim.r;
    float wave = abs(sim.b - 0.5) * 2.0;
    float ridge = sim.a;

    vec3 L1 = normalize(vec3(ptr.x * 2.1 + 0.5, ptr.y * 2.1 + 0.6, 1.6));
    vec3 L2 = normalize(vec3(-1.3 * cos(uTime * 0.3), -0.9, 1.1));

    float ndv = max(dot(N, V), 0.0);
    float fresnel = pow(1.0 - ndv, 2.7);
    float spec1 = pow(max(dot(reflect(-L1, N), V), 0.0), 34.0);
    float spec2 = pow(max(dot(reflect(-L2, N), V), 0.0), 20.0);

    float moodPhase = uMood.x * 0.18 - uMood.y * 0.28;
    vec3 irid = thinFilm(1.0 - ndv + morph * 0.45 + dot(N, L1) * 0.2, uTime * 0.05 + moodPhase);

    vec2 reflUv = clamp(vUv + N.xy * 0.22, 0.02, 0.98);
    vec3 fluidRefl = texture(uFluidTex, reflUv).rgb;

    col = vec3(0.013, 0.019, 0.040);
    col += irid * fresnel * 1.05;
    col += fluidRefl * (0.28 + 0.72 * fresnel) * 0.85;
    float vein = smoothstep(0.28, 0.88, morph) * 0.20 + ridge * 0.26 + wave * 0.32;
    col += irid * vein * (0.35 + 0.65 * fresnel);
    col += mix(vec3(0.48, 0.84, 1.0), irid, 0.5) * spec1 * (1.1 + 0.3 * uPointerStrength);
    col += mix(vec3(0.75, 0.42, 1.0), vec3(0.20, 0.92, 0.72), uMood.y) * spec2 * 0.55;
  } else {
    col = mix(vec3(0.015, 0.022, 0.048), vec3(0.032, 0.054, 0.112), 1.0 - clamp(vUv.y, 0.0, 1.0));
    float stars = starField(uv + uParallax * 0.015 + uTime * 0.0022, 10.5);
    col += vec3(0.75, 0.88, 1.0) * stars * 0.48;

    vec3 fluidCol = sampleFluidFast(vUv);
    float centerGuard = mix(0.64, 1.0, smoothstep(0.14, 0.56, length(uv * vec2(0.76, 1.12))));
    col += fluidCol * 1.08 * centerGuard;
    col += moodAura * exp(-dot(uv, uv) * 2.4) * 0.14;
    if (h > 0.0) {
      col += moodAura * exp(-max(0.0, minD) * 7.5) * 0.28;
    }
  }

  if (uIgniteT < 1.8) {
    float ignRing = exp(-pow((length(uv) - uIgniteT * 0.68) * 14.0, 2.0)) * exp(-uIgniteT * 1.9);
    col += thinFilm(uIgniteT, 0.2) * ignRing * 0.36;
  }

  vec2 dVig = vUv - 0.5;
  col *= 1.0 - dot(dVig, dVig) * 0.48;
  col = pow(aces(col), vec3(1.0 / 1.06));
  fragColor = vec4(col, 1.0);
}`,

    TRACER_VS: `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec3 aMeta; // speedNorm, hueShift, alpha
uniform float uPointScale;
uniform vec2 uMood;
out vec4 vColor;

vec3 palette(float t) {
  vec3 base = 0.54 + 0.44 * cos(6.28318 * (t + vec3(0.08, 0.34, 0.68)));
  vec3 linkedIn = mix(vec3(0.28, 0.76, 1.0), vec3(0.62, 0.62, 1.0), 0.5 + 0.5 * sin(t * 6.28318));
  vec3 spotify = mix(vec3(0.20, 0.95, 0.68), vec3(0.80, 0.42, 1.0), 0.5 + 0.5 * cos(t * 6.28318));
  base = mix(base, linkedIn, uMood.x * 0.70);
  base = mix(base, spotify, uMood.y * 0.70);
  return base;
}

void main() {
  gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = clamp((1.35 + aMeta.x * 2.0) * uPointScale, 1.3, 4.6);
  vColor = vec4(palette(aMeta.y), aMeta.z);
}`,

    TRACER_FS: `#version 300 es
precision highp float;
in vec4 vColor;
out vec4 fragColor;
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  float w = 1.0 - r2;
  w *= w;
  float a = w * vColor.a;
  fragColor = vec4(vColor.rgb * a, a);
}`,
};

function compileShader(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src.trimStart());
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        gl.deleteShader(s);
        return null;
    }
    return s;
}

function createProgram(gl, vsSrc, fsSrc) {
    const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return null;
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        gl.deleteProgram(program);
        return null;
    }
    const u = {};
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
        const info = gl.getActiveUniform(program, i);
        if (info) u[info.name] = gl.getUniformLocation(program, info.name);
    }
    return { program, u };
}

function createTexture(gl, w, h, wrapS) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return tex;
}

export class WebGL2Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = null;
        this.ready = false;
        this.fluidW = 0;
        this.fluidH = 0;
        this.fluidTex = null;
        this.simTex = null;
        this.quadVao = null;
        this.tracerVao = null;
        this.tracerVbo = null;
        this.mainProg = null;
        this.tracerProg = null;
        this.coreRot = new Float32Array(9);
        this.cachedTracerCount = -1;
        this.cachedTracerView = null;
    }

    init(sim) {
        let gl = null;
        try {
            gl = this.canvas.getContext('webgl2', {
                antialias: false,
                alpha: false,
                depth: false,
                stencil: false,
                powerPreference: 'high-performance',
            });
        } catch (_) {
            return false;
        }
        if (!gl) return false;
        this.gl = gl;
        return this.rebuildResources(sim);
    }

    rebuildResources(sim) {
        const gl = this.gl;
        if (!gl || gl.isContextLost()) return false;

        this.mainProg = createProgram(gl, SHADERS.FS_VS, SHADERS.MAIN_FS);
        this.tracerProg = createProgram(gl, SHADERS.TRACER_VS, SHADERS.TRACER_FS);
        if (!this.mainProg || !this.tracerProg) return false;

        this.quadVao = gl.createVertexArray();
        this.simTex = createTexture(gl, sim.tw, sim.th, gl.REPEAT);
        this.fluidW = sim.gw;
        this.fluidH = sim.gh;
        this.fluidTex = createTexture(gl, sim.gw, sim.gh, gl.CLAMP_TO_EDGE);

        this.tracerVao = gl.createVertexArray();
        this.tracerVbo = gl.createBuffer();
        gl.bindVertexArray(this.tracerVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.tracerVbo);
        gl.bufferData(gl.ARRAY_BUFFER, sim.tracerBuf.byteLength, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 20, 0);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 20, 8);
        gl.bindVertexArray(null);

        this.cachedTracerCount = -1;
        this.cachedTracerView = null;
        this.ready = true;
        return true;
    }

    _updateCoreRot(t) {
        const a = t * config.CORE_SPIN_RAD_S;
        const b = Math.sin(t * 0.11) * 0.14;
        const ca = Math.cos(a), sa = Math.sin(a);
        const cb = Math.cos(b), sb = Math.sin(b);
        const m = this.coreRot;
        m[0] = ca * cb;  m[1] = ca * sb;  m[2] = sa;
        m[3] = -sb;      m[4] = cb;       m[5] = 0;
        m[6] = -sa * cb; m[7] = -sa * sb; m[8] = ca;
    }

    render(sim, view, quality) {
        const gl = this.gl;
        if (!this.ready || !gl || gl.isContextLost()) return;

        if (sim.gw !== this.fluidW || sim.gh !== this.fluidH) {
            this.fluidW = sim.gw;
            this.fluidH = sim.gh;
            gl.bindTexture(gl.TEXTURE_2D, this.fluidTex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, sim.gw, sim.gh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        }

        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.disable(gl.BLEND);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.fluidTex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, sim.gw, sim.gh, gl.RGBA, gl.UNSIGNED_BYTE, sim.fluidTexBytes);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.simTex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, sim.tw, sim.th, gl.RGBA, gl.UNSIGNED_BYTE, sim.turingTexBytes);

        this._updateCoreRot(sim.time);

        const m = this.mainProg;
        gl.useProgram(m.program);
        gl.uniform1i(m.u.uFluidTex, 0);
        gl.uniform1i(m.u.uSimTex, 1);
        gl.uniform2f(m.u.uRes, this.canvas.width, this.canvas.height);
        gl.uniform2f(m.u.uFluidTexel, 1 / sim.gw, 1 / sim.gh);
        gl.uniform1f(m.u.uTime, sim.time);
        gl.uniform2f(m.u.uParallax, view.parallax.x, view.parallax.y);
        gl.uniform2f(m.u.uPointer, view.pointer.x, 1 - view.pointer.y);
        gl.uniform1f(m.u.uPointerStrength, view.pointer.strength);
        gl.uniform2f(m.u.uMood, sim.wLinkedIn, sim.wSpotify);
        gl.uniform1f(m.u.uIgniteT, sim.igniteT);
        gl.uniform1f(m.u.uCoreScale, sim.coreScale);
        gl.uniform1f(m.u.uCamZ, config.CORE_CAM_Z);
        gl.uniform1f(m.u.uCamFov, config.CORE_CAM_FOV);
        gl.uniform1f(m.u.uCoreRadius, config.CORE_WORLD_RADIUS);
        gl.uniform1f(m.u.uMarchSteps, quality.marchSteps);
        gl.uniformMatrix3fv(m.u.uCoreRot, false, this.coreRot);

        gl.bindVertexArray(this.quadVao);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        const tCount = quality.tracers;
        if (tCount > 0) {
            if (tCount !== this.cachedTracerCount || !this.cachedTracerView || this.cachedTracerView.buffer !== sim.tracerBuf.buffer) {
                this.cachedTracerCount = tCount;
                this.cachedTracerView = sim.tracerBuf.subarray(0, tCount * 5);
            }
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.ONE, gl.ONE);
            const tr = this.tracerProg;
            gl.useProgram(tr.program);
            gl.uniform1f(tr.u.uPointScale, view.dpr);
            gl.uniform2f(tr.u.uMood, sim.wLinkedIn, sim.wSpotify);
            gl.bindVertexArray(this.tracerVao);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.tracerVbo);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.cachedTracerView);
            gl.drawArrays(gl.POINTS, 0, tCount);
            gl.bindVertexArray(null);
        }
    }
}

export class Canvas2DRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.off = document.createElement('canvas');
        this.offCtx = this.off.getContext('2d');
        this.imgData = null;
        this.gw = 0;
        this.gh = 0;

        // Precomputed 128x128 unit-sphere lookup table for fast 1-drawImage core blit
        const S = SPHERE_LUT_SIZE;
        this.sphereCanvas = document.createElement('canvas');
        this.sphereCanvas.width = S;
        this.sphereCanvas.height = S;
        this.sphereCtx = this.sphereCanvas.getContext('2d');
        this.sphereImg = this.sphereCtx.createImageData(S, S);

        const maxDisc = S * S;
        const pix = new Int32Array(maxDisc);
        const nxArr = new Float32Array(maxDisc);
        const nzArr = new Float32Array(maxDisc);
        const gyArr = new Uint8Array(maxDisc);
        const fresArr = new Float32Array(maxDisc);
        let count = 0;
        const half = S * 0.5;
        for (let py = 0; py < S; py++) {
            const ny = 1 - ((py + 0.5) / half);
            for (let px = 0; px < S; px++) {
                const nx = ((px + 0.5) / half) - 1;
                const r2 = nx * nx + ny * ny;
                if (r2 > 1) continue;
                const nz = Math.sqrt(1 - r2);
                pix[count] = (py * S + px) * 4;
                nxArr[count] = nx;
                nzArr[count] = nz;
                gyArr[count] = Math.min(config.TURING_H - 1, ((Math.acos(clamp(ny, -1, 1)) / Math.PI) * config.TURING_H) | 0);
                fresArr[count] = Math.pow(1 - nz, 2.2);
                count++;
            }
        }
        this.lutCount = count;
        this.lutPix = pix.subarray(0, count);
        this.lutNx = nxArr.subarray(0, count);
        this.lutNz = nzArr.subarray(0, count);
        this.lutGy = gyArr.subarray(0, count);
        this.lutFres = fresArr.subarray(0, count);
    }

    _syncOffscreen(gw, gh) {
        if (this.gw === gw && this.gh === gh && this.imgData) return;
        this.gw = gw;
        this.gh = gh;
        this.off.width = gw;
        this.off.height = gh;
        this.imgData = this.offCtx.createImageData(gw, gh);
    }

    render(sim, view) {
        const ctx = this.ctx;
        if (!ctx) return;
        const w = view.w, h = view.h;

        this._syncOffscreen(sim.gw, sim.gh);
        const data = this.imgData.data;
        const bytes = sim.fluidTexBytes;
        for (let j = 0; j < sim.gh; j++) {
            const srcRow = (sim.gh - 1 - j) * sim.gw;
            const dstRow = j * sim.gw;
            for (let i = 0; i < sim.gw; i++) {
                const s = (srcRow + i) * 4;
                const d = (dstRow + i) * 4;
                const r = 7 + bytes[s] + (bytes[s + 3] >> 2);
                const g = 11 + bytes[s + 1] + (bytes[s + 3] >> 1);
                const b = 22 + bytes[s + 2] + bytes[s + 3];
                data[d] = r > 255 ? 255 : r;
                data[d + 1] = g > 255 ? 255 : g;
                data[d + 2] = b > 255 ? 255 : b;
                data[d + 3] = 255;
            }
        }
        this.offCtx.putImageData(this.imgData, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(this.off, 0, 0, w, h);

        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = 'rgba(145, 220, 255, 0.5)';
        const tracerDraw = Math.min(550, config.TRACER_COUNT);
        const tx = sim.tx, ty = sim.ty;
        for (let i = 0; i < tracerDraw; i++) {
            ctx.fillRect(tx[i] * w, (1 - ty[i]) * h, 1.5, 1.5);
        }
        ctx.restore();

        // Blit precomputed 128x128 obsidian Turing core with zero per-pixel fillRects
        const minDim = Math.min(w, h);
        const R = minDim * sim.coreScreenRadiusFrac;
        const cx = w * 0.5 - view.parallax.x * 8;
        const cy = h * 0.5 + view.parallax.y * 8;

        const aura = ctx.createRadialGradient(cx, cy, R * 0.5, cx, cy, R * 1.65);
        aura.addColorStop(0, sim.wSpotify > 0.3 ? 'rgba(32, 224, 176, 0.18)' : 'rgba(89, 215, 255, 0.18)');
        aura.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = aura;
        ctx.fillRect(0, 0, w, h);

        const sData = this.sphereImg.data;
        const lutCount = this.lutCount;
        const lutPix = this.lutPix, lutNx = this.lutNx, lutNz = this.lutNz;
        const lutGy = this.lutGy, lutFres = this.lutFres;
        const gsV = sim.gsV, waveH = sim.waveH;
        const tw = sim.tw;
        const a = -sim.time * config.CORE_SPIN_RAD_S;
        const cosA = Math.cos(a), sinA = Math.sin(a);
        const spotBoost = sim.wSpotify * 0.35;
        const invTau = 1 / TAU;

        for (let k = 0; k < lutCount; k++) {
            const nx = lutNx[k], nz = lutNz[k];
            const rx = nx * cosA - nz * sinA;
            const rz = nx * sinA + nz * cosA;
            const u = ((Math.atan2(rz, rx) * invTau + 0.5) % 1 + 1) % 1;
            const gx = Math.min(tw - 1, (u * tw) | 0);
            const idx = lutGy[k] * tw + gx;
            const morph = gsV[idx];
            const wave = waveH[idx];
            const wAbs = wave < 0 ? -wave : wave;
            const fres = lutFres[k];
            const inten = morph * 1.35 + wAbs * 0.55 + fres * 0.9;
            const p = lutPix[k];
            if (inten <= 0.12) {
                sData[p] = 6; sData[p + 1] = 10; sData[p + 2] = 22; sData[p + 3] = 248;
            } else {
                const phase = morph * 2.2 + fres * 1.4 + spotBoost;
                const r = 10 + (0.5 + 0.5 * Math.cos(phase + 2.2)) * inten * 115;
                const g = 14 + (0.5 + 0.5 * Math.cos(phase + 0.9)) * inten * 150;
                const b = 28 + (0.5 + 0.5 * Math.cos(phase - 0.3)) * inten * 215;
                sData[p] = r > 255 ? 255 : r | 0;
                sData[p + 1] = g > 255 ? 255 : g | 0;
                sData[p + 2] = b > 255 ? 255 : b | 0;
                sData[p + 3] = 250;
            }
        }
        this.sphereCtx.putImageData(this.sphereImg, 0, 0);
        ctx.drawImage(this.sphereCanvas, cx - R, cy - R, R * 2, R * 2);
    }
}
