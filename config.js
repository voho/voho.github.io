// config.js
// Centralized configuration for the Network Simulation

export const config = {
    // General Settings
    DEBUG_MODE: false,
    CANVAS_BACKGROUND_COLOR: 'rgba(10, 15, 25, 1)', // Dark blue-ish background

    // Network Generation
    NUM_NODES: 100,                   // Number of nodes in the network (approximate for lattice)
    LATTICE_NOISE_FACTOR: 0.6,      // Max deviation from grid point (0 = perfect grid, 1 = up to cell center)
    EDGES_PER_NODE_MIN: 1,          // Min random edges a node will try to create
    EDGES_PER_NODE_MAX: 2,          // Max random edges a node will try to create

    // Node Visuals
    NODE_RADIUS: 8,
    NODE_COLOR: 'rgba(100, 150, 255, 0.9)',
    NODE_BORDER_COLOR: 'rgba(200, 200, 255, 1)',
    NODE_BORDER_WIDTH: 2,
    NODE_SHADOW_COLOR: 'rgba(0, 0, 0, 0.5)',
    NODE_SHADOW_BLUR: 5,
    ENABLE_NODE_SHADOWS: false, // Set to true to enable node shadows (can impact performance)
    NODE_SELECTED_COLOR: 'rgba(255, 255, 100, 1)',
    NODE_BREATHING_SPEED: 1000, // Divisor for 'now' in breathing effect (larger = slower)
    NODE_BREATHING_AMPLITUDE: 1, // Pixel amplitude for breathing (added back)

    // Node Movement & Interaction
    NODE_ACCELERATION: 0,        // Set to 0 for static lattice
    NODE_MAX_SPEED: 0.3,           // Max speed (if acceleration > 0)
    NODE_DAMPING: 0.95,            // Damping factor (if acceleration > 0)

    // Packet Behavior
    PACKET_RADIUS: 3,
    PACKET_MAX_HOPS: 3,       // Maximum redirects before removal
    PACKET_SPEED: 0.5,        // Movement speed (progress units per second, 1 means full edge in 1s)
    PACKET_EMIT_CHANCE: 0.1, // Chance per frame to emit a packet (Increased from 0.05)
    PACKET_COLOR: 'rgba(255, 100, 100, 1)', // Color of packets

    // Visuals: Edges
    EDGE_COLOR: 'rgba(60,60,60,0.9)',
    EDGE_WIDTH: 5,

    // Visuals & Durations: Ripples
    RIPPLE_DURATION_SECONDS: 0.7,
    RIPPLE_BASE_RADIUS: 22,
    RIPPLE_EXPANSION_RATE: 44, // How much radius increases per second
    RIPPLE_WIDTH: 5,
    RIPPLE_ALPHA_START: 0.5,
    RIPPLE_TARGET_SPACING: 10,

    // Visuals & Durations: Blinks (Packet Removal Effect)
    BLINK_DURATION_SECONDS: 0.5,
    BLINK_RADIUS: 26,
    BLINK_COLOR: 'red',
    BLINK_WIDTH: 8,
    BLINK_SHADOW_BLUR: 15,
    BLINK_ALPHA_START: 0.7,

    // Visuals & Durations: Processing Flash (Node Rerouting Packet)
    PROCESSING_FLASH_DURATION_SECONDS: 0.3,
    PROCESSING_FLASH_COLOR: 'rgba(255, 255, 150, 0.7)',
    PROCESSING_FLASH_RADIUS_FACTOR: 1.3, // Multiplier of NODE_RADIUS
    PROCESSING_FLASH_SHADOW_BLUR: 7,

    // Visuals & Durations: Node Connection Pulses
    NODE_PULSE_DURATION_SECONDS: 0.5,    // How long the pulse effect lasts
    NODE_PULSE_MAX_RADIUS_FACTOR: 1.8,   // Pulse expands to NodeRadius * this factor
    NODE_PULSE_LINE_WIDTH: 3,
    NODE_PULSE_SEND_COLOR: 'rgba(120, 255, 120, 0.7)', // Light green for sending
    NODE_PULSE_RECEIVE_FINAL_COLOR: 'rgba(120, 120, 255, 0.7)', // Light blue for final reception
    NODE_PULSE_ROUTE_COLOR: 'rgba(255, 180, 80, 0.8)', // Warm yellow/orange for routing
};

// Derived values for convenience
config.RIPPLE_FADE_PER_SECOND = (config.RIPPLE_ALPHA_START - 0) / config.RIPPLE_DURATION_SECONDS;
config.BLINK_ALPHA_CURVE_FACTOR = 1 / (config.BLINK_DURATION_SECONDS * config.BLINK_DURATION_SECONDS); // For quadratic fade
config.PROCESSING_FLASH_FADE_PER_SECOND = 1 / config.PROCESSING_FLASH_DURATION_SECONDS;

console.log('config.js loaded');
