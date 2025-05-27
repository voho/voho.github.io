// main entry for Network Simulation
import { Network } from './network.js';
import { renderNetwork } from './renderer.js';
import { config } from './config.js';

let networkInstance;
let networkInstance2; // For the second canvas
let animationFrame;

function setup() {
    if (config.DEBUG_MODE) console.log('[Script] setup called');
    const canvas1 = document.getElementById('background-canvas');
    const canvas2 = document.getElementById('background-canvas-2'); // Get second canvas

    if (!canvas1 || !canvas2) {
        console.error('One or both canvas elements not found!');
        return;
    }
    const ctx1 = canvas1.getContext('2d');
    const ctx2 = canvas2.getContext('2d'); // Get context for second canvas

    function resizeCanvas() {
        const width = window.innerWidth;
        const height = window.innerHeight;

        canvas1.width = width;
        canvas1.height = height;
        networkInstance = new Network(width, height);

        canvas2.width = width;
        canvas2.height = height;
        networkInstance2 = new Network(width, height); 
        // We can use different config for the second network if needed by passing a modified config object to its constructor
        // For now, it will use the same global 'config'
    }
    resizeCanvas(); // Initial call to set size and create networks
    window.addEventListener('resize', resizeCanvas);

    // Animation loop
    let lastTime = performance.now();

    function animate(now) {
        // Request next frame immediately to avoid delays
        animationFrame = requestAnimationFrame(animate);
        
        // Calculate delta time, capped to avoid large jumps
        const dt = Math.min((now - lastTime) / 1000, 0.1);
        lastTime = now;
        
        // --- Network 1 --- 
        if (Math.random() < config.PACKET_EMIT_CHANCE) {
            networkInstance.sendRandomPacket();
        }
        networkInstance.advanceEffects(dt);
        networkInstance.updateNodePositions(dt);
        networkInstance.updatePackets(dt);
        renderNetwork(ctx1, networkInstance, now);

        // --- Network 2 --- 
        // Potentially different emit chance or conditions for the second network
        if (Math.random() < config.PACKET_EMIT_CHANCE * 0.7) { // Example: slightly fewer packets for 2nd network
            networkInstance2.sendRandomPacket();
        }
        networkInstance2.advanceEffects(dt);
        networkInstance2.updateNodePositions(dt); // Could have different movement patterns if desired
        networkInstance2.updatePackets(dt);
        renderNetwork(ctx2, networkInstance2, now);
    }
    animate(lastTime);

    window.addEventListener('beforeunload', function() {
        cancelAnimationFrame(animationFrame);
    });
}

document.addEventListener('DOMContentLoaded', setup);
