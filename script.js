// main entry for Network Simulation
import { Network, networkEffects } from './network.js';
import { renderNetwork } from './renderer.js';

// Configuration
const CONFIG = {
    TARGET_TPS: 50,           // Target ticks per second
    FRAME_TIME: 1000 / 50,    // Target time per frame in ms
    PACKET_EMIT_CHANCE: 0.06  // Chance to emit a packet each frame
};

let networkInstance;
let animationFrame;
let lastFrameTime = 0;       // Time of the last processed frame

function setup() {
    console.log('[Script] setup called');
    const canvas = document.getElementById('background-canvas');
    if (!canvas) {
        console.error('Canvas element not found!');
        return;
    }
    const ctx = canvas.getContext('2d');

    function resizeCanvas() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        
        // Resize network without regenerating it
        if (networkInstance) {
            networkInstance.resizeCanvas(canvas.width, canvas.height);
        }
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Initialize network
    networkInstance = new Network(canvas.width, canvas.height, 12);

    // Animation loop
    let lastTime = performance.now();
    function advanceEffects(dt) {
        networkEffects.ripples.forEach(r => r.time += dt);
        networkEffects.blinks.forEach(b => b.time += dt);
        networkEffects.ripples = networkEffects.ripples.filter(r => r.time < 0.7);
        networkEffects.blinks = networkEffects.blinks.filter(b => b.time < 0.5);
    }
    function animate(now) {
        // Request next frame immediately to avoid delays
        animationFrame = requestAnimationFrame(animate);
        
        // Calculate time since last frame
        const elapsed = now - lastFrameTime;
        
        // Skip frame if not enough time has passed (throttle to TARGET_TPS)
        if (elapsed < CONFIG.FRAME_TIME) {
            return;
        }
        
        // Calculate delta time, capped to avoid large jumps
        const dt = Math.min((now - lastTime) / 1000, 0.1);
        lastTime = now;
        lastFrameTime = now;
        
        // Randomly emit packets
        if (Math.random() < CONFIG.PACKET_EMIT_CHANCE) {
            networkInstance.sendRandomPacket();
        }
        
        // Update simulation
        advanceEffects(dt);
        networkInstance.updateNodePositions(dt); // Update node positions with gentle movement
        networkInstance.updatePackets(dt, networkEffects);
        
        // Render frame
        renderNetwork(ctx, networkInstance);
    }
    animate(lastTime);

    window.addEventListener('beforeunload', function() {
        cancelAnimationFrame(animationFrame);
    });
}

document.addEventListener('DOMContentLoaded', setup);
