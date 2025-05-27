// main entry for Network Simulation
import { Network, networkEffects } from './network.js';
import { renderNetwork } from './renderer.js';

// Configuration
const CONFIG = {
    TARGET_TPS: 50,           // Target ticks per second (less relevant for rendering now)
    FRAME_TIME: 1000 / 50,    // Target time per frame in ms (less relevant for rendering now)
    PACKET_EMIT_CHANCE: 0.06  // Chance to emit a packet each frame
};

let networkInstance;
let animationFrame;

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
        
        if (networkEffects.processingFlashes.length > 0) {
            console.log('[script.js] Advancing processingFlashes. Count:', networkEffects.processingFlashes.length);
        }
        networkEffects.processingFlashes.forEach(pf => {
            pf.time += dt;
            // console.log('[script.js] Flash node', pf.node.id, 'time:', pf.time.toFixed(3)); // Can be too verbose
        });

        networkEffects.ripples = networkEffects.ripples.filter(r => r.time < 0.7); // Corresponds to RIPPLE_DURATION
        networkEffects.blinks = networkEffects.blinks.filter(b => b.time < 0.5); // Corresponds to BLINK_DURATION
        // Duration for processing flash will be defined in renderer.js (e.g., 0.3s)
        // For now, using a hardcoded value, ensure it matches renderer.js VISUAL.PROCESSING_FLASH_DURATION
        const initialFlashCount = networkEffects.processingFlashes.length;
        networkEffects.processingFlashes = networkEffects.processingFlashes.filter(pf => pf.time < 0.3);
        if (initialFlashCount > 0 && networkEffects.processingFlashes.length < initialFlashCount) {
            console.log('[script.js] Filtered processingFlashes. Remaining:', networkEffects.processingFlashes.length);
        }
    }
    function animate(now) {
        // Request next frame immediately to avoid delays
        animationFrame = requestAnimationFrame(animate);
        
        // Calculate delta time, capped to avoid large jumps
        const dt = Math.min((now - lastTime) / 1000, 0.1);
        lastTime = now;
        
        // Randomly emit packets
        if (Math.random() < CONFIG.PACKET_EMIT_CHANCE) {
            networkInstance.sendRandomPacket();
        }
        
        // Update simulation
        advanceEffects(dt);
        networkInstance.updateNodePositions(dt); // Update node positions with gentle movement
        networkInstance.updatePackets(dt, networkEffects);
        
        // Render frame
        renderNetwork(ctx, networkInstance, now);
    }
    animate(lastTime);

    window.addEventListener('beforeunload', function() {
        cancelAnimationFrame(animationFrame);
    });
}

document.addEventListener('DOMContentLoaded', setup);
