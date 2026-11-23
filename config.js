// config.js
// Central tunables for the relativistic Black Hole background simulation.

export const config = {
    // --- Three Spacetime / Accretion Presets -------------------------------
    // Hovering links smoothly glides weights and orientation toward 1 or 2,
    // returning to 0 (M87* Horizon) on leave while keeping sky stars anchored.
    VARIANTS: [
        {
            id: 0,
            name: 'M87* Horizon',
            tilt: 1.15,
            roll: 0.06,
            spin: 0.22,
            gm: 5.2,
            drag: 0.18,
        },
        {
            id: 1,
            name: 'Gargantua',
            tilt: 0.16,
            roll: -0.15,
            spin: 0.10,
            gm: 4.8,
            drag: 0.16,
        },
        {
            id: 2,
            name: 'Cygnus X-1',
            tilt: 0.34,
            roll: 0.24,
            spin: 0.52,
            gm: 5.5,
            drag: 0.20,
        },
    ],

    // --- Camera & Framing ----------------------------------------------------
    CAM_DIST: 15.2,
    CAM_FOV: 1.46,
    NARROW_ASPECT: 0.8,
    NARROW_CAM_DIST: 17.6,
    BH_MORPH_RATE: 2.8,
    PARALLAX_YAW: 0.10,
    PARALLAX_PITCH: 0.07,
    PARALLAX_EASE: 4.5,
    // Slow autonomous camera sway (in parallax units) so the scene is never frozen.
    DRIFT_X: 0.22,
    DRIFT_Y: 0.16,
    // The camera starts this fraction further out and flies in on load.
    INTRO_PULLBACK: 0.42,
    INTRO_EASE: 1.1,

    // --- Relativistic Absorbed Particles (Paczynski-Wiita Potential) ---------
    MAX_PARTICLES: 1000,
    PARTICLE_CAPTURE_R: 1.48,
    PARTICLE_AMBIENT_RATE: 12,
    PARTICLE_MAX_AGE: 15,
    CLICK_BURST_COUNT: 28,
    IGNITE_BURST_COUNT: 64,
    HOLD_EMIT_RATE: 72,
    BUTTON_PULSE_COUNT: 12,
    BUTTON_PULSE_COOLDOWN_MS: 320,

    // --- WebGL2 Geodesic Raymarch, Dust & Bloom ----------------------------
    BH_MARCH_STEPS: 72,
    MAX_DPR: 1.5,
    DUST_COUNT: 18000,
    BLOOM_LEVELS: 5,
    BLOOM_STRENGTH: 0.9,

    // --- Adaptive Quality Governor (see quality.js) --------------------------
    // The scene renders at canvas size x scale and is upscaled on composite.
    SCALE_START: 1.0,
    SCALE_START_LOW_POWER: 0.7,
    SCALE_MIN: 0.5,
    SCALE_DOWN: 0.8,
    SCALE_UP: 1.15,
    QUALITY_GRACE_S: 2.2,
    QUALITY_SAMPLE_S: 1.0,
    QUALITY_SLOW: 0.8,       // below this fraction of the target fps: step down
    QUALITY_GOOD: 0.95,      // above this fraction: counts toward stepping up
    QUALITY_PROBE_S: 5,      // steady seconds before trying a step up
    QUALITY_PROBE_MAX_S: 80, // a failed step up doubles the wait, up to this
    // Applied on top of the minimum scale when even that cannot hold frame rate.
    LITE: { marchSteps: 44, bloom: false, dust: 5000, maxParticles: 500 },

    // --- UI Timing & Device Tilt ---------------------------------------------
    RESIZE_DEBOUNCE_MS: 180,
    ORIENTATION_DEBOUNCE_MS: 220,
    HINT_TIMEOUT_MS: 7500,
    FONT_WAIT_MS: 650,
    TILT_RANGE_DEG: 28,
    TILT_RECENTER: 0.015,
};
