// renderer.js
// WebGL2 geodesic ray-tracing Black Hole renderer + quarter-res separable HDR
// bloom + compacted active particle draw + Canvas 2D fallback driven from
// the same BlackHoleSimulation state.

import { config } from './config.js';

export const SHADERS = {
    FS_VS: `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID & 1) << 2, (gl_VertexID & 2) << 1) - 1.0;
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`,

    BH_FS: `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform vec2 uRes;
uniform float uTime;
uniform vec3 uWeights;   // x=M87*, y=Gargantua, z=Cygnus X-1
uniform vec4 uBhParams;  // x=rIn, y=rOut, z=kerrSpin, w=omegaBase
uniform vec3 uRingTint;
uniform vec3 uNebTint;
uniform float uAbsorb;
uniform vec3 uCamPos;
uniform vec3 uCamU;
uniform vec3 uCamV;
uniform vec3 uCamW;
uniform float uFov;
uniform vec3 uBhT1;
uniform vec3 uBhN;
uniform vec3 uBhT2;
uniform float uMarchSteps;

vec3 toBhLocal(vec3 p) {
  return vec3(dot(p, uBhT1), dot(p, uBhN), dot(p, uBhT2));
}

vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm2(vec2 p) {
  float v = 0.5 * noise2(p);
  mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
  return v + 0.25 * noise2(rot * p * 2.03 + vec2(11.7, 6.3));
}

float fbm3(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
  for (int i = 0; i < 3; i++) {
    v += a * noise2(p);
    p = rot * p * 2.03 + vec2(11.7, 6.3);
    a *= 0.5;
  }
  return v;
}

vec3 blackbodyGargantua(float temp) {
  float x = clamp(temp, 0.0, 1.4);
  vec3 ember = vec3(0.75, 0.20, 0.04);
  vec3 gold  = vec3(1.00, 0.68, 0.26);
  vec3 ivory = vec3(1.00, 0.94, 0.84);
  vec3 hot   = vec3(0.88, 0.94, 1.00);
  vec3 c = mix(ember, gold, smoothstep(0.05, 0.48, x));
  c = mix(c, ivory, smoothstep(0.45, 0.92, x));
  return mix(c, hot, smoothstep(0.92, 1.38, x));
}

vec3 plasmaCygnus(float temp) {
  float x = clamp(temp, 0.0, 1.4);
  vec3 indigo = vec3(0.24, 0.16, 0.68);
  vec3 sapph  = vec3(0.22, 0.58, 1.00);
  vec3 cyan   = vec3(0.56, 0.94, 1.00);
  vec3 hot    = vec3(0.92, 0.98, 1.00);
  vec3 c = mix(indigo, sapph, smoothstep(0.05, 0.45, x));
  c = mix(c, cyan, smoothstep(0.42, 0.88, x));
  return mix(c, hot, smoothstep(0.88, 1.38, x));
}

vec3 plasmaM87(float temp) {
  float x = clamp(temp, 0.0, 1.4);
  vec3 crim  = vec3(0.56, 0.11, 0.03);
  vec3 amber = vec3(0.98, 0.45, 0.12);
  vec3 gold  = vec3(1.00, 0.82, 0.44);
  vec3 pearl = vec3(1.00, 0.95, 0.88);
  vec3 c = mix(crim, amber, smoothstep(0.06, 0.48, x));
  c = mix(c, gold, smoothstep(0.45, 0.92, x));
  return mix(c, pearl, smoothstep(0.92, 1.38, x));
}

vec2 starGridCol(vec3 dir, float scale, float thresh) {
  vec3 p = dir * scale;
  vec3 id = floor(p);
  vec3 f = fract(p) - 0.5;
  vec3 r = hash33(id);
  if (r.x <= thresh) return vec2(0.0, r.y);
  vec3 d = f - (r - 0.5) * 0.44;
  return vec2(exp(-dot(d, d) * 52.0) * smoothstep(thresh, 1.0, r.x), r.y);
}

vec3 sampleLensedSky(vec3 dir) {
  vec2 s1 = starGridCol(dir, 58.0, 0.945);
  float s2 = starGridCol(dir, 118.0, 0.962).x;
  vec3 tint1 = mix(vec3(0.66, 0.82, 1.0), vec3(1.0, 0.88, 0.72), s1.y);

  vec2 bandCoord = vec2(dir.x + dir.z * 0.7, dir.y * 2.2 - dir.x * 0.35);
  float neb = fbm2(bandCoord * 2.4 + vec2(3.1, -1.7));
  float neb2 = noise2(bandCoord * 4.1 - vec2(1.4, 2.8));
  float band = exp(-pow(dir.y * 1.4 - dir.x * 0.45 + (neb - 0.5) * 0.4, 2.0) * 3.2);

  vec3 base = vec3(0.009, 0.013, 0.028);
  base += uNebTint * (neb * neb2 * band * 0.30);
  base += tint1 * s1.x * 1.15 + vec3(0.82, 0.90, 1.0) * s2 * 0.52;
  return base;
}

vec4 evalDisk(vec3 locP, vec3 locRayDir, vec3 w, float absorb) {
  float rad = length(locP.xz);
  float rIn = uBhParams.x;
  float rOut = uBhParams.y;
  if (rad < rIn || rad > rOut) return vec4(0.0);

  // Differential Keplerian shear locked to orbital velocity (-locP.z, 0, locP.x)
  float omega = uBhParams.w / (rad * sqrt(rad));
  float rotAng = -uTime * omega * 0.42;
  float ca = cos(rotAng), sa = sin(rotAng);
  vec2 rXZ = vec2(locP.x * ca - locP.z * sa, locP.x * sa + locP.z * ca);

  float n1 = fbm3(rXZ * 0.68 + vec2(sin(rad * 1.4), cos(rad * 1.4)) * 0.45);
  float n2 = fbm2(rXZ * 1.45 - vec2(0.0, uTime * 0.05));
  float armAngle = atan(rXZ.y, rXZ.x);
  float rings = 0.55 + 0.45 * sin(rad * 4.8 - n1 * 4.2 + armAngle * (2.0 + w.x));
  float streaks = smoothstep(0.18, 0.85, n1 * 0.72 + n2 * 0.45);
  float structure = streaks * (0.45 + 0.55 * rings);

  float innerFade = smoothstep(rIn, rIn + 0.72, rad);
  float outerFade = 1.0 - smoothstep(rOut * 0.46, rOut, rad);
  float iscoBoost = exp(-(rad - rIn) * 0.65);

  vec3 vOrb = normalize(vec3(-locP.z, 0.0, locP.x));
  float beta = clamp(sqrt((w.z * 0.60 + (1.0 - w.z) * 0.50) / max(1.15, rad)), 0.08, 0.58);
  float mu = dot(vOrb, -normalize(locRayDir));
  float doppler = sqrt(1.0 - beta * beta) / max(0.30, 1.0 - beta * mu);
  float gravShift = sqrt(max(0.20, 1.0 - 1.0 / rad));
  float gTot = doppler * gravShift;

  float beamExp = w.x * 2.55 + (1.0 - w.x) * 1.85;
  float beamMin = w.x * 0.24 + (1.0 - w.x) * 0.36;
  float beamMax = w.x * 2.95 + (1.0 - w.x) * 2.65;
  float beam = clamp(pow(gTot, beamExp), beamMin, beamMax);
  float temp = (0.38 + 0.56 * iscoBoost + streaks * 0.24) * clamp(gTot, 0.52, 1.38) + absorb * iscoBoost * 0.28;

  vec3 dCol = plasmaM87(temp) * w.x
            + blackbodyGargantua(temp) * w.y
            + plasmaCygnus(temp) * w.z;

  float density = innerFade * outerFade * (0.46 + 0.54 * structure);
  float intensity = density * beam * (1.28 + iscoBoost * 1.15 + absorb * iscoBoost * 0.50);
  float alpha = clamp(density * (0.60 + 0.40 * outerFade), 0.0, 0.94);
  return vec4(dCol * intensity, alpha);
}

void main() {
  float minDim = max(1.0, min(uRes.x, uRes.y));
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / minDim;

  vec3 pos = uCamPos;
  vec3 vel = normalize(uv.x * uCamU + uv.y * uCamV + uFov * uCamW);
  float rs = 1.0;

  // Impact parameter & exact Schwarzschild integral match across bounding sphere
  float bDot = dot(pos, vel);
  vec3 closest = pos - bDot * vel;
  float b2 = dot(closest, closest);
  float bLen = sqrt(b2);
  float cosStart = clamp(-bDot * inversesqrt(dot(pos, pos)), 0.0, 1.0);

  // Outer-sky fast path: rays well outside disk/jets skip the raymarch loop
  if (bLen > 11.5) {
    float s0 = -cosStart;
    float f0 = 1.5 * s0 - 0.5 * s0 * s0 * s0;
    float defl = (rs / bLen) * (1.0 - f0) + (2.945 / b2) * 0.5 * (1.0 + cosStart);
    vec3 dirOut = normalize(vel - (closest / bLen) * defl);
    vec3 sky = sampleLensedSky(dirOut);
    float luma = dot(sky, vec3(0.2126, 0.7152, 0.0722));
    fragColor = vec4(sky / (1.0 + luma * 0.42), 1.0);
    return;
  }

  // Analytic jump to entry shell rJump = 12.2 (rJump^2 = 148.84) with matching bend
  float zJump = sqrt(max(0.0, 148.84 - b2));
  float tStart = max(0.0, -bDot - zJump);
  if (tStart > 0.0) {
    pos += vel * tStart;
    float bSafe = max(2.0, bLen);
    float s0 = -cosStart;
    float sj = -zJump / 12.2;
    float dEntry = (rs / bSafe) * ((1.5 * sj - 0.5 * sj * sj * sj) - (1.5 * s0 - 0.5 * s0 * s0 * s0));
    vel = normalize(vel - (closest / bSafe) * dEntry);
  }

  vec3 hVec = cross(pos, vel);
  float h2 = dot(hVec, hVec);
  float kerrSpin = uBhParams.z;

  vec3 accum = vec3(0.0);
  float trans = 1.0;
  bool captured = false;
  float minR = 1e4;
  int maxSteps = int(uMarchSteps);

  for (int i = 0; i < 72; i++) {
    if (i >= maxSteps) break;
    float r2 = dot(pos, pos);
    float invR = inversesqrt(r2);
    float r = r2 * invR;
    minR = min(minR, r);

    if (r < rs * 1.005) {
      captured = true;
      break;
    }
    if (r > 13.5 && dot(pos, vel) > 0.0) {
      float vDot = dot(pos, vel);
      float cosE = clamp(vDot * invR, 0.0, 1.0);
      vec3 cE = pos - vDot * vel;
      float cEL = max(2.0, length(cE));
      float dExit = (rs / cEL) * (1.0 - (1.5 * cosE - 0.5 * cosE * cosE * cosE));
      vel = normalize(vel - (cE / cEL) * dExit);
      break;
    }

    float hPrev = dot(pos, uBhN);
    float dt = clamp((r - rs * 0.96) * 0.10, 0.026, 0.95);
    float invR2 = invR * invR;
    float invR5 = invR2 * invR2 * invR;
    vec3 acc = (-1.5 * rs * h2 * invR5) * pos;
    if (kerrSpin > 0.0) {
      acc += cross(uBhN * (kerrSpin * invR2 * invR), vel);
    }

    vec3 prevPos = pos;
    vel += acc * dt;
    vel *= inversesqrt(dot(vel, vel));
    pos += vel * dt;
    float hCurr = dot(pos, uBhN);

    if ((hPrev > 0.0 && hCurr <= 0.0) || (hPrev < 0.0 && hCurr >= 0.0)) {
      float frac = clamp(abs(hPrev) / max(1e-5, abs(hPrev - hCurr)), 0.0, 1.0);
      vec3 hitP = mix(prevPos, pos, frac);
      vec4 disk = evalDisk(toBhLocal(hitP), toBhLocal(vel), uWeights, uAbsorb);
      if (disk.a > 0.002) {
        accum += disk.rgb * trans * disk.a;
        trans *= (1.0 - disk.a * 0.86);
        if (trans < 0.02) break;
      }
    }

    if (uWeights.z > 0.01) {
      vec3 locJ = toBhLocal(pos);
      float yAbs = abs(locJ.y);
      if (yAbs > 1.35 && yAbs < 12.0) {
        float rAx = length(locJ.xz);
        float cone = 0.16 + 0.16 * yAbs;
        if (rAx < cone) {
          float qAx = rAx / cone;
          float jetCore = exp(-qAx * qAx * 4.5) * 0.72 + exp(-qAx * qAx * 1.8) * 0.28;
          float pulse = 0.74 + 0.26 * sin(yAbs * 1.9 - uTime * 2.6);
          float jFade = smoothstep(1.35, 2.8, yAbs) * exp(-(yAbs - 1.35) * 0.18);
          vec3 jCol = mix(vec3(0.42, 0.36, 1.0), vec3(0.62, 0.96, 1.0), jetCore);
          accum += jCol * jetCore * pulse * jFade * (0.15 + uAbsorb * 0.11) * uWeights.z * dt * trans;
        }
      }
    }
  }

  float photonRing = exp(-abs(minR - 1.52 * rs) * 6.0);
  if (!captured) {
    accum += sampleLensedSky(vel) * trans;
    accum += uRingTint * photonRing * (0.46 + uAbsorb * 0.55);
  } else {
    accum += uRingTint * pow(photonRing, 2.2) * (0.16 + uAbsorb * 0.30) * trans;
  }

  float luma = dot(accum, vec3(0.2126, 0.7152, 0.0722));
  vec3 hdr = accum / (1.0 + luma * 0.42);
  fragColor = vec4(hdr, 1.0);
}`,

    PART_VS: `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec4 aColor;
out vec4 vColor;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
  vColor = aColor;
}`,

    PART_FS: `#version 300 es
precision highp float;
in vec4 vColor;
out vec4 fragColor;
void main() {
  fragColor = vec4(vColor.rgb * vColor.a, vColor.a);
}`,

    PART_HEAD_VS: `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec4 aColor;
layout(location = 2) in float aSize;
uniform float uDpr;
out vec4 vColor;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
  gl_PointSize = clamp((aSize * 1.4 + 2.2) * uDpr, 3.0, 22.0);
  vColor = aColor;
}`,

    PART_HEAD_FS: `#version 300 es
precision highp float;
in vec4 vColor;
out vec4 fragColor;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  float fade = smoothstep(1.0, 0.65, r2);
  float airy = exp(-r2 * 10.5) * 1.15 + exp(-r2 * 3.4) * 0.34;
  float a = vColor.a * airy * fade;
  fragColor = vec4(vColor.rgb * a, a);
}`,

    BRIGHT_FS: `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uScene;
void main() {
  vec3 c = texture(uScene, vUv).rgb;
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float w = smoothstep(0.34, 0.90, luma);
  fragColor = vec4(c * w, 1.0);
}`,

    BLUR_FS: `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTex;
uniform vec2 uStep;
void main() {
  vec3 sum = texture(uTex, vUv).rgb * 0.227027;
  sum += texture(uTex, vUv + uStep * 1.3846).rgb * 0.316216;
  sum += texture(uTex, vUv - uStep * 1.3846).rgb * 0.316216;
  sum += texture(uTex, vUv + uStep * 3.2307).rgb * 0.070270;
  sum += texture(uTex, vUv - uStep * 3.2307).rgb * 0.070270;
  fragColor = vec4(sum, 1.0);
}`,

    COMP_FS: `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomStrength;

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec3 col = texture(uScene, vUv).rgb + texture(uBloom, vUv).rgb * uBloomStrength;
  vec2 d = vUv - 0.5;
  col *= 1.0 - dot(d, d) * 0.30;
  col = pow(aces(col * 1.14), vec3(1.0 / 1.04));
  float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  col += (ign - 0.5) / 255.0;
  fragColor = vec4(col, 1.0);
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

function createTexture(gl, w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return tex;
}

function createFBO(gl, w, h) {
    const tex = createTexture(gl, w, h);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) return null;
    return { fbo, tex, w, h };
}

function resizeFBO(gl, target, w, h) {
    if (!target || (target.w === w && target.h === h)) return;
    target.w = w;
    target.h = h;
    gl.bindTexture(gl.TEXTURE_2D, target.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
}

export class WebGL2Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = null;
        this.ready = false;
        this.sceneFBO = null;
        this.bloomA = null;
        this.bloomB = null;
        this.quadVao = null;
        this.lineVao = null;
        this.lineVbo = null;
        this.headVao = null;
        this.headVbo = null;
        this.bhProg = null;
        this.partProg = null;
        this.partHeadProg = null;
        this.brightProg = null;
        this.blurProg = null;
        this.compProg = null;
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

        this.bhProg = createProgram(gl, SHADERS.FS_VS, SHADERS.BH_FS);
        this.partProg = createProgram(gl, SHADERS.PART_VS, SHADERS.PART_FS);
        this.partHeadProg = createProgram(gl, SHADERS.PART_HEAD_VS, SHADERS.PART_HEAD_FS);
        this.brightProg = createProgram(gl, SHADERS.FS_VS, SHADERS.BRIGHT_FS);
        this.blurProg = createProgram(gl, SHADERS.FS_VS, SHADERS.BLUR_FS);
        this.compProg = createProgram(gl, SHADERS.FS_VS, SHADERS.COMP_FS);

        if (!this.bhProg || !this.partProg || !this.partHeadProg
            || !this.brightProg || !this.blurProg || !this.compProg) {
            return false;
        }

        this.quadVao = gl.createVertexArray();
        const sw = Math.max(2, this.canvas.width || 2);
        const sh = Math.max(2, this.canvas.height || 2);
        const bw = Math.max(2, sw >> 2);
        const bh = Math.max(2, sh >> 2);
        this.sceneFBO = createFBO(gl, sw, sh);
        this.bloomA = createFBO(gl, bw, bh);
        this.bloomB = createFBO(gl, bw, bh);
        if (!this.sceneFBO || !this.bloomA || !this.bloomB) return false;

        this.lineVao = gl.createVertexArray();
        this.lineVbo = gl.createBuffer();
        gl.bindVertexArray(this.lineVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVbo);
        gl.bufferData(gl.ARRAY_BUFFER, sim.pLineBuf.byteLength, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, 0);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 8);

        this.headVao = gl.createVertexArray();
        this.headVbo = gl.createBuffer();
        gl.bindVertexArray(this.headVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.headVbo);
        gl.bufferData(gl.ARRAY_BUFFER, sim.pHeadBuf.byteLength, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 28, 0);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 8);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 28, 24);

        gl.bindVertexArray(null);
        this.ready = true;
        return true;
    }

    render(sim, view, quality) {
        const gl = this.gl;
        if (!this.ready || !gl || gl.isContextLost()) return;

        const cw = Math.max(2, this.canvas.width);
        const ch = Math.max(2, this.canvas.height);
        const qW = Math.max(2, cw >> 2);
        const qH = Math.max(2, ch >> 2);
        resizeFBO(gl, this.sceneFBO, cw, ch);
        resizeFBO(gl, this.bloomA, qW, qH);
        resizeFBO(gl, this.bloomB, qW, qH);

        // 1. Render relativistic black hole + outer-sky fast path into sceneFBO
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFBO.fbo);
        gl.viewport(0, 0, cw, ch);
        gl.disable(gl.BLEND);

        const wM87 = sim.wM87, wGarg = sim.wGarg, wCyg = sim.wCyg;
        const rIn = wM87 * 2.12 + wGarg * 2.20 + wCyg * 1.82;
        const rOut = wM87 * 8.40 + wGarg * 8.20 + wCyg * 7.60;
        const kerrSpin = wM87 * 0.08 + wGarg * 0.04 + wCyg * 0.22;
        const omegaBase = wCyg * 2.05 + (1 - wCyg) * 1.55;

        const b = this.bhProg;
        const cam = sim.cam;
        gl.useProgram(b.program);
        gl.uniform2f(b.u.uRes, cw, ch);
        gl.uniform1f(b.u.uTime, sim.time);
        gl.uniform3f(b.u.uWeights, wM87, wGarg, wCyg);
        gl.uniform4f(b.u.uBhParams, rIn, rOut, kerrSpin, omegaBase);
        gl.uniform3f(b.u.uRingTint,
            1.00 * wM87 + 1.00 * wGarg + 0.45 * wCyg,
            0.62 * wM87 + 0.82 * wGarg + 0.86 * wCyg,
            0.22 * wM87 + 0.52 * wGarg + 1.00 * wCyg);
        gl.uniform3f(b.u.uNebTint,
            0.16 * wM87 + 0.10 * wGarg + 0.11 * wCyg,
            0.14 * wM87 + 0.16 * wGarg + 0.25 * wCyg,
            0.30 * wM87 + 0.34 * wGarg + 0.58 * wCyg);
        gl.uniform1f(b.u.uAbsorb, sim.absorbGlow);
        gl.uniform3f(b.u.uCamPos, cam.ro[0], cam.ro[1], cam.ro[2]);
        gl.uniform3f(b.u.uCamU, cam.uu[0], cam.uu[1], cam.uu[2]);
        gl.uniform3f(b.u.uCamV, cam.vv[0], cam.vv[1], cam.vv[2]);
        gl.uniform3f(b.u.uCamW, cam.ww[0], cam.ww[1], cam.ww[2]);
        gl.uniform1f(b.u.uFov, cam.fov);
        gl.uniform3f(b.u.uBhT1, sim.bhT1[0], sim.bhT1[1], sim.bhT1[2]);
        gl.uniform3f(b.u.uBhN, sim.bhN[0], sim.bhN[1], sim.bhN[2]);
        gl.uniform3f(b.u.uBhT2, sim.bhT2[0], sim.bhT2[1], sim.bhT2[2]);
        gl.uniform1f(b.u.uMarchSteps, quality.marchSteps || config.BH_MARCH_STEPS);

        gl.bindVertexArray(this.quadVao);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        // Compacted active-only particle GPU upload & draw
        const drawCount = sim.drawCount;
        if (drawCount > 0) {
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.ONE, gl.ONE);

            gl.useProgram(this.partProg.program);
            gl.bindVertexArray(this.lineVao);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVbo);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, sim.pLineBuf, 0, drawCount * 12);
            gl.drawArrays(gl.LINES, 0, drawCount * 2);

            const dpr = view.dpr || (this.canvas.clientWidth ? cw / this.canvas.clientWidth : 1);
            gl.useProgram(this.partHeadProg.program);
            gl.uniform1f(this.partHeadProg.u.uDpr, dpr);
            gl.bindVertexArray(this.headVao);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.headVbo);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, sim.pHeadBuf, 0, drawCount * 7);
            gl.drawArrays(gl.POINTS, 0, drawCount);
        }

        // 2. Quarter-res separable HDR Bloom (single 9-tap H+V Gaussian pass)
        gl.disable(gl.BLEND);
        gl.bindVertexArray(this.quadVao);
        if (quality.bloom) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomA.fbo);
            gl.viewport(0, 0, qW, qH);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.sceneFBO.tex);
            gl.useProgram(this.brightProg.program);
            gl.uniform1i(this.brightProg.u.uScene, 0);
            gl.drawArrays(gl.TRIANGLES, 0, 3);

            gl.useProgram(this.blurProg.program);
            gl.uniform1i(this.blurProg.u.uTex, 0);

            gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomB.fbo);
            gl.bindTexture(gl.TEXTURE_2D, this.bloomA.tex);
            gl.uniform2f(this.blurProg.u.uStep, 1.45 / qW, 0);
            gl.drawArrays(gl.TRIANGLES, 0, 3);

            gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomA.fbo);
            gl.bindTexture(gl.TEXTURE_2D, this.bloomB.tex);
            gl.uniform2f(this.blurProg.u.uStep, 0, 1.45 / qH);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
        }

        // 3. Final composite to screen (ACES + vignette + IGN dithering)
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, cw, ch);
        gl.useProgram(this.compProg.program);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.sceneFBO.tex);
        gl.uniform1i(this.compProg.u.uScene, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.bloomA.tex);
        gl.uniform1i(this.compProg.u.uBloom, 1);
        gl.uniform1f(this.compProg.u.uBloomStrength, quality.bloom ? 0.56 : 0.0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindVertexArray(null);
    }
}

export class Canvas2DRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
    }

    render(sim, view) {
        const ctx = this.ctx;
        if (!ctx) return;
        const w = view.w, h = view.h;

        ctx.fillStyle = '#03050a';
        ctx.fillRect(0, 0, w, h);

        const cx = w * 0.5 + view.parallax.x * 10;
        const cy = h * 0.5 - view.parallax.y * 8;
        const minDim = Math.min(w, h);
        const rShadow = minDim * 0.19;

        const rCol = Math.round(250 * (sim.wM87 + sim.wGarg) + 75 * sim.wCyg);
        const gCol = Math.round(140 * sim.wM87 + 195 * sim.wGarg + 210 * sim.wCyg);
        const bCol = Math.round(48 * sim.wM87 + 96 * sim.wGarg + 255 * sim.wCyg);

        const halo = ctx.createRadialGradient(cx, cy, rShadow * 0.85, cx, cy, rShadow * 2.8);
        halo.addColorStop(0, 'rgba(0, 0, 0, 1)');
        halo.addColorStop(0.28, `rgba(${rCol}, ${gCol}, ${bCol}, ${(0.72 + sim.absorbGlow * 0.2).toFixed(2)})`);
        halo.addColorStop(0.65, `rgba(${rCol}, ${gCol}, ${bCol}, 0.14)`);
        halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = halo;
        ctx.fillRect(0, 0, w, h);

        ctx.fillStyle = '#020307';
        ctx.beginPath();
        ctx.arc(cx, cy, rShadow, 0, Math.PI * 2);
        ctx.fill();

        const drawCount = sim.drawCount;
        if (drawCount <= 0) return;

        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineWidth = 1.15;
        const lBuf = sim.pLineBuf;
        const hBuf = sim.pHeadBuf;
        for (let i = 0; i < drawCount; i++) {
            const ho = i * 7;
            const alpha = hBuf[ho + 5];
            const lo = i * 12;
            const x0 = (lBuf[lo] * 0.5 + 0.5) * w;
            const y0 = (0.5 - lBuf[lo + 1] * 0.5) * h;
            const x1 = (hBuf[ho] * 0.5 + 0.5) * w;
            const y1 = (0.5 - hBuf[ho + 1] * 0.5) * h;
            const rgb = `rgba(${(hBuf[ho + 2] * 255) | 0},${(hBuf[ho + 3] * 255) | 0},${(hBuf[ho + 4] * 255) | 0},`;

            ctx.strokeStyle = `${rgb}${(alpha * 0.65).toFixed(2)})`;
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            ctx.stroke();

            ctx.fillStyle = `${rgb}${alpha.toFixed(2)})`;
            ctx.beginPath();
            ctx.arc(x1, y1, Math.max(0.8, hBuf[ho + 6] * 0.35), 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }
}
