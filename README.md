# voho.github.io

Personal landing page served at [voho.eu](http://voho.eu) via GitHub Pages.

Static site with no build step: `index.html` + `styles.css` + ES modules.

## Background simulation

A real-time general-relativistic Black Hole and particle absorption simulation renders behind a fixed, readable centre block:

- `config.js` — central tuning knobs (`M87* Horizon`, `Gargantua`, `Cygnus X-1` spacetime presets, fixed sky camera parallax, Paczyński–Wiita particle dynamics, quality tiers).
- `simulation.js` — pure DOM-free `BlackHoleSimulation` engine implementing:
  - smoothly interpolated black hole orientation basis `(bhT1, bhN, bhT2)` and continuous preset weights (`wM87`, `wGarg`, `wCyg`) decoupling accretion geometry from the sky-locked camera so background stars never jump on link hover;
  - up to `1,000` cursor- and click-emitted 3D particles integrated under the **Paczyński–Wiita** potential with plane settling and Kerr frame-dragging;
  - a 3-state oblivion absorption lifecycle (`pState = 2`): infalling stars time-dilate, redshift across color channels, fade smoothly into darkness, and flare the photon ring/jets (`absorbGlow`).
- `renderer.js` — `WebGL2Renderer` plus a `Canvas2DRenderer` fallback driven by the same simulation state. The WebGL2 pipeline:
  - 72-step Schwarzschild/Kerr null-geodesic raymarcher (rays are settled at the photon sphere, analytic outer-sky lensing fast path) into a half-float HDR target;
  - accretion disk textured with two cross-fading flow-noise layers, so differential Keplerian rotation shears it into streaks without ever winding up, plus a thin volumetric gas glow and Doppler beaming;
  - `18,000` stateless GPU dust grains whose spiral-in orbits are closed-form in the vertex shader (no buffers, no CPU);
  - dual-filter mip-chain bloom, then a composite pass that upscales, adds slight chromatic aberration, ACES tone mapping, vignette and dithering.
- `quality.js` — DOM-free `QualityGovernor`: trades render scale, then effects, for frame rate and probes back up with exponential backoff.
- `script.js` — WebGL2 initialization, `webglcontextlost` fallback/recovery, `100lvh`-safe responsive sizing, pointer/hold particle streaming, device tilt parallax, link/button hover spacetime transitions, intro fly-in and idle camera drift, display-rate calibration with a ~60 fps cap, and `prefers-reduced-motion` handling.

## Look

One cinematic look: an edge-on disk with the lensed arc over the shadow, centred behind the typography, with an anamorphic streak, film grain, a slowly breathing tilt and a faint galactic band turning in the sky. Its tunables sit in the "Cinematic Look" block of `config.js`.

## CPU budget

- The loop runs at half rate (~30 fps) after `2.5 s` without pointer, touch or hover input, and returns to full rate on the next input.
- Device pixel ratio is capped at `1.25`.
- Pointer moves are coalesced to one simulation update per frame.
- No `backdrop-filter` over the canvas, which would force a re-blur every frame.

## Interaction

- **Default resting state** — the cinematic edge-on view: shadow framed by the lensed arc of the disk, centred behind the typography.
- **Hover or focus links** — hovering **Founder at Protocodus** or **Meet me on LinkedIn** smoothly swings the disk face-on in amber; hovering **Co-Founder of Evangelist** or **Listen on Spotify** morphs into **Cygnus X-1** with sapphire X-ray plasma and bipolar jets, while stars remain stationary and orbiting particles adapt cleanly.
- **Move, click, or hold cursor / touch** — emits streams and tidal bursts of matter that spiral inward and visibly redshift into oblivion as they cross the horizon.
- **Tilt a phone** — shifts camera parallax gently without requesting extra sensor permissions.

## Graceful degradation & accessibility

1. **WebGL2, full** — half-float HDR scene at up to `1.25` DPR, bloom, dust, 72 march steps. Weak or power-saving devices (few cores, little memory, coarse pointer, Save-Data) start at `0.7` render scale.
2. **Adaptive render scale** — the governor lowers the scene resolution down to `0.5` when frame rate drops and raises it again when there is headroom; the composite pass upscales.
3. **Lite effects** — if minimum scale is still too slow: 44 march steps, no bloom, `5,000` dust grains, `500` particles.
4. **8-bit targets** — without `EXT_color_buffer_float`/`half_float` the same pipeline runs range-compressed in RGBA8.
5. **Canvas 2D** — when WebGL2 is unavailable, software-rendered, or its context is lost: painted disk, shadow, photon ring and the CPU particles.
6. **`prefers-reduced-motion`** — a single settled static frame with no animation loop.
7. **No JavaScript / before the first frame** — a CSS gradient stand-in of the shadow and glow.

The loop pauses in hidden tabs and renders at most ~60 fps on high-refresh displays.

## Tests

```
npm test
```

Headless Node checks for adaptive camera framing and sky-locked hover invariance, smooth `M87* -> Gargantua -> Cygnus X-1 -> M87*` transitions with orthonormal basis vectors, horizon oblivion absorption & redshift fade, 180-step finite soak stability, `< 0.5 ms/frame` CPU update budget, intro fly-in, quality governor behaviour (slow, fast, hiccup and borderline devices), and WebGL2 `#version 300 es` shader integrity.
