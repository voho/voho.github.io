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
- `renderer.js` — `WebGL2Renderer` (single-pass 96-step Schwarzschild/Kerr null-geodesic raymarcher with multi-band Doppler-beamed accretion disk, Einstein-lensed 3D starfield, smooth `Cygnus X-1` bipolar jets, additive Airy particle trails/cores, half-res separable HDR bloom, and ACES + IGN dithering) plus a `Canvas2DRenderer` graceful fallback driven by the same simulation state.
- `script.js` — WebGL2 initialization, `webglcontextlost` fallback/recovery, `100lvh`-safe responsive sizing, pointer/hold particle streaming, device tilt parallax, link/button hover spacetime transitions, FPS quality governor, and `prefers-reduced-motion` handling.

## Interaction

- **Default resting state** — opens in **M87\* Horizon** with a face-on obsidian shadow framing centered typography, crescent photon ring, and ambient spiralling matter.
- **Hover or focus links** — hovering **Founder at Protocodus** or **Meet me on LinkedIn** smoothly morphs the black hole into **Gargantua**; hovering **Co-Founder of Evangelist** or **Listen on Spotify** morphs into **Cygnus X-1** with sapphire X-ray plasma and bipolar jets, while stars remain stationary and orbiting particles adapt cleanly.
- **Move, click, or hold cursor / touch** — emits streams and tidal bursts of matter that spiral inward and visibly redshift into oblivion as they cross the horizon.
- **Tilt a phone** — shifts camera parallax gently without requesting extra sensor permissions.

## Graceful degradation & accessibility

1. **WebGL2 (Full)** — 96-step relativistic geodesic raymarch + half-res HDR bloom + 1,000 relativistic particles + `1.5` max DPR.
2. **Quality Governor** — steps down bloom, raymarch steps (`76 -> 60`), `maxDpr`, and particle budget (`500`) if FPS drops below threshold.
3. **Canvas 2D Fallback** — automatically activates when WebGL2 is unavailable or context is lost.
4. **`prefers-reduced-motion`** — renders a single settled static frame with no animation loop.

## Tests

```
npm test
```

Headless Node checks for adaptive camera framing and sky-locked hover invariance, smooth `M87* -> Gargantua -> Cygnus X-1 -> M87*` transitions with orthonormal basis vectors, horizon oblivion absorption & redshift fade, 180-step finite soak stability, `< 1.0 ms/frame` CPU update budget, and WebGL2 `#version 300 es` shader integrity.
