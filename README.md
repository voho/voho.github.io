# voho.github.io

Personal landing page served at [voho.eu](http://voho.eu) via GitHub Pages.

Static site with no build step: `index.html` + `styles.css` + ES modules.

## Background animation

Two canvas layers render a network simulation:

- `config.js` — every tunable in one place (colours, densities, speeds,
  camera, interactions, quality tiers). Start here to adjust the look.
- `network.js` — graph construction and simulation state. Nodes sit on a
  jittered grid triangulated with Bowyer–Watson Delaunay (planar by
  construction, so edges never cross), thinned while keeping a spanning
  tree. Node drift stays inside a per-layout clearance bound, so crossings
  remain impossible while the mesh breathes. Spacing follows the viewport
  area but is capped so narrow phones still get a fine mesh rather than a
  few huge triangles.
- `renderer.js` — draws both layers. The back layer is monochrome, carries
  the aurora, and is rendered at reduced resolution and blurred with CSS
  for depth of field; the front layer carries the rainbow signals, sparks,
  rings and the pointer torch.
- `script.js` — canvas sizing, the camera (pointer/touch/tilt parallax,
  sway, slow continuous rotation), input, the load choreography, magnetic
  buttons, the animation loop, the quality governor and reduced-motion
  handling.

Signals route along BFS shortest paths and step through the palette at
every node pass.

## Interaction

- **Load** — a wavefront expands from the centre and lights the whole mesh
  in rainbow bands while the text rises into it.
- **Click or tap anywhere** to fire a burst from the nearest node.
- **Move the cursor, or drag a finger**, to sweep a torch across the web:
  nearby edges and nodes brighten. Touch uses touch events rather than
  pointer events, because browsers fire `pointercancel` as soon as they
  consider claiming a drag for a scroll.
- **Tilt a phone** to steer the camera. The sensor is used only where the
  browser hands it over; no permission is ever requested.
- **Hover or focus a button** and flares stream out of the mesh behind it;
  on a fine pointer the buttons also lean towards the cursor.

## Performance

The far layer renders every other frame behind its blur. Beyond that the
scene watches its own frame rate and, after a grace period, degrades once
in steps — thinner depth updates, then the foreground bokeh, the torch and
the pixel ratio. It never upgrades again, so quality cannot oscillate. The
loop stops entirely while the page is hidden.

`prefers-reduced-motion` renders a single static frame instead: no loop,
no ignition, no parallax.

## Tests

```
npm test
```

Headless Node checks: planarity (no crossing edges, also during a
simulated soak), rotation-circle coverage, connectivity, mesh density on
narrow viewports, the ignition wave, targeted flares, palette invariants
and the per-frame update budget.
