# voho.github.io

Personal landing page served at [voho.eu](http://voho.eu) via GitHub Pages.

Static site with no build step: `index.html` + `styles.css` + ES modules.

## Background animation

Two canvas layers render a network simulation:

- `config.js` — every tunable in one place (colours, densities, speeds,
  camera, interactions). Start here to adjust the look.
- `network.js` — graph construction and simulation state. Nodes sit on a
  jittered grid triangulated with Bowyer–Watson Delaunay (planar by
  construction, so edges never cross), thinned while keeping a spanning
  tree. Node drift stays inside a per-layout clearance bound, so crossings
  remain impossible while the mesh breathes.
- `renderer.js` — draws both layers. The back layer is monochrome,
  rendered at reduced resolution and blurred with CSS for depth of field;
  the front layer carries the rainbow signals, sparks and rings.
- `script.js` — canvas sizing, the camera (pointer parallax, sway, slow
  continuous rotation), click bursts, button-hover flares, the animation
  loop and reduced-motion handling.

Signals route along BFS shortest paths and step through the palette at
every node pass. Click anywhere to fire a burst from the nearest node.

## Tests

```
npm test
```

Headless Node checks: planarity (no crossing edges, also during a
simulated soak), rotation-circle coverage, connectivity, palette
invariants and the per-frame update budget.
