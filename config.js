// config.js
// Central tuning knobs for the coupled Navier-Stokes fluid solver, Gray-Scott
// Turing morphogenesis core, wave PDE, 3D hyperspace starfield, interactions,
// and quality governor.

export const config = {
    // --- Navier-Stokes Fluid Grid --------------------------------------------
    FLUID_TARGET_CELLS: 3800,   // isotropic cell budget across aspect ratios
    FLUID_MIN_AXIS: 42,
    FLUID_MAX_ASPECT: 2.2,
    FLUID_PRESSURE_ITERS: 4,    // warm-started Red-Black SOR passes
    FLUID_SOR_OMEGA: 1.48,      // successive over-relaxation factor
    FLUID_VORTICITY: 2.3,       // curl confinement strength
    FLUID_VEL_DAMP: 0.992,
    FLUID_DYE_DAMP: 0.986,
    FLUID_MAX_VEL: 48,
    FLUID_POINTER_FORCE: 460,
    FLUID_BURST_FORCE: 26,

    // --- Tapered Fluid Streamlines -------------------------------------------
    TRACER_COUNT: 2400,
    TRACER_STREAK_SCALE: 7.5,
    TRACER_LIFE_MIN: 1.8,
    TRACER_LIFE_MAX: 4.2,

    // --- 3D Hyperspace Starfield ---------------------------------------------
    STAR_COUNT: 640,
    STAR_CRUISE_SPEED: 0.028,   // calm layered drift per second
    STAR_WARP_BOOST: 8.0,       // load deceleration multiplier
    STAR_WARP_DECAY: 2.0,
    STAR_LENS_STRENGTH: 0.05,   // subtle optical bending around core rim

    // --- Turing Morphogenesis + Wave PDE Core --------------------------------
    TURING_W: 96,
    TURING_H: 64,
    GS_DU: 0.16,
    GS_DV: 0.08,
    GS_SUBSTEPS: 2,
    GS_WARMUP_INIT: 165,
    GS_WARMUP_IGNITE: 55,
    // Phase-diagram presets steered smoothly by button hover mood
    GS_F_BASE: 0.037,
    GS_K_BASE: 0.060,
    GS_F_LINKEDIN: 0.045,
    GS_K_LINKEDIN: 0.062,
    GS_F_SPOTIFY: 0.027,
    GS_K_SPOTIFY: 0.056,
    WAVE_C2: 0.18,              // strictly CFL-stable (<= 0.5)
    WAVE_DAMP: 0.974,
    WAVE_CLAMP: 1.5,

    // --- 3D Core Projection & Bidirectional Physical Coupling ----------------
    CORE_SPIN_RAD_S: 0.042,
    CORE_CAM_Z: 4.35,
    CORE_CAM_FOV: 1.35,
    CORE_WORLD_RADIUS: 0.88,
    CORE_FLUID_RADIUS_FRAC: 0.285,
    CORE_NARROW_ASPECT: 0.8,
    CORE_NARROW_SCALE: 1.18,
    CORE_RIM_EMITTERS: 20,      // Turing limb sampling sites exhaling into fluid
    CORE_EMIT_FORCE: 20,
    CORE_EMIT_DYE: 0.56,
    CORE_TORQUE_GAIN: 0.0014,   // viscous tangential fluid torque -> core spin
    CORE_SPIN_RESTORE: 1.15,
    CORE_SPIN_MAX: 0.72,
    CORE_RIM_NUTRIENT: 0.016,   // rim shear feeds Turing morphogenesis & waves

    // --- Curated Celestial Luxury Palette ------------------------------------
    PALETTE: [
        '#4a7dff', '#72d8ff', '#b8e8ff', '#8d6bff',
        '#c4a6ff', '#5be0d6', '#e8c7a8', '#6898ff',
    ],

    // --- Camera / Input / Page Choreography ----------------------------------
    PARALLAX_EASE: 4.5,
    TILT_RANGE_DEG: 22,
    TILT_RECENTER: 0.004,
    FONT_WAIT_MS: 900,
    HINT_TIMEOUT_MS: 9000,
    RESIZE_DEBOUNCE_MS: 180,
    ORIENTATION_DEBOUNCE_MS: 250,
    BUTTON_PULSE_COOLDOWN_MS: 900,

    // --- Quality Governor (steps down once if FPS drops below target) --------
    MAX_DPR: 1.5,
    CORE_MARCH_STEPS: 28,
    QUALITY_SAMPLE_S: 1.5,
    QUALITY_GRACE_S: 1.8,
    QUALITY_MIN_FPS: 46,
    QUALITY_STEPS: [
        { maxDpr: 1.15, marchSteps: 24, tracers: 1500, gsSubsteps: 2, pressureIters: 4, bloom: true },
        { maxDpr: 0.88, marchSteps: 20, tracers: 800, gsSubsteps: 1, pressureIters: 3, bloom: false },
        { maxDpr: 0.72, marchSteps: 18, tracers: 400, gsSubsteps: 1, pressureIters: 3, bloom: false },
    ],
};
