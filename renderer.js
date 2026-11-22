// renderer.js
// Unified high-performance renderer:
//   - WebGL2: sleek liquid-obsidian Turing core (subsurface filigree veins,
//     chromatic Stokes refraction, 4-tap bicubic fluid silk, continuous corona),
//     3D hyperspace starfield streaks, tapered fluid streamlines, and half-res
//     HDR bloom + ACES tone mapping + IGN dithering
//   - Canvas2DRenderer: matching graceful fallback driven by the same state

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
uniform vec2 uFluidRes;
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
uniform float uCoreScreenR;
uniform float uMarchSteps;
uniform mat3 uCoreRot;

vec4 sampleSimLocal(vec3 q, float len) {
  vec2 suv = vec2(atan(q.z, q.x) * 0.159154943 + 0.5,
                  acos(clamp(q.y / max(1e-4, len), -1.0, 1.0)) * 0.318309886);
  return textureLod(uSimTex, suv, 0.0);
}

// Living liquid-obsidian core: slow tri-axial breathing + spherical-harmonic lobes + Turing relief
float mapCoreLocal(vec3 q) {
  float len = length(q);
  float shellDist = len - uCoreRadius;
  if (shellDist > 0.26) return shellDist - 0.16;

  vec3 d = q / max(1e-4, len);
  float tm = uTime * 0.11;
  float tri = 0.046 * (d.x * d.x * sin(tm * 0.90)
                     + d.y * d.y * sin(tm * 0.72 + 2.094)
                     + d.z * d.z * sin(tm * 0.81 + 4.188));
  float lobes = 0.042 * (d.x * d.y * sin(tm * 1.15)
                       + d.y * d.z * cos(tm * 0.87 + 1.10)
                       + d.z * d.x * sin(tm * 0.98 + 2.30))
              + 0.026 * (d.x * (d.y * d.y - d.z * d.z) * cos(tm * 0.74)
                       + d.y * (3.0 * d.z * d.z - 1.0) * 0.35 * sin(tm * 0.63 + 1.70));
  float moodMorph = (uMood.y * 0.016 - uMood.x * 0.012) * (3.0 * d.y * d.y - 1.0) * 0.5;

  vec4 sim = sampleSimLocal(q, len);
  float morph = sim.r;
  float wave = (sim.b - 0.5) * 2.0;
  float liquid = 0.014 * sin(q.x * 2.6 + uTime * 0.38) * cos(q.y * 2.4 - uTime * 0.30);
  return (shellDist - tri - lobes - moodMorph + liquid - morph * 0.020 - wave * 0.018) * 0.80;
}

// Smooth 4-tap tetrahedral normals (wider filter step prevents grid faceting)
vec3 calcNormalLocal(vec3 q) {
  const float h = 0.011;
  const vec2 k = vec2(1.0, -1.0);
  return normalize(
    k.xyy * mapCoreLocal(q + k.xyy * h) +
    k.yyx * mapCoreLocal(q + k.yyx * h) +
    k.yxy * mapCoreLocal(q + k.yxy * h) +
    k.xxx * mapCoreLocal(q + k.xxx * h)
  );
}

// Curated celestial luxury palette: midnight sapphire, ice-cyan, amethyst, champagne gold
vec3 luxuryPalette(float t, vec2 mood) {
  vec3 cSapphire  = vec3(0.14, 0.36, 0.92);
  vec3 cCyan      = vec3(0.45, 0.85, 1.00);
  vec3 cAmethyst  = vec3(0.58, 0.42, 0.98);
  vec3 cChampagne = vec3(0.94, 0.80, 0.68);

  float x = fract(t);
  vec3 col = mix(cSapphire, cCyan, smoothstep(0.0, 0.32, x));
  col = mix(col, cAmethyst, smoothstep(0.32, 0.66, x));
  col = mix(col, cChampagne, smoothstep(0.66, 0.88, x));
  col = mix(col, cSapphire, smoothstep(0.88, 1.0, x));

  vec3 linkedInCol = mix(vec3(0.34, 0.68, 1.0), vec3(0.88, 0.94, 1.0), 0.5 + 0.5 * sin(x * 6.28318));
  vec3 spotifyCol  = mix(vec3(0.24, 0.88, 0.78), vec3(0.72, 0.44, 1.0), 0.5 + 0.5 * cos(x * 6.28318));
  col = mix(col, linkedInCol, mood.x * 0.72);
  col = mix(col, spotifyCol, mood.y * 0.72);
  return col;
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

float fbm3(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
  for (int i = 0; i < 3; i++) {
    v += a * noise2(p);
    p = rot * p * 2.04 + vec2(13.1, 7.7);
    a *= 0.5;
  }
  return v;
}

float microStars(vec2 p, float threshold, float t, float speedScale) {
  vec2 id = floor(p);
  vec2 f = fract(p) - 0.5;
  float r = hash21(id);
  if (r <= threshold) return 0.0;
  vec2 off = vec2(hash21(id + 17.3), hash21(id + 41.9)) - 0.5;
  vec2 d = f - off * 0.56;
  float spot = exp(-dot(d, d) * 95.0);
  float twinkle = 0.70 + 0.30 * sin(t * speedScale + r * 62.8318);
  return spot * twinkle * smoothstep(threshold, 1.0, r);
}

vec3 nebulaBackdrop(vec2 uv, vec2 vUv, vec2 parallax, float t, vec2 mood, vec3 moodAura) {
  vec3 base = mix(vec3(0.010, 0.014, 0.036), vec3(0.021, 0.036, 0.082), 1.0 - clamp(vUv.y, 0.0, 1.0));
  vec2 p = uv * 1.15 + parallax * 0.032;

  // 3-octave domain-warped interstellar clouds
  vec2 wq = vec2(
    fbm3(p * 1.12 + vec2(t * 0.014, -t * 0.009)),
    fbm3(p * 1.12 + vec2(-t * 0.010 + 5.2, t * 0.012 + 1.3))
  );
  float gas1 = fbm3(p + 1.45 * wq + vec2(-t * 0.008, t * 0.006));
  float gas2 = fbm3(p * 1.65 - 0.90 * wq + vec2(t * 0.007, -t * 0.010));

  float pulseCyan = 0.74 + 0.26 * sin(t * 0.24 + gas1 * 4.2);
  float pulseViolet = 0.74 + 0.26 * cos(t * 0.19 + gas2 * 3.8);

  float dustLane = smoothstep(0.28, 0.78, gas1);
  float ionized = smoothstep(0.36, 0.84, gas1 * gas2 * 2.05);
  float warmPocket = smoothstep(0.58, 0.88, gas2 * 0.68 + wq.x * 0.42);
  float centerMask = mix(0.30, 1.0, smoothstep(0.16, 0.72, length(uv * vec2(0.74, 1.06))));

  vec3 colSapphire = vec3(0.09, 0.22, 0.62);
  vec3 colIonized = mix(vec3(0.18, 0.64, 0.92), moodAura, 0.48);
  vec3 colAmethyst = mix(vec3(0.38, 0.22, 0.72), vec3(0.20, 0.74, 0.70), mood.y * 0.65);
  colAmethyst = mix(colAmethyst, vec3(0.28, 0.56, 0.96), mood.x * 0.55);
  vec3 colWarm = vec3(0.76, 0.48, 0.46);

  vec3 neb = colSapphire * dustLane * 0.16
           + colIonized * ionized * pulseCyan * 0.22
           + colAmethyst * smoothstep(0.35, 0.82, wq.y) * pulseViolet * 0.12
           + colWarm * warmPocket * 0.055;

  // Two ultra-distant sub-pixel star dust hash layers
  vec2 starUvA = uv * 28.0 + parallax * 0.42 + vec2(-t * 0.06, t * 0.03);
  vec2 starUvB = uv * 48.0 + parallax * 0.22 + vec2(t * 0.04, -t * 0.02);
  float dA = microStars(starUvA, 0.88, t, 1.25);
  float dB = microStars(starUvB, 0.92, t + 11.7, 0.85);
  vec3 dustStars = vec3(0.66, 0.82, 1.0) * dA * 0.34 + vec3(0.95, 0.90, 0.86) * dB * 0.26;

  return base + (neb + dustStars) * centerMask;
}

// 4-tap GPU-accelerated cubic B-spline bicubic sampler for silky fluid plumes
vec4 sampleFluidBicubic(vec2 uv) {
  vec2 p = uv * uFluidRes - 0.5;
  vec2 f = fract(p);
  vec2 i = p - f;
  vec2 f2 = f * f;
  vec2 f3 = f2 * f;

  vec2 w0 = (1.0 / 6.0) * (-f3 + 3.0 * f2 - 3.0 * f + 1.0);
  vec2 w1 = (1.0 / 6.0) * (3.0 * f3 - 6.0 * f2 + 4.0);
  vec2 w2 = (1.0 / 6.0) * (-3.0 * f3 + 3.0 * f2 + 3.0 * f + 1.0);
  vec2 w3 = (1.0 / 6.0) * f3;

  vec2 g0 = w0 + w1;
  vec2 g1 = w2 + w3;
  vec2 h0 = (i - 0.5) + (w1 / g0);
  vec2 h1 = (i + 1.5) + (w3 / g1);

  vec4 t00 = texture(uFluidTex, h0 * uFluidTexel);
  vec4 t10 = texture(uFluidTex, vec2(h1.x, h0.y) * uFluidTexel);
  vec4 t01 = texture(uFluidTex, vec2(h0.x, h1.y) * uFluidTexel);
  vec4 t11 = texture(uFluidTex, h1 * uFluidTexel);

  return mix(mix(t11, t01, g0.x), mix(t10, t00, g0.x), g0.y);
}

vec3 sampleFluidSilk(vec2 uv) {
  vec4 fl = sampleFluidBicubic(uv);
  vec3 vortTint = mix(vec3(0.38, 0.78, 1.0), vec3(0.28, 0.90, 0.80), uMood.y);
  vortTint = mix(vortTint, vec3(0.62, 0.78, 1.0), uMood.x);
  return fl.rgb * 0.92 + vortTint * fl.a * 0.28;
}

void main() {
  float minDim = max(1.0, min(uRes.x, uRes.y));
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / minDim;
  vec2 ptr = (uPointer - 0.5) * vec2(uRes.x / minDim, uRes.y / minDim);

  // Ray setup & tight bounding-sphere raymarch FIRST
  vec3 ro = vec3(uParallax.x * 0.16, uParallax.y * 0.16, uCamZ);
  vec3 ww = normalize(-ro);
  vec3 uu = normalize(cross(vec3(0.0, 1.0, 0.0), ww));
  vec3 vv = cross(ww, uu);
  vec3 rd = normalize(uv.x * uu + uv.y * vv + uCamFov * ww);

  float seedScale = mix(0.26, 1.0, 1.0 - exp(-uIgniteT * 3.1));
  float invScale = 1.0 / max(0.05, seedScale * uCoreScale);
  float boundR = 1.24 * uCoreScale;
  float b = dot(ro, rd);
  float c = dot(ro, ro) - boundR * boundR;
  float h = b * b - c;

  vec3 moodAura = mix(vec3(0.22, 0.52, 0.96), vec3(0.20, 0.82, 0.78), uMood.y);
  moodAura = mix(moodAura, vec3(0.38, 0.72, 1.0), uMood.x);

  bool hit = false;
  vec3 qHit = vec3(0.0);

  if (h > 0.0) {
    vec3 roL = uCoreRot * (ro * invScale);
    vec3 rdL = uCoreRot * (rd * invScale);
    float tStart = max(0.0, -b - sqrt(h));
    float tEnd = -b + sqrt(h);
    float t = tStart;
    int maxSteps = int(uMarchSteps);

    for (int i = 0; i < 36; i++) {
      if (i >= maxSteps) break;
      vec3 q = roL + rdL * t;
      float dLocal = mapCoreLocal(q);
      if (dLocal < 0.0025) {
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
    vec3 N = NL * uCoreRot; // uCoreRot orthonormal: transpose == inverse
    vec3 V = -rd;

    // Sample outer Turing contours + deeper subsurface refracted layer
    vec4 sim = sampleSimLocal(qHit, length(qHit));
    vec3 qDeep = qHit - (uCoreRot * rd) * 0.14;
    vec4 simDeep = sampleSimLocal(qDeep, length(qDeep));

    float morph = sim.r;
    float wave = abs(sim.b - 0.5) * 2.0;
    float contour = smoothstep(0.18, 0.36, morph) * smoothstep(0.68, 0.36, morph);
    float deepContour = smoothstep(0.20, 0.40, simDeep.r) * smoothstep(0.70, 0.40, simDeep.r);

    // Studio key softbox + rim softbox lights
    vec3 L1 = normalize(vec3(ptr.x * 2.0 + 0.55, ptr.y * 2.0 + 0.72, 1.65));
    vec3 L2 = normalize(vec3(-1.35 * cos(uTime * 0.25), -0.85, 1.15));

    float ndv = max(dot(N, V), 0.0);
    float fresnel = pow(1.0 - ndv, 3.1);
    float specCrisp = pow(max(dot(reflect(-L1, N), V), 0.0), 76.0);
    float specSatin = pow(max(dot(reflect(-L1, N), V), 0.0), 14.0);
    float specRim = pow(max(dot(reflect(-L2, N), V), 0.0), 28.0);

    float palShift = 1.0 - ndv * 0.85 + morph * 0.35 + uTime * 0.03;
    vec3 palCol = luxuryPalette(palShift, uMood);

    // Chromatic glass refraction + live reflection of Stokes fluid
    vec2 refrOffset = N.xy * 0.15;
    vec2 disp = N.xy * 0.014;
    float refrR = texture(uFluidTex, clamp(vUv - refrOffset + disp, 0.02, 0.98)).r;
    float refrG = texture(uFluidTex, clamp(vUv - refrOffset, 0.02, 0.98)).g;
    float refrB = texture(uFluidTex, clamp(vUv - refrOffset - disp, 0.02, 0.98)).b;
    vec3 fluidRefr = vec3(refrR, refrG, refrB);

    vec2 reflUv = clamp(vUv + N.xy * 0.20, 0.02, 0.98);
    vec3 fluidRefl = texture(uFluidTex, reflUv).rgb;
    vec3 mist = texture(uFluidTex, vUv).rgb;

    // Deep velvety obsidian interior preserves crisp white typography contrast
    col = vec3(0.010, 0.015, 0.032);
    // Subtle subsurface bioluminescent Turing filigree (muted at dead center, radiant toward curve)
    float edgeMask = smoothstep(0.12, 0.75, 1.0 - ndv);
    float filigree = (contour * 0.55 + deepContour * 0.45) * (0.14 + 0.86 * edgeMask) + wave * 0.24;
    col += mix(palCol, palCol * 0.65 + fluidRefl * 0.65, 0.4) * filigree * 0.55;

    // Polished Fresnel rim + chromatic fluid refraction + reflection
    col += palCol * fresnel * 0.72;
    col += fluidRefr * (0.08 + 0.92 * fresnel) * 0.58;
    col += fluidRefl * (0.16 + 0.84 * fresnel) * 0.72;

    // Twin studio softbox catchlights (cool pearl + subtle champagne gold glint)
    col += mix(vec3(0.86, 0.93, 1.0), palCol, 0.3) * specCrisp * (1.05 + 0.35 * uPointerStrength);
    col += vec3(0.95, 0.83, 0.70) * specSatin * 0.16;
    col += mix(vec3(0.62, 0.48, 1.0), vec3(0.28, 0.90, 0.80), uMood.y) * specRim * 0.48;

    // Delicate foreground Stokes mist veil across grazing limb
    col += mist * (0.02 + 0.26 * fresnel);
  } else {
    // Deep midnight OLED void + 3-octave domain-warped pulsating nebulae + distant dust stars
    col = nebulaBackdrop(uv, vUv, uParallax, uTime, uMood, moodAura);

    // Silky 4-tap bicubic Navier-Stokes fluid plumes
    vec3 fluidCol = sampleFluidSilk(vUv);
    float centerGuard = mix(0.68, 1.0, smoothstep(0.14, 0.58, length(uv * vec2(0.76, 1.12))));
    col += fluidCol * 0.95 * centerGuard;

    // Continuous screen-space plasma-sheath corona around the sphere silhouette (zero hard edge)
    float edgeDist = max(0.0, length(uv) - uCoreScreenR * 0.98);
    float corona = exp(-edgeDist * 12.5);
    col += (moodAura * 0.16 + fluidCol * 0.34) * corona;
  }

  // Subtle initial warp-exit pulse ring
  if (uIgniteT < 1.8) {
    float ignRing = exp(-pow((length(uv) - uIgniteT * 0.68) * 14.0, 2.0)) * exp(-uIgniteT * 1.9);
    col += luxuryPalette(uIgniteT * 0.5, uMood) * ignRing * 0.28;
  }

  fragColor = vec4(col, 1.0);
}`,

    STAR_VS: `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec4 aColor;
out vec4 vColor;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
  vColor = aColor;
}`,

    STAR_FS: `#version 300 es
precision highp float;
in vec4 vColor;
out vec4 fragColor;
void main() {
  fragColor = vec4(vColor.rgb * vColor.a, vColor.a);
}`,

    STAR_HEAD_VS: `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec4 aColor;
layout(location = 2) in float aSize;
uniform float uDpr;
out vec4 vColor;
out float vHero;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
  gl_PointSize = clamp((aSize * 1.5 + 2.2) * uDpr, 3.5, 30.0);
  vColor = aColor;
  vHero = smoothstep(4.5, 5.5, aSize);
}`,

    STAR_HEAD_FS: `#version 300 es
precision highp float;
in vec4 vColor;
in float vHero;
out vec4 fragColor;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  float edgeFade = smoothstep(1.0, 0.65, r2);
  float airy = exp(-r2 * 11.0) * 1.15 + exp(-r2 * 3.8) * 0.26;
  float spikeX = exp(-abs(p.x) * 16.0) * exp(-abs(p.y) * 2.8);
  float spikeY = exp(-abs(p.y) * 16.0) * exp(-abs(p.x) * 2.8);
  float inten = (airy + (spikeX + spikeY) * 0.62 * vHero) * edgeFade;
  float a = vColor.a * inten;
  fragColor = vec4(vColor.rgb * a, a);
}`,

    TRACER_VS: `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec3 aMeta; // speedNorm, hueShift, alpha
uniform vec2 uMood;
out vec4 vColor;

vec3 luxuryPalette(float t, vec2 mood) {
  vec3 cSapphire  = vec3(0.24, 0.48, 0.98);
  vec3 cCyan      = vec3(0.45, 0.86, 1.00);
  vec3 cAmethyst  = vec3(0.64, 0.48, 0.98);
  vec3 cChampagne = vec3(0.95, 0.83, 0.72);

  float x = fract(t);
  vec3 col = mix(cSapphire, cCyan, smoothstep(0.0, 0.32, x));
  col = mix(col, cAmethyst, smoothstep(0.32, 0.66, x));
  col = mix(col, cChampagne, smoothstep(0.66, 0.88, x));
  col = mix(col, cSapphire, smoothstep(0.88, 1.0, x));

  vec3 linkedInCol = mix(vec3(0.38, 0.72, 1.0), vec3(0.90, 0.95, 1.0), 0.5 + 0.5 * sin(x * 6.28318));
  vec3 spotifyCol  = mix(vec3(0.26, 0.90, 0.80), vec3(0.76, 0.46, 1.0), 0.5 + 0.5 * cos(x * 6.28318));
  col = mix(col, linkedInCol, mood.x * 0.72);
  col = mix(col, spotifyCol, mood.y * 0.72);
  return col;
}

void main() {
  gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0);
  vColor = vec4(luxuryPalette(aMeta.y, uMood), aMeta.z);
}`,

    TRACER_FS: `#version 300 es
precision highp float;
in vec4 vColor;
out vec4 fragColor;
void main() {
  fragColor = vec4(vColor.rgb * vColor.a, vColor.a);
}`,

    BRIGHT_FS: `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uScene;
void main() {
  vec3 c = texture(uScene, vUv).rgb;
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float w = smoothstep(0.36, 0.92, luma);
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
  col *= 1.0 - dot(d, d) * 0.44;
  col = pow(aces(col * 1.16), vec3(1.0 / 1.05));
  // Interleaved Gradient Noise dithering eliminates dark-sky banding
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

function createFBO(gl, w, h) {
    const tex = createTexture(gl, w, h, gl.CLAMP_TO_EDGE);
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
        this.fluidW = 0;
        this.fluidH = 0;
        this.fluidTex = null;
        this.simTex = null;
        this.sceneFBO = null;
        this.bloomA = null;
        this.bloomB = null;
        this.quadVao = null;
        this.starVao = null;
        this.starVbo = null;
        this.starPointVao = null;
        this.starPointVbo = null;
        this.tracerVao = null;
        this.tracerVbo = null;
        this.mainProg = null;
        this.starProg = null;
        this.starHeadProg = null;
        this.tracerProg = null;
        this.brightProg = null;
        this.blurProg = null;
        this.compProg = null;
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
        this.starProg = createProgram(gl, SHADERS.STAR_VS, SHADERS.STAR_FS);
        this.starHeadProg = createProgram(gl, SHADERS.STAR_HEAD_VS, SHADERS.STAR_HEAD_FS);
        this.tracerProg = createProgram(gl, SHADERS.TRACER_VS, SHADERS.TRACER_FS);
        this.brightProg = createProgram(gl, SHADERS.FS_VS, SHADERS.BRIGHT_FS);
        this.blurProg = createProgram(gl, SHADERS.FS_VS, SHADERS.BLUR_FS);
        this.compProg = createProgram(gl, SHADERS.FS_VS, SHADERS.COMP_FS);

        if (!this.mainProg || !this.starProg || !this.starHeadProg || !this.tracerProg
            || !this.brightProg || !this.blurProg || !this.compProg) {
            return false;
        }

        this.quadVao = gl.createVertexArray();
        this.simTex = createTexture(gl, sim.tw, sim.th, gl.REPEAT);
        this.fluidW = sim.gw;
        this.fluidH = sim.gh;
        this.fluidTex = createTexture(gl, sim.gw, sim.gh, gl.CLAMP_TO_EDGE);

        const sw = Math.max(2, this.canvas.width || 2);
        const sh = Math.max(2, this.canvas.height || 2);
        const bw = Math.max(2, sw >> 1);
        const bh = Math.max(2, sh >> 1);
        this.sceneFBO = createFBO(gl, sw, sh);
        this.bloomA = createFBO(gl, bw, bh);
        this.bloomB = createFBO(gl, bw, bh);
        if (!this.sceneFBO || !this.bloomA || !this.bloomB) return false;

        // 3D hyperspace stars VAO (tail streaks + Airy core point heads)
        this.starVao = gl.createVertexArray();
        this.starVbo = gl.createBuffer();
        gl.bindVertexArray(this.starVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.starVbo);
        gl.bufferData(gl.ARRAY_BUFFER, sim.starLineBuf.byteLength, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, 0);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 8);

        this.starPointVao = gl.createVertexArray();
        this.starPointVbo = gl.createBuffer();
        gl.bindVertexArray(this.starPointVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.starPointVbo);
        gl.bufferData(gl.ARRAY_BUFFER, sim.starPointBuf.byteLength, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 28, 0);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 8);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 28, 24);

        // Velocity-aligned fluid streamlines VAO
        this.tracerVao = gl.createVertexArray();
        this.tracerVbo = gl.createBuffer();
        gl.bindVertexArray(this.tracerVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.tracerVbo);
        gl.bufferData(gl.ARRAY_BUFFER, sim.tracerLineBuf.byteLength, gl.DYNAMIC_DRAW);
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

    _updateCoreRot(coreAngle, t, tiltX, tiltY) {
        const a = coreAngle;
        const b = Math.sin(t * 0.11) * 0.12 + tiltX;
        const c = tiltY;
        const ca = Math.cos(a), sa = Math.sin(a);
        const cb = Math.cos(b), sb = Math.sin(b);
        const cc = Math.cos(c), sc = Math.sin(c);
        const m = this.coreRot;
        m[0] = ca * cb;
        m[1] = cc * ca * sb - sc * sa;
        m[2] = sc * ca * sb + cc * sa;
        m[3] = -sb;
        m[4] = cc * cb;
        m[5] = sc * cb;
        m[6] = -sa * cb;
        m[7] = -cc * sa * sb - sc * ca;
        m[8] = -sc * sa * sb + cc * ca;
    }

    render(sim, view, quality) {
        const gl = this.gl;
        if (!this.ready || !gl || gl.isContextLost()) return;

        const cw = Math.max(2, this.canvas.width);
        const ch = Math.max(2, this.canvas.height);
        resizeFBO(gl, this.sceneFBO, cw, ch);
        resizeFBO(gl, this.bloomA, Math.max(2, cw >> 1), Math.max(2, ch >> 1));
        resizeFBO(gl, this.bloomB, Math.max(2, cw >> 1), Math.max(2, ch >> 1));

        if (sim.gw !== this.fluidW || sim.gh !== this.fluidH) {
            this.fluidW = sim.gw;
            this.fluidH = sim.gh;
            gl.bindTexture(gl.TEXTURE_2D, this.fluidTex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, sim.gw, sim.gh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        }

        // 1. Render core + fluid silk + stars + streamlines into sceneFBO
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFBO.fbo);
        gl.viewport(0, 0, cw, ch);
        gl.disable(gl.BLEND);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.fluidTex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, sim.gw, sim.gh, gl.RGBA, gl.UNSIGNED_BYTE, sim.fluidTexBytes);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.simTex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, sim.tw, sim.th, gl.RGBA, gl.UNSIGNED_BYTE, sim.turingTexBytes);

        this._updateCoreRot(sim.coreAngle, sim.time, sim.coreTiltX, sim.coreTiltY);

        const m = this.mainProg;
        gl.useProgram(m.program);
        gl.uniform1i(m.u.uFluidTex, 0);
        gl.uniform1i(m.u.uSimTex, 1);
        gl.uniform2f(m.u.uRes, cw, ch);
        gl.uniform2f(m.u.uFluidRes, sim.gw, sim.gh);
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
        gl.uniform1f(m.u.uCoreScreenR, sim.coreScreenRadiusFrac);
        gl.uniform1f(m.u.uMarchSteps, quality.marchSteps);
        gl.uniformMatrix3fv(m.u.uCoreRot, false, this.coreRot);

        gl.bindVertexArray(this.quadVao);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        // Additive 3D hyperspace starfield & fluid streamlines
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);

        gl.useProgram(this.starProg.program);
        gl.bindVertexArray(this.starVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.starVbo);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, sim.starLineBuf);
        gl.drawArrays(gl.LINES, 0, config.STAR_COUNT * 2);

        const dpr = this.canvas.clientWidth ? cw / this.canvas.clientWidth : 1;
        gl.useProgram(this.starHeadProg.program);
        gl.uniform1f(this.starHeadProg.u.uDpr, dpr);
        gl.bindVertexArray(this.starPointVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.starPointVbo);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, sim.starPointBuf);
        gl.drawArrays(gl.POINTS, 0, config.STAR_COUNT);

        const tCount = quality.tracers;
        if (tCount > 0) {
            if (tCount !== this.cachedTracerCount || !this.cachedTracerView || this.cachedTracerView.buffer !== sim.tracerLineBuf.buffer) {
                this.cachedTracerCount = tCount;
                this.cachedTracerView = sim.tracerLineBuf.subarray(0, tCount * 10);
            }
            const tr = this.tracerProg;
            gl.useProgram(tr.program);
            gl.uniform2f(tr.u.uMood, sim.wLinkedIn, sim.wSpotify);
            gl.bindVertexArray(this.tracerVao);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.tracerVbo);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.cachedTracerView);
            gl.drawArrays(gl.LINES, 0, tCount * 2);
        }

        // 2. Half-res HDR Bloom passes (skipped cleanly if degraded)
        gl.disable(gl.BLEND);
        gl.bindVertexArray(this.quadVao);
        if (quality.bloom) {
            const bw = this.bloomA.w, bh = this.bloomA.h;
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomA.fbo);
            gl.viewport(0, 0, bw, bh);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.sceneFBO.tex);
            gl.useProgram(this.brightProg.program);
            gl.uniform1i(this.brightProg.u.uScene, 0);
            gl.drawArrays(gl.TRIANGLES, 0, 3);

            gl.useProgram(this.blurProg.program);
            gl.uniform1i(this.blurProg.u.uTex, 0);
            for (let pass = 0; pass < 2; pass++) {
                gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomB.fbo);
                gl.bindTexture(gl.TEXTURE_2D, this.bloomA.tex);
                gl.uniform2f(this.blurProg.u.uStep, 1.35 / bw, 0);
                gl.drawArrays(gl.TRIANGLES, 0, 3);

                gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomA.fbo);
                gl.bindTexture(gl.TEXTURE_2D, this.bloomB.tex);
                gl.uniform2f(this.blurProg.u.uStep, 0, 1.35 / bh);
                gl.drawArrays(gl.TRIANGLES, 0, 3);
            }
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
        this.off = document.createElement('canvas');
        this.offCtx = this.off.getContext('2d');
        this.imgData = null;
        this.gw = 0;
        this.gh = 0;

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
                fresArr[count] = Math.pow(1 - nz, 2.6);
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
                const r = 6 + bytes[s] + (bytes[s + 3] >> 2);
                const g = 10 + bytes[s + 1] + (bytes[s + 3] >> 1);
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

        // Moving pulsating nebula clouds + 3D hyperspace stars + tapered fluid streamlines
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';

        const tNeb = sim.time;
        const p1 = 0.065 + 0.025 * Math.sin(tNeb * 0.24);
        const nx1 = w * (0.34 + 0.06 * Math.sin(tNeb * 0.08)) - view.parallax.x * 12;
        const ny1 = h * (0.38 + 0.05 * Math.cos(tNeb * 0.07)) + view.parallax.y * 12;
        const neb1 = ctx.createRadialGradient(nx1, ny1, 0, nx1, ny1, Math.max(w, h) * 0.42);
        neb1.addColorStop(0, sim.wSpotify > 0.3 ? `rgba(54, 198, 186, ${p1.toFixed(3)})` : `rgba(58, 132, 240, ${p1.toFixed(3)})`);
        neb1.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = neb1;
        ctx.fillRect(0, 0, w, h);

        const p2 = 0.055 + 0.020 * Math.cos(tNeb * 0.19);
        const nx2 = w * (0.68 + 0.06 * Math.cos(tNeb * 0.06)) - view.parallax.x * 8;
        const ny2 = h * (0.62 + 0.05 * Math.sin(tNeb * 0.09)) + view.parallax.y * 8;
        const neb2 = ctx.createRadialGradient(nx2, ny2, 0, nx2, ny2, Math.max(w, h) * 0.38);
        neb2.addColorStop(0, `rgba(132, 86, 224, ${p2.toFixed(3)})`);
        neb2.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = neb2;
        ctx.fillRect(0, 0, w, h);

        const sBuf = sim.starLineBuf;
        const pBuf = sim.starPointBuf;
        ctx.lineWidth = 1.1;
        for (let i = 0; i < config.STAR_COUNT; i++) {
            const p = i * 7;
            const alpha = pBuf[p + 5];
            if (alpha < 0.04) continue;
            const o = i * 12;
            const x0 = (sBuf[o] * 0.5 + 0.5) * w;
            const y0 = (0.5 - sBuf[o + 1] * 0.5) * h;
            const x1 = (pBuf[p] * 0.5 + 0.5) * w;
            const y1 = (0.5 - pBuf[p + 1] * 0.5) * h;
            const colStr = `rgba(${(pBuf[p + 2] * 255) | 0},${(pBuf[p + 3] * 255) | 0},${(pBuf[p + 4] * 255) | 0},`;
            ctx.strokeStyle = `${colStr}${(alpha * 0.65).toFixed(2)})`;
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            ctx.stroke();

            const rad = Math.max(0.65, pBuf[p + 6] * 0.24);
            ctx.fillStyle = `${colStr}${alpha.toFixed(2)})`;
            ctx.beginPath();
            ctx.arc(x1, y1, rad, 0, TAU);
            ctx.fill();
        }

        ctx.strokeStyle = sim.wSpotify > 0.3 ? 'rgba(91, 224, 214, 0.36)' : 'rgba(130, 198, 255, 0.36)';
        ctx.lineWidth = 1.1;
        const lBuf = sim.tracerLineBuf;
        const tracerDraw = Math.min(380, config.TRACER_COUNT);
        ctx.beginPath();
        for (let i = 0; i < tracerDraw; i++) {
            const o = i * 10;
            if (lBuf[o + 9] < 0.06) continue;
            ctx.moveTo(lBuf[o] * w, (1 - lBuf[o + 1]) * h);
            ctx.lineTo(lBuf[o + 5] * w, (1 - lBuf[o + 6]) * h);
        }
        ctx.stroke();
        ctx.restore();

        // Precomputed 128x128 obsidian Turing core rotated by sim.coreAngle
        const minDim = Math.min(w, h);
        const R = minDim * sim.coreScreenRadiusFrac;
        const cx = w * 0.5 - view.parallax.x * 8;
        const cy = h * 0.5 + view.parallax.y * 8;

        const aura = ctx.createRadialGradient(cx, cy, R * 0.55, cx, cy, R * 1.75);
        aura.addColorStop(0, sim.wSpotify > 0.3 ? 'rgba(60, 216, 196, 0.22)' : 'rgba(92, 168, 255, 0.22)');
        aura.addColorStop(0.55, 'rgba(140, 108, 255, 0.09)');
        aura.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = aura;
        ctx.fillRect(0, 0, w, h);

        const sData = this.sphereImg.data;
        const lutCount = this.lutCount;
        const lutPix = this.lutPix, lutNx = this.lutNx, lutNz = this.lutNz;
        const lutGy = this.lutGy, lutFres = this.lutFres;
        const gsV = sim.gsV, waveH = sim.waveH;
        const tw = sim.tw;
        const a = -sim.coreAngle;
        const cosA = Math.cos(a), sinA = Math.sin(a);
        const invTau = 1 / TAU;

        for (let k = 0; k < lutCount; k++) {
            const nx = lutNx[k], nz = lutNz[k];
            const rx = nx * cosA - nz * sinA;
            const rz = nx * sinA + nz * cosA;
            const u = ((Math.atan2(rz, rx) * invTau + 0.5) % 1 + 1) % 1;
            const gx = Math.min(tw - 1, (u * tw) | 0);
            const idx = lutGy[k] * tw + gx;
            const morph = gsV[idx];
            const contour = morph > 0.18 && morph < 0.58 ? (morph - 0.18) * 2.5 : 0;
            const wave = waveH[idx] < 0 ? -waveH[idx] : waveH[idx];
            const fres = lutFres[k];
            const inten = contour * 0.45 + wave * 0.4 + fres * 0.95;
            const p = lutPix[k];
            if (inten <= 0.08) {
                sData[p] = 5; sData[p + 1] = 8; sData[p + 2] = 18; sData[p + 3] = 248;
            } else {
                const r = 8 + inten * (78 + sim.wSpotify * 45);
                const g = 14 + inten * (135 + sim.wSpotify * 40);
                const b = 28 + inten * 215;
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
