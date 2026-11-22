// renderer.js
// Unified renderer: WebGL2 (3D raymarched Turing core + Navier-Stokes fluid
// environment reflections + additive Lagrangian tracers) and a matching
// Canvas 2D fallback driven by the exact same CoupledSimulation state.

import { config } from './config.js';

const TAU = Math.PI * 2;

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
uniform float uCoreSpin;
uniform float uMarchSteps;

mat2 rot2(float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c);
}

float sdOctahedron(vec3 p, float s) {
  p = abs(p);
  return (p.x + p.y + p.z - s) * 0.57735027;
}

vec2 sphereUv(vec3 q) {
  float len = max(1e-4, length(q));
  float u = atan(q.z, q.x) / 6.2831853 + 0.5;
  float v = acos(clamp(q.y / len, -1.0, 1.0)) / 3.14159265;
  return vec2(u, v);
}

vec4 sampleSim(vec3 q) {
  vec3 rq = q;
  rq.xz *= rot2(uTime * uCoreSpin);
  rq.xy *= rot2(sin(uTime * 0.11) * 0.14);
  return textureLod(uSimTex, sphereUv(rq), 0.0);
}

float mapCore(vec3 p) {
  float seedScale = mix(0.26, 1.0, 1.0 - exp(-uIgniteT * 3.1));
  float scale = max(0.05, seedScale * uCoreScale);
  vec3 q = p / scale;

  vec4 sim = sampleSim(q);
  float morph = sim.r;
  float wave = (sim.b - 0.5) * 2.0;

  float sphere = length(q) - uCoreRadius;
  vec3 rq = q;
  rq.xz *= rot2(uTime * uCoreSpin);
  float crystal = sdOctahedron(rq, uCoreRadius * 1.32) - 0.11;
  float facetAmt = clamp(0.10 + uMood.x * 0.34 - uMood.y * 0.08, 0.02, 0.45);
  float base = mix(sphere, crystal, facetAmt);

  return (base - morph * 0.14 - wave * 0.072) * 0.72 * scale;
}

vec3 calcNormal(vec3 p) {
  const float e = 0.003;
  return normalize(vec3(
    mapCore(p + vec3(e, 0.0, 0.0)) - mapCore(p - vec3(e, 0.0, 0.0)),
    mapCore(p + vec3(0.0, e, 0.0)) - mapCore(p - vec3(0.0, e, 0.0)),
    mapCore(p + vec3(0.0, 0.0, e)) - mapCore(p - vec3(0.0, 0.0, e))
  ));
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
  if (h < 0.85) return 0.0;
  vec2 off = vec2(hash21(id + 2.1), hash21(id + 9.4)) - 0.5;
  float d = length(gv - off * 0.65);
  float tw = 0.55 + 0.45 * sin(uTime * (1.3 + h * 1.9) + h * 25.0);
  return smoothstep(0.075, 0.0, d) * tw;
}

vec3 thinFilm(float x, float shift) {
  return 0.5 + 0.5 * cos(6.28318 * (x * 1.4 + shift + vec3(0.0, 0.33, 0.67)));
}

vec3 sampleFluid(vec2 uv) {
  vec4 c0 = texture(uFluidTex, uv);
  vec4 c1 = texture(uFluidTex, uv + vec2(uFluidTexel.x, 0.0));
  vec4 c2 = texture(uFluidTex, uv - vec2(uFluidTexel.x, 0.0));
  vec4 c3 = texture(uFluidTex, uv + vec2(0.0, uFluidTexel.y));
  vec4 c4 = texture(uFluidTex, uv - vec2(0.0, uFluidTexel.y));
  vec4 fluid = c0 * 0.44 + (c1 + c2 + c3 + c4) * 0.14;

  vec2 disp = normalize(uv - 0.5 + 1e-4) * uFluidTexel * 0.85;
  float rD = texture(uFluidTex, uv + disp).r;
  float bD = texture(uFluidTex, uv - disp).b;
  vec3 dye = vec3(mix(fluid.r, rD, 0.45), fluid.g, mix(fluid.b, bD, 0.45));

  vec3 vortTint = mix(vec3(0.45, 0.85, 1.0), vec3(0.30, 0.96, 0.78), uMood.y);
  vortTint = mix(vortTint, vec3(0.55, 0.68, 1.0), uMood.x);
  return dye + vortTint * fluid.a * 0.38;
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  float minDim = max(1.0, min(uRes.x, uRes.y));
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / minDim;
  vec2 ptr = (uPointer - 0.5) * vec2(uRes.x / minDim, uRes.y / minDim);

  // Subtle backdrop + twinkling starfield
  vec3 bg = mix(vec3(0.015, 0.022, 0.048), vec3(0.032, 0.054, 0.112), 1.0 - clamp(vUv.y, 0.0, 1.0));
  float stars = starField(uv + uParallax * 0.015 + uTime * 0.0022, 9.0) * 0.55
              + starField(uv * 1.35 - uTime * 0.0018, 14.0) * 0.35;
  bg += vec3(0.75, 0.88, 1.0) * stars * 0.45;

  // Add live Navier-Stokes fluid plumes with gentle center readability guard
  vec3 fluidCol = sampleFluid(vUv);
  float centerGuard = mix(0.64, 1.0, smoothstep(0.14, 0.56, length(uv * vec2(0.76, 1.12))));
  bg += fluidCol * 1.08 * centerGuard;

  vec3 moodAura = mix(vec3(0.28, 0.60, 1.0), vec3(0.18, 0.88, 0.72), uMood.y);
  moodAura = mix(moodAura, vec3(0.36, 0.78, 1.0), uMood.x);
  bg += moodAura * exp(-dot(uv, uv) * 2.4) * 0.14;

  // Raymarch central 3D Turing obsidian core
  vec3 ro = vec3(uParallax.x * 0.16, uParallax.y * 0.16, uCamZ);
  vec3 ta = vec3(0.0);
  vec3 ww = normalize(ta - ro);
  vec3 uu = normalize(cross(vec3(0.0, 1.0, 0.0), ww));
  vec3 vv = cross(ww, uu);
  vec3 rd = normalize(uv.x * uu + uv.y * vv + uCamFov * ww);

  float boundR = 1.42 * uCoreScale;
  float b = dot(ro, rd);
  float c = dot(ro, ro) - boundR * boundR;
  float h = b * b - c;

  vec3 col = bg;
  if (h > 0.0) {
    float tStart = max(0.0, -b - sqrt(h));
    float tEnd = -b + sqrt(h);
    float t = tStart;
    float minD = 1e6;
    bool hit = false;
    int maxSteps = int(uMarchSteps);

    for (int i = 0; i < 48; i++) {
      if (i >= maxSteps) break;
      vec3 p = ro + rd * t;
      float d = mapCore(p);
      minD = min(minD, d);
      if (d < 0.003) {
        hit = true;
        break;
      }
      t += d;
      if (t > tEnd) break;
    }

    float rimAura = exp(-max(0.0, minD) * 7.5) * 0.28;
    col += moodAura * rimAura;

    if (hit) {
      vec3 p = ro + rd * t;
      vec3 N = calcNormal(p);
      vec3 V = -rd;
      vec4 sim = sampleSim(p / max(0.05, uCoreScale));
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

      // Sample live Navier-Stokes fluid reflected across the glossy obsidian core
      vec2 reflUv = clamp(vUv + N.xy * 0.22, 0.02, 0.98);
      vec3 fluidRefl = texture(uFluidTex, reflUv).rgb;

      // Deep dark obsidian interior keeps white center typography ultra-legible
      vec3 surf = vec3(0.013, 0.019, 0.040);
      surf += irid * fresnel * 1.05;
      surf += fluidRefl * (0.28 + 0.72 * fresnel) * 0.85;
      float vein = smoothstep(0.28, 0.88, morph) * 0.20 + ridge * 0.26 + wave * 0.32;
      surf += irid * vein * (0.35 + 0.65 * fresnel);
      surf += mix(vec3(0.48, 0.84, 1.0), irid, 0.5) * spec1 * (1.1 + 0.3 * uPointerStrength);
      surf += mix(vec3(0.75, 0.42, 1.0), vec3(0.20, 0.92, 0.72), uMood.y) * spec2 * 0.55;

      col = mix(bg, surf, 0.97);
    }
  }

  // Subtle ignite shockwave shell
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
out vec3 vMeta;
void main() {
  gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = clamp((1.35 + aMeta.x * 2.0) * uPointScale, 1.3, 4.6);
  vMeta = aMeta;
}`,

    TRACER_FS: `#version 300 es
precision highp float;
in vec3 vMeta;
uniform vec2 uMood;
out vec4 fragColor;

vec3 palette(float t) {
  vec3 base = 0.54 + 0.44 * cos(6.28318 * (t + vec3(0.08, 0.34, 0.68)));
  vec3 linkedIn = mix(vec3(0.28, 0.76, 1.0), vec3(0.62, 0.62, 1.0), 0.5 + 0.5 * sin(t * 6.28318));
  vec3 spotify = mix(vec3(0.20, 0.95, 0.68), vec3(0.80, 0.42, 1.0), 0.5 + 0.5 * cos(t * 6.28318));
  base = mix(base, linkedIn, uMood.x * 0.70);
  base = mix(base, spotify, uMood.y * 0.70);
  return base;
}

void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  float w = exp(-r2 * 3.0);
  vec3 col = palette(vMeta.y);
  float a = w * vMeta.z;
  fragColor = vec4(col * a, a);
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

        this.ready = true;
        return true;
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
        gl.uniform1f(m.u.uCoreSpin, config.CORE_SPIN_RAD_S);
        gl.uniform1f(m.u.uMarchSteps, quality.marchSteps);

        gl.bindVertexArray(this.quadVao);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        // Additive Lagrangian fluid tracers wrapping around the obsidian core
        if (quality.tracers > 0) {
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.ONE, gl.ONE);
            const tr = this.tracerProg;
            gl.useProgram(tr.program);
            gl.uniform1f(tr.u.uPointScale, view.dpr);
            gl.uniform2f(tr.u.uMood, sim.wLinkedIn, sim.wSpotify);
            gl.bindVertexArray(this.tracerVao);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.tracerVbo);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, sim.tracerBuf.subarray(0, quality.tracers * 5));
            gl.drawArrays(gl.POINTS, 0, quality.tracers);
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

        // 1. Draw live Navier-Stokes dye field smoothly scaled
        this._syncOffscreen(sim.gw, sim.gh);
        const data = this.imgData.data;
        const bytes = sim.fluidTexBytes;
        for (let j = 0; j < sim.gh; j++) {
            const srcRow = (sim.gh - 1 - j) * sim.gw;
            const dstRow = j * sim.gw;
            for (let i = 0; i < sim.gw; i++) {
                const s = (srcRow + i) * 4;
                const d = (dstRow + i) * 4;
                data[d] = Math.min(255, 7 + bytes[s] + (bytes[s + 3] >> 2));
                data[d + 1] = Math.min(255, 11 + bytes[s + 1] + (bytes[s + 3] >> 1));
                data[d + 2] = Math.min(255, 22 + bytes[s + 2] + bytes[s + 3]);
                data[d + 3] = 255;
            }
        }
        this.offCtx.putImageData(this.imgData, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(this.off, 0, 0, w, h);

        // 2. Additive tracer streak subset
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = 'rgba(145, 220, 255, 0.5)';
        const tracerDraw = Math.min(550, config.TRACER_COUNT);
        for (let i = 0; i < tracerDraw; i++) {
            ctx.fillRect(sim.tx[i] * w, (1 - sim.ty[i]) * h, 1.5, 1.5);
        }
        ctx.restore();

        // 3. Projected 2D obsidian Turing core with live Gray-Scott + Wave PDE
        const minDim = Math.min(w, h);
        const R = minDim * sim.coreScreenRadiusFrac;
        const cx = w * 0.5 - view.parallax.x * 8;
        const cy = h * 0.5 + view.parallax.y * 8;

        const aura = ctx.createRadialGradient(cx, cy, R * 0.5, cx, cy, R * 1.65);
        aura.addColorStop(0, sim.wSpotify > 0.3 ? 'rgba(32, 224, 176, 0.18)' : 'rgba(89, 215, 255, 0.18)');
        aura.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = aura;
        ctx.fillRect(0, 0, w, h);

        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, TAU);
        ctx.clip();
        ctx.fillStyle = '#060a16';
        ctx.fillRect(cx - R, cy - R, R * 2, R * 2);

        const step = 4;
        const a = -sim.time * config.CORE_SPIN_RAD_S;
        const cosA = Math.cos(a), sinA = Math.sin(a);
        for (let py = -R; py <= R; py += step) {
            for (let px = -R; px <= R; px += step) {
                const nx = px / R, ny = -py / R;
                const r2 = nx * nx + ny * ny;
                if (r2 > 1) continue;
                const nz = Math.sqrt(1 - r2);
                const rx = nx * cosA - nz * sinA;
                const rz = nx * sinA + nz * cosA;
                const u = ((Math.atan2(rz, rx) / TAU + 0.5) % 1 + 1) % 1;
                const v = Math.acos(clamp(ny, -1, 1)) / Math.PI;
                const gx = Math.min(sim.tw - 1, (u * sim.tw) | 0);
                const gy = Math.min(sim.th - 1, (v * sim.th) | 0);
                const idx = gy * sim.tw + gx;
                const morph = sim.gsV[idx];
                const wave = Math.abs(sim.waveH[idx]);
                const fres = Math.pow(1 - nz, 2.2);
                const inten = morph * 1.35 + wave * 0.55 + fres * 0.5;
                if (inten > 0.18) {
                    const hue = (195 + morph * 120 + fres * 75 + sim.wSpotify * 45) % 360;
                    ctx.fillStyle = `hsla(${hue}, 82%, ${Math.min(72, 26 + inten * 28)}%, ${Math.min(0.82, inten * 0.6)})`;
                    ctx.fillRect(cx + px, cy + py, step + 0.5, step + 0.5);
                }
            }
        }
        ctx.restore();

        ctx.strokeStyle = 'rgba(110, 200, 255, 0.45)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, TAU);
        ctx.stroke();
    }
}
