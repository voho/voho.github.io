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
    DRIFT_MAX_FRAC: 0.055,     // max drift radius as a fraction of node spacing
    DRIFT_SAFETY: 0.45,        // fraction of the geometric safety margin actually used
    DRIFT_FREQ_MIN: 0.04,      // Hz
    DRIFT_FREQ_MAX: 0.09,

    // --- Colours -------------------------------------------------------------
    BG_TOP: '#05070d',
    BG_BOTTOM: '#0b1120',
    BG_CENTER_GLOW: 'rgba(64, 105, 180, 0.07)',
    VIGNETTE: 'rgba(0, 0, 0, 0.38)',
    EDGE_COLOR: 'rgba(126, 160, 215, 0.16)',
    EDGE_WIDTH: 1,
    NODE_COLOR: [188, 214, 255],
    NODE_ALPHA_MIN: 0.35,
    NODE_ALPHA_MAX: 0.8,
    NODE_RADIUS_MIN: 1.4,
    NODE_RADIUS_MAX: 2.8,
    HUB_DEGREE: 6,             // nodes with at least this many links get a faint halo
    HUB_GLOW_ALPHA: 0.1,

    // --- Twinkle ---------------------------------------------------------------
    TWINKLE_FREQ_MIN: 0.1,     // Hz
    TWINKLE_FREQ_MAX: 0.25,
    TWINKLE_DEPTH: 0.45,       // how much of a node's brightness oscillates

    // --- Signals (packets routed along shortest paths) ---------------------------
    SIGNAL_MAX: 3,
    SIGNAL_SPAWN_MIN_S: 0.9,
    SIGNAL_SPAWN_MAX_S: 2.2,
    SIGNAL_SPEED_MIN: 120,     // px / s
    SIGNAL_SPEED_MAX: 190,
    SIGNAL_HOPS_MIN: 4,
    SIGNAL_HOPS_MAX: 9,
    SIGNAL_COLORS: ['#59d7ff', '#6fa8ff', '#9f8cff'],
    SIGNAL_ACCENT: '#c77dff',
    SIGNAL_ACCENT_CHANCE: 0.18,
    EDGE_LIT_DECAY_S: 0.55,    // time constant of the fading trail
    NODE_LIT_DECAY_S: 0.4,

    // --- Arrival rings ------------------------------------------------------------
    RING_DURATION_S: 0.9,
    RING_RADIUS_FROM: 5,
    RING_RADIUS_TO: 30,
    RING_ALPHA: 0.5,

    // --- Dust (far parallax layer; particles only, so nothing there can cross) -----
    DUST_AREA_PER_PARTICLE: 26000,
    DUST_COLOR: [150, 185, 235],
    DUST_SPEED_MIN: 2,         // px / s, slow upward drift
    DUST_SPEED_MAX: 7,

    // --- Pointer --------------------------------------------------------------------
    HOVER_RADIUS: 150,
    HOVER_NODE_BOOST: 0.6,     // extra brightness / radius for nodes near the cursor
    PARALLAX_NEAR: 7,          // px, mesh shift when the cursor reaches a screen edge
    PARALLAX_FAR: 2.5,         // px, dust shift (smaller = feels further away)
    PARALLAX_EASE: 3,          // lerp speed, 1/s

    MAX_DPR: 2,
};
