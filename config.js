// config.js
// All tuning knobs for the background network simulation.

export const config = {
    // --- Layout ------------------------------------------------------------
    // Node spacing is derived from the viewport area and clamped to this
    // range, so density feels the same from phones up to large monitors.
    SPACING_AREA_DIVISOR: 130,
    SPACING_MIN: 88,
    SPACING_MAX: 150,
    JITTER: 0.36,              // node offset from its grid point (fraction of a cell)
    EXTRA_EDGE_KEEP: 0.5,      // share of non-spanning-tree edges kept when thinning
    LONG_EDGE_FACTOR: 1.9,     // drop non-tree edges longer than spacing * factor

    // --- Node drift (always kept below the computed no-crossing bound) ------
    DRIFT_MAX_FRAC: 0.085,     // max drift radius as a fraction of node spacing
    DRIFT_SAFETY: 0.45,        // fraction of the geometric safety margin actually used
    DRIFT_FREQ_MIN: 0.05,      // Hz
    DRIFT_FREQ_MAX: 0.12,

    // --- Colours -------------------------------------------------------------
    BG_TOP: '#05070d',
    BG_BOTTOM: '#0b1120',
    BG_CENTER_GLOW: 'rgba(64, 105, 180, 0.07)',
    VIGNETTE: 'rgba(0, 0, 0, 0.38)',
    EDGE_RGB: [126, 160, 215],
    EDGE_ALPHA: 0.17,
    EDGE_WIDTH: 1,
    NODE_ALPHA_MIN: 0.35,
    NODE_ALPHA_MAX: 0.8,
    NODE_RADIUS_MIN: 1.4,
    NODE_RADIUS_MAX: 2.8,
    // Nodes get pastel rainbow tints: a hue gradient sweeps across the
    // screen (so neighbours harmonise) with per-node jitter on top.
    NODE_HUE_SPAN: 360,        // degrees of hue across the diagonal
    NODE_HUE_JITTER: 28,
    NODE_HUE_SAT: 0.55,
    NODE_HUE_LIGHT: 0.8,
    HUB_DEGREE: 6,             // nodes with at least this many links get a faint halo
    HUB_GLOW_ALPHA: 0.1,
    HALO_COLOR: '#7fb4ff',
    HUB_BREATH_AMP: 0.5,       // px of slow radius breathing on hubs
    HUB_BREATH_FREQ: 0.18,     // Hz

    // --- Twinkle ---------------------------------------------------------------
    TWINKLE_FREQ_MIN: 0.1,     // Hz
    TWINKLE_FREQ_MAX: 0.25,
    TWINKLE_DEPTH: 0.5,        // how much of a node's brightness oscillates

    // --- Edge shimmer (slow brightness wave travelling across the mesh) ---------
    SHIMMER_DEPTH: 0.35,       // +- fraction of the base edge alpha
    SHIMMER_WAVELENGTH: 700,   // px
    SHIMMER_SPEED: 60,         // px/s of wave travel
    SHIMMER_BUCKETS: 5,        // alpha quantisation steps (keeps strokes batched)

    // --- Signals (packets routed along shortest paths) ---------------------------
    SIGNAL_MAX: 8,
    SIGNAL_SPAWN_MIN_S: 0.45,
    SIGNAL_SPAWN_MAX_S: 1.1,
    SIGNAL_SPEED_MIN: 120,     // px / s
    SIGNAL_SPEED_MAX: 190,
    SIGNAL_HOPS_MIN: 4,
    SIGNAL_HOPS_MAX: 9,
    // Full rainbow, in hue order: each signal cycles one step per node pass.
    SIGNAL_COLORS: ['#ff5d6c', '#ff9f43', '#ffd93d', '#6dd95f', '#34e5c2',
        '#59d7ff', '#6fa8ff', '#a78bff', '#ff7ad9'],
    SIGNAL_LAUNCH_DELAY_S: 0.22, // charge-up pause at the source before launching
    SIGNAL_EASE: 0.6,          // 0 = linear hops, 1 = full ease-in-out per hop
    SIGNAL_HARD_CAP: 14,       // absolute limit including cascades and click bursts
    CASCADE_CHANCE: 0.35,      // chance an arrival relays a follow-up signal
    CASCADE_MAX_GEN: 2,
    EDGE_LIT_DECAY_S: 0.55,    // time constant of the fading trail
    NODE_LIT_DECAY_S: 0.4,

    // --- Arrival effects ----------------------------------------------------------
    RING_DURATION_S: 0.9,
    RING_RADIUS_FROM: 5,
    RING_RADIUS_TO: 30,
    RING_ALPHA: 0.5,
    RING_ECHO_DELAY_S: 0.12,   // second, fainter ring shortly after the first
    RING_ECHO_ALPHA_SCALE: 0.5,
    SPARK_COUNT: 6,
    SPARK_SPEED: 90,           // initial px/s
    SPARK_DECEL: 3.5,          // 1/s velocity decay
    SPARK_DURATION_S: 0.55,

    // --- Dust (tiny far particles, neutral grey) -------------------------------------
    DUST_AREA_PER_PARTICLE: 26000,
    DUST_COLOR: [185, 192, 204],
    DUST_SPEED_MIN: 2,         // px / s, slow upward drift
    DUST_SPEED_MAX: 7,

    // --- Bokeh (large soft out-of-focus discs, pastel rainbow) -----------------------
    BOKEH_AREA_PER: 100000,
    BOKEH_COLORS: ['#ff8fa3', '#ffc46b', '#ffe66b', '#7fe08a', '#5fe3c4',
        '#66c9ff', '#8aa8ff', '#c39bff', '#ff9ae0'],
    BOKEH_R_MIN: 9,
    BOKEH_R_MAX: 26,
    BOKEH_ALPHA_MIN: 0.04,
    BOKEH_ALPHA_MAX: 0.1,
    BOKEH_DRIFT: 2,            // max wander speed, px/s
    FG_BOKEH_COUNT: 8,         // big foreground discs on the main canvas
    FG_BOKEH_R_MIN: 16,
    FG_BOKEH_R_MAX: 36,
    FG_BOKEH_ALPHA_MIN: 0.04,
    FG_BOKEH_ALPHA_MAX: 0.08,

    // --- Stars: very subtle particles flying slowly towards the viewer ----------------
    STAR_AREA_PER: 160000,     // one star per this many px^2 (capped in code)
    STAR_MAX: 24,
    STAR_SPEED_MIN: 0.012,     // depth units per second (a crossing takes ~40 s)
    STAR_SPEED_MAX: 0.03,
    STAR_R_MIN: 0.5,
    STAR_R_MAX: 1.1,
    STAR_ALPHA_MIN: 0.08,
    STAR_ALPHA_MAX: 0.2,
    STAR_COLORS: ['#cfe4ff', '#eaf6ff', '#ffd9e8', '#d9ffe3', '#fff3c4'],

    // --- Depth layer (blurred canvas behind the main one; monochrome & faint) --------
    DEPTH_SPACING_SCALE: 0.55, // denser, smaller cells: reads as further away
    DEPTH_RES_SCALE: 0.66,     // internal resolution of the depth canvas
    DEPTH_EDGE_RGB: [205, 210, 220],
    DEPTH_EDGE_ALPHA: 0.09,
    DEPTH_NODE_SCALE: 0.8,
    DEPTH_NODE_ALPHA: 0.5,
    DEPTH_SIGNAL_COLORS: ['#eef1f6', '#c9cfd9', '#ffffff'], // greys only
    DEPTH_BOKEH_COLORS: ['#e8ecf2', '#ffffff', '#c5cad2'],
    DEPTH_BOKEH_ALPHA_SCALE: 0.7,
    DEPTH_HALO_COLOR: '#dfe5ee',
    DEPTH_LIT_SCALE: 0.55,     // trail brightness multiplier for the back layer
    DEPTH_SIGNAL_MAX: 4,
    DEPTH_SPAWN_MIN_S: 1.4,
    DEPTH_SPAWN_MAX_S: 3,
    DEPTH_SPEED_SCALE: 0.55,
    DEPTH_RING_SCALE: 0.6,

    // --- Camera: pointer parallax + sway + continuous slow rotation -------------------
    PARALLAX_PX: 8,            // px of shift when the cursor reaches a screen edge
    PARALLAX_EASE: 3,          // lerp speed, 1/s
    SWAY_AMP: 5,               // px of slow always-on camera sway
    SWAY_FREQ: 0.022,          // Hz
    ROT_SPEED_DEG_S: 0.75,     // continuous rotation; one revolution in ~8 minutes
    OFFSET_DUST: 0.25,         // per-layer multipliers of the camera offset
    OFFSET_DEPTH: 0.4,
    OFFSET_MAIN: 1,
    OFFSET_FG: 1.6,
    ROT_MAIN: 1,               // per-layer multipliers of the camera rotation
    ROT_DEPTH: -0.6,           // counter-rotation enhances the depth illusion

    // --- Pointer --------------------------------------------------------------------
    HOVER_RADIUS: 150,
    HOVER_NODE_BOOST: 0.6,     // extra brightness / radius for nodes near the cursor
    CLICK_RADIUS: 240,         // a click fires a burst from the nearest node within this
    CLICK_BURST: 3,            // signals emitted per click

    MAX_DPR: 2,
};
