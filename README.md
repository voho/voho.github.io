# voho.github.io

Personal landing page served at [voho.eu](http://voho.eu) via GitHub Pages.

Static site with no build step: `index.html` + `styles.css` + ES modules.

## Background simulation

A coupled real-time physics and morphogenesis simulation renders behind a fixed, readable centre block:

- `config.js` — central tuning knobs (Navier-Stokes solver, Gray-Scott & wave PDEs, core coupling, tracers, camera, choreography, quality tiers).
- `simulation.js` — pure DOM-free `CoupledSimulation` engine combining:
  - an adaptive isotropic **Navier-Stokes (Stable Fluids)** grid (`∇·u = 0` via Red-Black SOR, vorticity confinement, fused semi-Lagrangian advection) with solid-body deflection around the central core and **3,200** advected **Lagrangian tracers**;
  - a **96×64 Gray-Scott reaction-diffusion PDE** coupled to a **2D damped wave equation** whose morphogen concentrations and waves physically displace the 3D core surface;
  - **bidirectional physical coupling**: active Turing ridges & waves on the sphere's limb exhale iridescent filaments directly into the surrounding fluid, while viscous tangential fluid torque spins/tilts the 3D sphere and boundary shear feeds surface waves & morphogen nutrients.
- `renderer.js` — `WebGL2Renderer` (single-pass 3D SDF raymarched obsidian core with chromatic glass refraction, live Navier-Stokes surface reflections, translucent limb mist veil, thin-film optical iridescence, and additive tracers) plus a `Canvas2DRenderer` graceful fallback driven by the same simulation state.
- `script.js` — WebGL2 initialization, `webglcontextlost` fallback and recovery, `100lvh`-safe responsive sizing, pointer/touch/tilt parallax, button mood hooks, load ignition choreography, FPS quality governor, and `prefers-reduced-motion` handling.

## Interaction

- **Load** — the Turing core ignites outward with an expanding chromatic ring while radiating symmetric vortex jets into the surrounding fluid as the text sharpens into place.
- **Move cursor or drag finger** — injects momentum and iridescent dye into the fluid; sweeping across the core perturbs surface waves.
- **Click or tap** — clicking the central core triggers a standing wave + fresh chemical seed and blasts rim jets outward; clicking surrounding space injects a vortex dipole.
- **Tilt a phone** — shifts camera parallax gently without requesting extra sensor permissions.
- **Hover or focus a button** — shifts the Gray-Scott `(F, k)` phase regime and fluid palette mood (`LinkedIn` cyan-indigo vs `Spotify` emerald-violet) while buttons remain stationary.

## Graceful degradation & accessibility

1. **WebGL2 (Full)** — 32-step 3D SDF raymarch + 3,200 tracers + `1.5` max DPR.
2. **Quality Governor** — steps down `maxDpr`, raymarch steps, tracer count, and PDE substeps if FPS drops below threshold.
3. **Canvas 2D Fallback** — automatically activates when WebGL2 is unavailable or context is lost.
4. **`prefers-reduced-motion`** — renders a single settled static frame with no animation loop.

## Tests

```
npm test
```

Headless Node checks for adaptive fluid sizing, morphogenetic core-to-fluid emission, viscous fluid-to-core torque coupling, core/fluid clicks, mood-driven Gray-Scott phase steering, 120-step soak stability (0 NaNs, low divergence, active morphogenesis), `< 1.0 ms/frame` CPU update budget, and WebGL2 `#version 300 es` shader integrity.
