// renderer.js
// WebGL2 geodesic ray-tracing Black Hole renderer (half-float HDR scene at a
// dynamic render scale, flow-noise accretion disk, stateless GPU dust,
// mip-chain bloom, filmic composite) + Canvas 2D fallback driven from the
// same BlackHoleSimulation state.

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
uniform float uSoftClip;  // 0.42 on 8-bit targets (range compression), 0 on half-float
uniform vec2 uCenter;
uniform vec3 uLook;       // x=disk gain, y=haze gain, z=rich sky

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

float fbm4(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
  for (int i = 0; i < 4; i++) {
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
  float twinkle = 0.80 + 0.20 * sin(uTime * (0.6 + r.z * 2.4) + r.y * 40.0);
  return vec2(exp(-dot(d, d) * 110.0) * smoothstep(thresh, 1.0, r.x) * twinkle, r.y);
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
  base += tint1 * s1.x * 1.50 + vec3(0.82, 0.90, 1.0) * s2 * 0.60;

  if (uLook.z > 0.0) {
    // Galactic band around the plane with normal g, brightest toward e1.
    // Noise runs on a linear projection of the direction, so it has no seam.
    const vec3 g = vec3(0.3306, 0.9418, 0.0601);
    const vec3 e1 = vec3(-0.4460, 0.2121, -0.8696);
    const vec3 e2 = vec3(-0.8317, 0.2607, 0.4901);
    float lat = dot(dir, g);
    vec2 p = vec2(dot(dir, e1), dot(dir, e2)) * 2.6 + lat * vec2(1.9, -2.3);
    float warp = fbm4(p * 1.3 + 4.0);
    float clouds = fbm4(p * 2.2 + warp * 1.4);
    float lanes = fbm4(p * 4.6 - warp * 2.0 + 9.0);
    float glowBand = exp(-lat * lat * 9.0);
    float ridge = exp(-lat * lat * 55.0);
    float bulge = exp(-(1.0 - dot(dir, e1)) * 3.0);
    float dens = glowBand * (0.10 + 1.5 * clouds * clouds * clouds) + ridge * (0.30 + 1.2 * bulge);
    dens *= 1.0 - 0.60 * smoothstep(0.40, 0.66, lanes) * exp(-lat * lat * 26.0);
    vec3 glow = mix(vec3(0.14, 0.22, 0.52), vec3(1.00, 0.70, 0.42), bulge * (0.4 + 0.6 * ridge));
    base += glow * dens * 0.24;
    base += vec3(0.60, 0.13, 0.24) * smoothstep(0.42, 0.72, clouds * glowBand + warp * 0.22) * 0.26;
    vec2 s3 = starGridCol(dir, 205.0, 0.90 - 0.30 * glowBand);
    base += mix(vec3(0.75, 0.86, 1.0), vec3(1.0, 0.90, 0.76), s3.y) * s3.x * 0.85;
  }
  return base;
}

// One flow layer: the disk plane wound up by 'wind' seconds of differential
// Keplerian rotation, which shears isotropic noise into orbital streaks.
float diskLayer(vec2 p, float omega, float wind, vec2 seed) {
  float a = -omega * wind;
  float c = cos(a), s = sin(a);
  return fbm4(vec2(p.x * c - p.y * s, p.x * s + p.y * c) * 0.80 + seed);
}

vec4 evalDisk(vec3 locP, vec3 locRayDir, vec3 w, float absorb) {
  float rad = length(locP.xz);
  float rIn = uBhParams.x;
  float rOut = uBhParams.y;
  if (rad < rIn || rad > rOut) return vec4(0.0);

  // Differential rotation would wind the pattern ever tighter, so two layers
  // run half a cycle apart and cross-fade (flow-map style): each restarts,
  // reseeded, while its weight is zero.
  float omega = 0.42 * uBhParams.w / (rad * sqrt(rad));
  float cyc = uTime / 26.0;
  float f0 = fract(cyc), f1 = fract(cyc + 0.5);
  float w1 = abs(2.0 * f0 - 1.0);
  float n0 = diskLayer(locP.xz, omega, 10.0 + f0 * 26.0, floor(cyc) * vec2(7.1, 3.3));
  float n1 = diskLayer(locP.xz, omega, 10.0 + f1 * 26.0, floor(cyc + 0.5) * vec2(4.7, 9.2) + 17.3);
  // Averaging two uncorrelated layers flattens contrast; restore it.
  float n = 0.47 + (mix(n0, n1, w1) - 0.47) * inversesqrt(w1 * w1 + (1.0 - w1) * (1.0 - w1));

  float streaks = smoothstep(0.26, 0.72, n);
  float fil = 1.0 - min(1.0, abs(n - 0.50) * 6.0);
  float gaps = 0.92 + 0.08 * sin(rad * 5.0 + n * 7.0);
  float structure = (0.16 + 0.84 * streaks + 0.26 * fil * fil) * gaps;

  float innerFade = smoothstep(rIn, rIn + 0.55, rad);
  float outerFade = 1.0 - smoothstep(rOut * 0.42, rOut, rad);
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
  float temp = (0.30 + 0.66 * iscoBoost + streaks * 0.22) * clamp(gTot, 0.52, 1.38) + absorb * iscoBoost * 0.28;

  vec3 dCol = plasmaM87(temp) * w.x
            + blackbodyGargantua(temp) * w.y
            + plasmaCygnus(temp) * w.z;

  float density = innerFade * outerFade * structure;
  float intensity = density * beam * (0.55 + iscoBoost * 1.75 + absorb * iscoBoost * 0.60);
  float alpha = clamp(innerFade * outerFade * (0.34 + 0.56 * streaks), 0.0, 0.94);
  return vec4(dCol * intensity, alpha);
}

void main() {
  float minDim = max(1.0, min(uRes.x, uRes.y));
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / minDim - uCenter;

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
    fragColor = vec4(sky / (1.0 + luma * uSoftClip), 1.0);
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

    // Nothing that crosses the photon sphere (1.5 rs) inward comes back, so
    // the ray is settled there; marching on to the horizon would spend the
    // step budget where steps are smallest.
    if (r < rs * 1.48) {
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
        accum += disk.rgb * (trans * disk.a * uLook.x);
        trans *= (1.0 - disk.a * 0.86);
        if (trans < 0.02) break;
      }
    }

    // Thin glowing gas layer hugging the disk plane: gives the disk volume
    // when seen edge-on at the cost of a few multiplies per step.
    if (r < uBhParams.y) {
      float hz = max(0.0, 1.0 - abs(hCurr) * 1.5);
      accum += uRingTint * (hz * hz * invR2 * smoothstep(uBhParams.x - 0.2, uBhParams.x + 0.7, r) * 0.42 * uLook.y * dt * trans);
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
  }

  float luma = dot(accum, vec3(0.2126, 0.7152, 0.0722));
  vec3 hdr = accum / (1.0 + luma * uSoftClip);
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

    // Stateless GPU dust: every grain's spiral-in orbit is a closed-form
    // function of its vertex id and time, so tens of thousands of grains cost
    // no CPU and no buffers. Projection and point-mass lensing mirror
    // BlackHoleSimulation.stepParticles.
    DUST_VS: `#version 300 es
precision highp float;
uniform float uTime;
uniform vec4 uBhParams;  // x=rIn, y=rOut, w=omegaBase
uniform float uCyg;
uniform vec3 uCamPos;
uniform vec3 uCamU;
uniform vec3 uCamV;
uniform vec3 uCamW;
uniform float uFov;
uniform float uCamDist;
uniform vec3 uBhT1;
uniform vec3 uBhN;
uniform vec3 uBhT2;
uniform vec2 uNdcScale;
uniform vec2 uCenter;
uniform float uPx;
uniform vec3 uDust;     // x=gain, y=spiral arms, z=size
out vec4 vColor;

float rnd(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return float(((w >> 22u) ^ w) >> 8u) * (1.0 / 16777216.0);
}

void main() {
  uint id = uint(gl_VertexID) * 5u;
  float life = mix(45.0, 110.0, rnd(id));
  float f = fract(uTime / life + rnd(id + 1u));

  // u = r^1.5 shrinks linearly over the grain's life, which makes the
  // accumulated Keplerian angle (omega = k / u) integrate to a logarithm.
  float u0 = pow(uBhParams.y * mix(0.50, 1.10, rnd(id + 2u)), 1.5);
  float u1 = pow(uBhParams.x, 1.5);
  float u = mix(u0, u1, f);
  float r = pow(u, 2.0 / 3.0);
  float phi0 = rnd(id + 3u) * 6.2831853;
  float phi = phi0
            + 0.9 * uBhParams.w * life / (u0 - u1) * log(u0 / u);

  float hRnd = rnd(id + 4u);
  float h = (hRnd - 0.5) * (0.10 + 0.07 * r);
  vec3 radial = uBhT1 * cos(phi) + uBhT2 * sin(phi);
  vec3 p = radial * r + uBhN * h;

  vec3 dv = p - uCamPos;
  float zc = dot(dv, uCamW);
  vec2 a = vec2(dot(dv, uCamU), dot(dv, uCamV)) * (uFov / zc);
  float bW = length(a) * (uCamDist / uFov);
  float behind = clamp((zc - uCamDist) * 0.45, 0.0, 1.0);
  // Matter level with the hole already looks magnified (apparent radius
  // r / sqrt(1 - rs/r)); without this the grains would sit inside the
  // raymarched disk's inner edge. It fades out for grains nearer the camera.
  float lens = mix(inversesqrt(1.0 - 1.0 / r), 1.0, clamp((uCamDist - zc) / r, 0.0, 1.0));
  // Point-mass lens for grains behind the hole. The Einstein radius grows
  // with the depth behind it (rE^2 = 2 rs d), which is what lifts the far
  // side of an edge-on disk into the arc over the shadow.
  if (behind > 0.01 && bW > 0.08) {
    lens = max(lens, 0.5 * (bW + sqrt(bW * bW + 8.0 * (zc - uCamDist))) / bW);
  }
  float behindFade = clamp((zc - (uCamDist + 0.1)) * 1.25, 0.0, 1.0);
  float shadowMask = smoothstep(2.55, 3.0, bW * lens);
  float occ = 1.0 - behindFade * (1.0 - shadowMask);

  // Relativistic beaming: the approaching side of the orbit is brighter.
  vec3 vOrb = uBhT2 * cos(phi) - uBhT1 * sin(phi);
  float beta = clamp(sqrt(0.5 / r), 0.08, 0.58);
  float beam = 1.0 + beta * dot(vOrb, -normalize(dv));
  beam *= beam * beam;

  float heat = clamp(1.85 / max(1.05, r) - 0.14, 0.0, 1.0);
  vec3 warm = vec3(0.96 + heat * 0.04, 0.44 + heat * 0.52, 0.14 + heat * heat * 0.84);
  vec3 cyg = vec3(0.28 + heat * 0.72, 0.62 + heat * 0.36, 1.0);
  float size = (0.9 + 2.3 * hRnd * hRnd * hRnd) * uDust.z;
  float px = size * uPx;
  float fade = smoothstep(0.0, 0.06, f) * smoothstep(uBhParams.x, uBhParams.x + 0.9, r);
  float twinkle = 0.70 + 0.30 * sin(uTime * (0.8 + 2.0 * hRnd) + float(gl_VertexID));
  // Grains thinner than a pixel keep their energy by dimming instead.
  float arms = 0.5 + 0.5 * sin(phi0 * 3.0 + log(u0) * 4.5);
  float alpha = occ * fade * twinkle * beam * (0.10 + 0.34 * heat) * min(1.0, px * px)
              * uDust.x * mix(1.0, 0.12 + 1.5 * arms * arms, uDust.y);

  gl_Position = vec4((a * lens + uCenter) * uNdcScale, 0.0, 1.0);
  gl_PointSize = max(1.0, px * 2.4);
  vColor = vec4(mix(warm, cyg, uCyg), alpha);
}`,

    // Dual-filter bloom (downsample chain, then additive tent upsample).
    DOWN_FS: `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTex;
uniform vec2 uHalfPixel;
uniform float uFirst;     // 1 on the pass that reads the scene
uniform float uSoftClip;

void main() {
  vec3 c = texture(uTex, vUv).rgb * 4.0;
  c += texture(uTex, vUv - uHalfPixel).rgb;
  c += texture(uTex, vUv + uHalfPixel).rgb;
  c += texture(uTex, vUv + vec2(uHalfPixel.x, -uHalfPixel.y)).rgb;
  c += texture(uTex, vUv - vec2(uHalfPixel.x, -uHalfPixel.y)).rgb;
  c *= 0.125;
  if (uFirst > 0.5) {
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c /= max(0.2, 1.0 - l * uSoftClip);
    l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    // Soft threshold, then a ceiling so a single hot grain cannot flash.
    c = min(c * (max(0.0, l - 0.55) / max(l, 1e-4)), vec3(6.0));
  }
  fragColor = vec4(c, 1.0);
}`,

    UP_FS: `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTex;
uniform vec2 uHalfPixel;

void main() {
  vec2 h = uHalfPixel;
  vec3 c = texture(uTex, vUv + vec2(-h.x * 2.0, 0.0)).rgb;
  c += texture(uTex, vUv + vec2(h.x * 2.0, 0.0)).rgb;
  c += texture(uTex, vUv + vec2(0.0, h.y * 2.0)).rgb;
  c += texture(uTex, vUv + vec2(0.0, -h.y * 2.0)).rgb;
  c += texture(uTex, vUv + vec2(-h.x, h.y)).rgb * 2.0;
  c += texture(uTex, vUv + vec2(h.x, h.y)).rgb * 2.0;
  c += texture(uTex, vUv + vec2(h.x, -h.y)).rgb * 2.0;
  c += texture(uTex, vUv + vec2(-h.x, -h.y)).rgb * 2.0;
  fragColor = vec4(c / 12.0, 1.0);
}`,

    COMP_FS: `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform sampler2D uStreakTex;
uniform float uBloomStrength;
uniform float uSoftClip;
uniform vec3 uFilm;       // x=streak strength, y=streak texel step, z=grain
uniform float uTime;

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

vec3 scene(vec2 uv) {
  vec3 c = texture(uScene, uv).rgb;
  return c / max(0.2, 1.0 - dot(c, vec3(0.2126, 0.7152, 0.0722)) * uSoftClip);
}

void main() {
  vec2 d = vUv - 0.5;
  float r2 = dot(d, d);
  // Lens-like lateral chromatic aberration, zero at the centre.
  vec2 ca = d * r2 * 0.005;
  vec3 col = vec3(scene(vUv - ca).r, scene(vUv).g, scene(vUv + ca).b);
  col += texture(uBloom, vUv).rgb * uBloomStrength;
  if (uFilm.x > 0.0) {
    // Anamorphic streak: a wide horizontal smear of a coarse bloom level.
    vec3 s = vec3(0.0);
    for (int i = -6; i <= 6; i++) {
      s += texture(uStreakTex, vUv + vec2(float(i) * uFilm.y, 0.0)).rgb * (1.0 - abs(float(i)) / 7.0);
    }
    col += s * vec3(0.50, 0.72, 1.0) * (uFilm.x / 7.0);
  }
  col *= 1.0 - r2 * 0.30;
  col = pow(aces(col * 1.14), vec3(1.0 / 1.04));
  float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  col += (ign - 0.5) / 255.0;
  if (uFilm.z > 0.0) {
    vec2 gp = gl_FragCoord.xy + fract(uTime * vec2(7.13, 3.71)) * 311.0;
    float grain = fract(sin(dot(gp, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
    col += grain * uFilm.z * (0.35 + col.g);
  }
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

function createTarget(gl, w, h, hdr) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (hdr) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) {
        gl.deleteFramebuffer(fbo);
        gl.deleteTexture(tex);
        return null;
    }
    return { fbo, tex, w, h };
}

export class WebGL2Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = null;
        this.ready = false;
        this.hdr = false;
        this.scene = null;
        this.bloom = [];
        this.quadVao = null;
        this.lineVao = null;
        this.lineVbo = null;
        this.headVao = null;
        this.headVbo = null;
        this.bhProg = null;
        this.partProg = null;
        this.partHeadProg = null;
        this.dustProg = null;
        this.downProg = null;
        this.upProg = null;
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
                // A software rasteriser cannot run the raymarch; Canvas 2D
                // serves those machines better.
                failIfMajorPerformanceCaveat: true,
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
        this.ready = false;

        this.bhProg = createProgram(gl, SHADERS.FS_VS, SHADERS.BH_FS);
        this.partProg = createProgram(gl, SHADERS.PART_VS, SHADERS.PART_FS);
        this.partHeadProg = createProgram(gl, SHADERS.PART_HEAD_VS, SHADERS.PART_HEAD_FS);
        this.dustProg = createProgram(gl, SHADERS.DUST_VS, SHADERS.PART_HEAD_FS);
        this.downProg = createProgram(gl, SHADERS.FS_VS, SHADERS.DOWN_FS);
        this.upProg = createProgram(gl, SHADERS.FS_VS, SHADERS.UP_FS);
        this.compProg = createProgram(gl, SHADERS.FS_VS, SHADERS.COMP_FS);

        if (!this.bhProg || !this.partProg || !this.partHeadProg || !this.dustProg
            || !this.downProg || !this.upProg || !this.compProg) {
            return false;
        }

        // Either extension makes RGBA16F renderable; without one the scene
        // stays 8-bit with range compression (uSoftClip).
        this.hdr = !!(gl.getExtension('EXT_color_buffer_float')
            || gl.getExtension('EXT_color_buffer_half_float'));
        this.scene = null;
        this.bloom = [];

        this.quadVao = gl.createVertexArray();

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

    // (Re)allocates the scene target and its bloom mip chain for a scene size.
    ensureTargets(sw, sh) {
        const gl = this.gl;
        if (this.scene && this.scene.w === sw && this.scene.h === sh) return true;
        for (const t of [this.scene, ...this.bloom]) {
            if (!t) continue;
            gl.deleteFramebuffer(t.fbo);
            gl.deleteTexture(t.tex);
        }
        this.bloom = [];
        this.scene = createTarget(gl, sw, sh, this.hdr);
        if (!this.scene && this.hdr) {
            this.hdr = false;
            this.scene = createTarget(gl, sw, sh, false);
        }
        if (!this.scene) return false;

        let w = sw, h = sh;
        for (let i = 0; i < config.BLOOM_LEVELS; i++) {
            w >>= 1;
            h >>= 1;
            if (Math.min(w, h) < 4) break;
            const t = createTarget(gl, w, h, this.hdr);
            if (!t) break;
            this.bloom.push(t);
        }
        return true;
    }

    render(sim, view, quality) {
        const gl = this.gl;
        if (!this.ready || !gl || gl.isContextLost()) return;

        const cw = Math.max(2, this.canvas.width);
        const ch = Math.max(2, this.canvas.height);
        const scale = quality.scale || 1;
        const sw = Math.max(2, Math.round(cw * scale));
        const sh = Math.max(2, Math.round(ch * scale));
        if (!this.ensureTargets(sw, sh)) return;
        const softClip = this.hdr ? 0 : 0.42;

        // 1. Relativistic black hole + outer-sky fast path into the scene target
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fbo);
        gl.viewport(0, 0, sw, sh);
        gl.disable(gl.BLEND);

        const w = [0, 0, 0];
        w[config.PALETTES[0]] += sim.wM87;
        w[config.PALETTES[1]] += sim.wGarg;
        w[config.PALETTES[2]] += sim.wCyg;
        const [wM87, wGarg, wCyg] = w;
        const rIn = wM87 * 2.12 + wGarg * 2.20 + wCyg * 1.82;
        const rOut = (wM87 * 8.40 + wGarg * 8.20 + wCyg * 7.60) * config.DISK_OUTER;
        const kerrSpin = wM87 * 0.08 + wGarg * 0.04 + wCyg * 0.22;
        const omegaBase = wCyg * 2.05 + (1 - wCyg) * 1.55;

        const b = this.bhProg;
        const cam = sim.cam;
        gl.useProgram(b.program);
        gl.uniform2f(b.u.uRes, sw, sh);
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
        gl.uniform3fv(b.u.uCamPos, cam.ro);
        gl.uniform3fv(b.u.uCamU, cam.uu);
        gl.uniform3fv(b.u.uCamV, cam.vv);
        gl.uniform3fv(b.u.uCamW, cam.ww);
        gl.uniform1f(b.u.uFov, cam.fov);
        gl.uniform3fv(b.u.uBhT1, sim.bhT1);
        gl.uniform3fv(b.u.uBhN, sim.bhN);
        gl.uniform3fv(b.u.uBhT2, sim.bhT2);
        gl.uniform1f(b.u.uMarchSteps, quality.marchSteps || config.BH_MARCH_STEPS);
        gl.uniform1f(b.u.uSoftClip, softClip);
        gl.uniform2fv(b.u.uCenter, sim.center);
        gl.uniform3f(b.u.uLook, config.DISK_GAIN, config.HAZE_GAIN, config.SKY_RICH);

        gl.bindVertexArray(this.quadVao);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        const px = (view.dpr || 1) * scale;

        // 2. Stateless dust grains (attribute-less draw, all maths in the VS)
        const dustCount = quality.dust | 0;
        if (dustCount > 0) {
            const d = this.dustProg;
            const minDim = Math.min(sw, sh);
            gl.useProgram(d.program);
            gl.uniform1f(d.u.uTime, sim.time);
            gl.uniform4f(d.u.uBhParams, rIn, rOut, kerrSpin, omegaBase);
            gl.uniform1f(d.u.uCyg, wCyg);
            gl.uniform3fv(d.u.uCamPos, cam.ro);
            gl.uniform3fv(d.u.uCamU, cam.uu);
            gl.uniform3fv(d.u.uCamV, cam.vv);
            gl.uniform3fv(d.u.uCamW, cam.ww);
            gl.uniform1f(d.u.uFov, cam.fov);
            gl.uniform1f(d.u.uCamDist, cam.dist);
            gl.uniform3fv(d.u.uBhT1, sim.bhT1);
            gl.uniform3fv(d.u.uBhN, sim.bhN);
            gl.uniform3fv(d.u.uBhT2, sim.bhT2);
            gl.uniform2f(d.u.uNdcScale, (2 * minDim) / sw, (2 * minDim) / sh);
            gl.uniform1f(d.u.uPx, px);
            gl.uniform2fv(d.u.uCenter, sim.center);
            gl.uniform3f(d.u.uDust, config.DUST_GAIN, config.DUST_ARMS, config.DUST_SIZE);
            gl.drawArrays(gl.POINTS, 0, dustCount);
        }

        // 3. Compacted active-only CPU particles (cursor matter, infall)
        const drawCount = sim.drawCount;
        if (drawCount > 0) {
            gl.useProgram(this.partProg.program);
            gl.bindVertexArray(this.lineVao);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVbo);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, sim.pLineBuf, 0, drawCount * 12);
            gl.drawArrays(gl.LINES, 0, drawCount * 2);

            gl.useProgram(this.partHeadProg.program);
            gl.uniform1f(this.partHeadProg.u.uDpr, px);
            gl.bindVertexArray(this.headVao);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.headVbo);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, sim.pHeadBuf, 0, drawCount * 7);
            gl.drawArrays(gl.POINTS, 0, drawCount);
        }

        // 4. Bloom: downsample chain, then additive upsample back to level 0
        gl.disable(gl.BLEND);
        gl.bindVertexArray(this.quadVao);
        gl.activeTexture(gl.TEXTURE0);
        const levels = quality.bloom ? this.bloom.length : 0;
        if (levels > 0) {
            const down = this.downProg;
            gl.useProgram(down.program);
            gl.uniform1i(down.u.uTex, 0);
            gl.uniform1f(down.u.uSoftClip, softClip);
            let src = this.scene;
            for (let i = 0; i < levels; i++) {
                const dst = this.bloom[i];
                gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
                gl.viewport(0, 0, dst.w, dst.h);
                gl.bindTexture(gl.TEXTURE_2D, src.tex);
                gl.uniform2f(down.u.uHalfPixel, 0.5 / src.w, 0.5 / src.h);
                gl.uniform1f(down.u.uFirst, i === 0 ? 1 : 0);
                gl.drawArrays(gl.TRIANGLES, 0, 3);
                src = dst;
            }

            const up = this.upProg;
            gl.useProgram(up.program);
            gl.uniform1i(up.u.uTex, 0);
            gl.enable(gl.BLEND);
            for (let i = levels - 1; i > 0; i--) {
                const dst = this.bloom[i - 1];
                gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
                gl.viewport(0, 0, dst.w, dst.h);
                gl.bindTexture(gl.TEXTURE_2D, this.bloom[i].tex);
                gl.uniform2f(up.u.uHalfPixel, 0.5 / this.bloom[i].w, 0.5 / this.bloom[i].h);
                gl.drawArrays(gl.TRIANGLES, 0, 3);
            }
            gl.disable(gl.BLEND);
        }

        // 5. Composite to screen (upscale + aberration + ACES + vignette + dither)
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, cw, ch);
        gl.useProgram(this.compProg.program);
        gl.bindTexture(gl.TEXTURE_2D, this.scene.tex);
        gl.uniform1i(this.compProg.u.uScene, 0);
        gl.activeTexture(gl.TEXTURE1);
        // With bloom off the sampler still needs a texture; strength 0 mutes it.
        gl.bindTexture(gl.TEXTURE_2D, levels > 0 ? this.bloom[0].tex : this.scene.tex);
        gl.uniform1i(this.compProg.u.uBloom, 1);
        gl.uniform1f(this.compProg.u.uBloomStrength, levels > 0 ? config.BLOOM_STRENGTH / levels : 0);
        gl.uniform1f(this.compProg.u.uSoftClip, softClip);
        const streak = levels > 0 ? this.bloom[Math.min(3, levels - 1)] : this.scene;
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, streak.tex);
        gl.uniform1i(this.compProg.u.uStreakTex, 2);
        gl.uniform3f(this.compProg.u.uFilm, levels > 0 ? config.STREAK : 0, 2.5 / streak.w, config.GRAIN);
        gl.uniform1f(this.compProg.u.uTime, sim.time);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindVertexArray(null);
    }
}

export class Canvas2DRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.stars = null;
    }

    // Static star layer, repainted only when the view size changes.
    starLayer(w, h) {
        if (this.stars && this.stars.width === w && this.stars.height === h) return this.stars;
        const layer = document.createElement('canvas');
        layer.width = w;
        layer.height = h;
        const ctx = layer.getContext('2d');
        const count = Math.round((w * h) / 5200);
        for (let i = 0; i < count; i++) {
            const big = Math.random() > 0.9;
            ctx.fillStyle = `rgba(${big ? '255,232,204' : '204,222,255'},${(0.2 + Math.random() * 0.6).toFixed(2)})`;
            ctx.fillRect(Math.random() * w, Math.random() * h, big ? 1.6 : 1, big ? 1.6 : 1);
        }
        this.stars = layer;
        return layer;
    }

    render(sim, view) {
        const ctx = this.ctx;
        if (!ctx) return;
        const w = view.w, h = view.h;

        ctx.fillStyle = '#03050a';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(this.starLayer(w, h), 0, 0);

        const cx = w * 0.5 + view.parallax.x * 10 + sim.center[0] * Math.min(w, h);
        const cy = h * 0.5 - view.parallax.y * 8 - sim.center[1] * Math.min(w, h);
        const unit = (sim.cam.fov / sim.cam.dist) * Math.min(w, h); // px per world unit
        const rShadow = unit * 2.6;

        const rCol = Math.round(250 * (sim.wM87 + sim.wGarg) + 75 * sim.wCyg);
        const gCol = Math.round(140 * sim.wM87 + 195 * sim.wGarg + 210 * sim.wCyg);
        const bCol = Math.round(48 * sim.wM87 + 96 * sim.wGarg + 255 * sim.wCyg);
        const tint = (a) => `rgba(${rCol},${gCol},${bCol},${a.toFixed(3)})`;

        // The disk is a circle in the plane with normal bhN: on screen an
        // ellipse squashed along the projected normal by |n.z|.
        const n = sim.bhN;
        const squash = Math.max(0.1, Math.abs(n[2]));
        const tiltAngle = Math.atan2(-n[1], n[0]);
        const rOut = unit * 8.2;
        const glow = 0.6 + Math.min(0.25, sim.absorbGlow * 0.2);
        // Half the disk at a time: the far half goes behind the shadow, the
        // near half in front of it.
        const paintHalf = (near) => {
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(tiltAngle + ((n[2] > 0) === near ? Math.PI : 0));
            ctx.beginPath();
            ctx.rect(0, -rOut, rOut, rOut * 2);
            ctx.clip();
            ctx.scale(squash, 1);
            const g = ctx.createRadialGradient(0, 0, unit * 1.9, 0, 0, rOut);
            g.addColorStop(0, tint(0));
            g.addColorStop(0.06, tint(glow));
            g.addColorStop(0.3, tint(glow * 0.36));
            g.addColorStop(1, tint(0));
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(0, 0, rOut, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        };

        paintHalf(false);
        ctx.fillStyle = '#020307';
        ctx.beginPath();
        ctx.arc(cx, cy, rShadow, 0, Math.PI * 2);
        ctx.fill();
        paintHalf(true);

        ctx.lineWidth = 5;
        ctx.strokeStyle = tint(0.12 + sim.absorbGlow * 0.1);
        ctx.beginPath();
        ctx.arc(cx, cy, rShadow, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = tint(0.6);
        ctx.stroke();

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
