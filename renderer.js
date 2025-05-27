// renderer.js
// Handles drawing the network on the canvas

import { config } from './config.js'; // Added import for new config

/**
 * Main rendering function for the network
 * @param {CanvasRenderingContext2D} ctx - Canvas rendering context
 * @param {Object} network - Network object containing nodes, edges, and packets
 * @param {number} now - Current timestamp from performance.now() for animations
 */
export function renderNetwork(ctx, network, now) {
    // Clear canvas
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // Draw all elements in correct order (back to front)
    drawBlinks(ctx, network.effects.blinks);
    drawProcessingFlashes(ctx, network.effects.processingFlashes);
    drawEdges(ctx, network.edges);
    drawPackets(ctx, network.packets);
    drawNodes(ctx, network.nodes, now, network.effects.nodePulses); // Pass nodePulses
    drawNodePulses(ctx, network.effects.nodePulses);
}

/**
 * Draw blink effects (for packet removal)
 * @param {CanvasRenderingContext2D} ctx - Canvas rendering context
 * @param {Array} blinks - Array of blink effect objects
 */
function drawBlinks(ctx, blinks) {
    if (!blinks) return;
    for (const {node, time} of blinks) {
        // Alpha calculation using the derived curve factor for smooth fade in/out
        const timeFactor = time * config.BLINK_ALPHA_CURVE_FACTOR; // Use config derived value
        const alpha = config.BLINK_ALPHA_START * (1 - Math.abs(timeFactor - 1)); // Use config
        
        if (alpha <= 0) continue;
        
        ctx.save();
        ctx.beginPath();
        ctx.arc(node.x, node.y, config.BLINK_RADIUS, 0, 2 * Math.PI); // Use config
        ctx.strokeStyle = config.BLINK_COLOR; // Use config
        ctx.globalAlpha = alpha;
        ctx.lineWidth = config.BLINK_WIDTH; // Use config
        ctx.shadowColor = config.BLINK_COLOR; // Use config
        ctx.shadowBlur = config.BLINK_SHADOW_BLUR; // Use config
        ctx.stroke();
        ctx.restore();
    }
}

/**
 * Draw processing flash effects on nodes
 * @param {CanvasRenderingContext2D} ctx - Canvas rendering context
 * @param {Array} processingFlashes - Array of processing flash effect objects
 */
function drawProcessingFlashes(ctx, processingFlashes) {
    if (!processingFlashes) return;
    if (config.DEBUG_MODE && processingFlashes.length > 0) {
        // console.log('[renderer.js] Drawing processingFlashes. Count:', processingFlashes.length);
    }

    for (const { node, time } of processingFlashes) {
        // Calculate progress (0 to 1) over the flash duration
        const progress = Math.min(1, time / config.PROCESSING_FLASH_DURATION_SECONDS); // Use config

        // Alpha: Fade in and out quickly (e.g., peak at midpoint)
        // Simple triangular fade: 0 -> 1 -> 0
        let alpha = 0;
        if (progress < 0.5) {
            alpha = progress * 2; // Fade in from 0 to 1
        } else {
            alpha = (1 - progress) * 2; // Fade out from 1 to 0
        }
        alpha = Math.max(0, Math.min(1, alpha)); // Clamp alpha between 0 and 1
        
        // Radius: Expand and then optionally shrink, or just expand
        const baseRadius = config.NODE_RADIUS; // Use config
        const maxRadius = baseRadius * config.PROCESSING_FLASH_RADIUS_FACTOR; // Use config
        const flashRadius = baseRadius + (maxRadius - baseRadius) * progress; // Simple expansion

        if (alpha <= 0.01) { // Use a small threshold to avoid drawing invisible flashes
            if (config.DEBUG_MODE) {
                // console.log(`[renderer.js] Flash for node ${node.id} skipped (alpha too low): ${alpha.toFixed(3)}`);
            }
            continue;
        }
        
        if (config.DEBUG_MODE) {
            // console.log(`[renderer.js] Node ${node.id} flash: radius=${flashRadius.toFixed(2)}, alpha=${alpha.toFixed(2)}, time: ${time.toFixed(3)}`);
        }

        ctx.save();
        ctx.beginPath();
        ctx.arc(node.x, node.y, flashRadius, 0, 2 * Math.PI);
        ctx.fillStyle = config.PROCESSING_FLASH_COLOR; // Use config
        ctx.globalAlpha = alpha; // Use calculated alpha for the effect
        ctx.shadowColor = config.PROCESSING_FLASH_COLOR; // Use config
        ctx.shadowBlur = config.PROCESSING_FLASH_SHADOW_BLUR; // Use config
        ctx.fill();
        ctx.restore();
    }
}

/**
 * Draw all edges in the network
 * @param {CanvasRenderingContext2D} ctx - Canvas rendering context
 * @param {Array} edges - Array of edge objects
 */
function drawEdges(ctx, edges) {
    ctx.save();
    ctx.strokeStyle = config.EDGE_COLOR; // Use config
    ctx.lineWidth = config.EDGE_WIDTH; // Use config
    
    for (const edge of edges) {
        ctx.beginPath();
        ctx.moveTo(edge.source.x, edge.source.y);
        ctx.lineTo(edge.target.x, edge.target.y);
        ctx.stroke();
    }
    
    ctx.restore();
}

/**
 * Draw all packets in the network
 * @param {CanvasRenderingContext2D} ctx - Canvas rendering context
 * @param {Array} packets - Array of packet objects
 */
function drawPackets(ctx, packets) {
    const easeOutQuad = t => t * (2 - t);

    for (const packet of packets) {
        const easedProgress = easeOutQuad(packet.progress);

        // Interpolate position based on eased progress
        const currentX = packet.sourceNode.x + (packet.targetNode.x - packet.sourceNode.x) * easedProgress;
        const currentY = packet.sourceNode.y + (packet.targetNode.y - packet.sourceNode.y) * easedProgress;
        
        ctx.save();

        // Draw trails
        const trailCount = config.PACKET_TRAIL_COUNT; // Use config
        const trailSpacingFactor = config.PACKET_TRAIL_SPACING_FACTOR; // Use config
        const trailAlphaFactor = config.PACKET_TRAIL_ALPHA_FACTOR; // Use config

        for (let i = trailCount; i > 0; i--) {
            const trailProgress = Math.max(0, easedProgress - i * trailSpacingFactor);
            if (trailProgress === easedProgress && easedProgress > 0) continue; // Don't draw on top of main packet if progress is low, unless progress is 0

            const trailX = packet.sourceNode.x + (packet.targetNode.x - packet.sourceNode.x) * trailProgress;
            const trailY = packet.sourceNode.y + (packet.targetNode.y - packet.sourceNode.y) * trailProgress;
            
            ctx.globalAlpha = config.PACKET_ALPHA * Math.pow(trailAlphaFactor, i); // Use config
            ctx.beginPath();
            ctx.arc(trailX, trailY, config.PACKET_RADIUS * (1 - 0.2 * i), 0, 2 * Math.PI); // Slightly smaller trails, Use config for PACKET_RADIUS
            ctx.fillStyle = packet.color;
            ctx.fill();
        }

        // Draw main packet
        ctx.globalAlpha = config.PACKET_ALPHA; // Use config
        ctx.beginPath();
        ctx.arc(currentX, currentY, config.PACKET_RADIUS, 0, 2 * Math.PI); // Use config
        ctx.fillStyle = packet.color;
        ctx.shadowColor = packet.color;
        ctx.shadowBlur = config.PACKET_SHADOW_BLUR; // Use config
        ctx.fill();
        ctx.restore();
    }
}

/**
 * Draw all nodes in the network
 * @param {CanvasRenderingContext2D} ctx - Canvas rendering context
 * @param {Array} nodes - Array of node objects
 * @param {number} now - Current timestamp for animations
 * @param {Array} nodePulses - Array of active node pulse effects
 */
export function drawNodes(ctx, nodes, now, nodePulses) { // Added nodePulses parameter
    if (!nodes) return;

    ctx.save();
    if (config.ENABLE_NODE_SHADOWS) {
        ctx.shadowColor = config.NODE_SHADOW_COLOR;
        ctx.shadowBlur = config.NODE_SHADOW_BLUR;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
    }

    for (const node of nodes) {
        ctx.save();
        ctx.globalAlpha = config.NODE_ALPHA; // Use config

        let fillColor = node.color; // Default color
        let currentRadius = config.NODE_RADIUS; // Default radius

        // Check for active pulses for this node
        const activePulses = nodePulses.filter( // Use passed nodePulses
            p => p.node.id === node.id && p.time < config.NODE_PULSE_DURATION_SECONDS
        );

        if (activePulses.length > 0) {
            // Get the most recent active pulse (though typically there should only be one or they'd overlap fast)
            const currentPulse = activePulses.sort((a, b) => b.time - a.time)[0];
            
            // Pulse color overrides default and breathing effect color
            // Fade out the pulse color's alpha
            const pulseProgress = currentPulse.time / config.NODE_PULSE_DURATION_SECONDS;
            const pulseAlpha = Math.max(0, 1 - pulseProgress);
            
            // Assuming pulse.color is like 'rgba(r,g,b,a)'
            // We want to modulate the 'a' part based on pulseAlpha
            const basePulseColor = currentPulse.color.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
            if (basePulseColor) {
                const r = basePulseColor[1];
                const g = basePulseColor[2];
                const b = basePulseColor[3];
                const baseAlpha = parseFloat(basePulseColor[4]);
                fillColor = `rgba(${r}, ${g}, ${b}, ${baseAlpha * pulseAlpha})`;
            } else {
                fillColor = currentPulse.color; // Fallback if color format is unexpected
            }
            // During a color pulse, use standard radius (no breathing)
            currentRadius = config.NODE_RADIUS + config.NODE_BREATHING_AMPLITUDE; // Or just config.NODE_RADIUS for no size change

        } else {
            // No active color pulse, apply breathing effect
            const breathCycle = (now / config.NODE_BREATHING_SPEED) * Math.PI * 2; // Use config
            const breathAmount = Math.sin(breathCycle + node.id) * config.NODE_BREATHING_AMPLITUDE; // Use config, node.id for phase offset
            currentRadius = config.NODE_RADIUS + breathAmount; // Use config
        }
        
        ctx.beginPath();
        ctx.arc(node.x, node.y, currentRadius, 0, 2 * Math.PI);
        ctx.fillStyle = fillColor;
        ctx.fill();
        ctx.restore();
    }

    // Clear shadow settings for subsequent drawing operations that shouldn't have shadows
    if (config.ENABLE_NODE_SHADOWS) {
        ctx.shadowColor = 'transparent'; // Or 'rgba(0,0,0,0)'
        ctx.shadowBlur = 0;
    }
    ctx.restore(); // Restore to state before any shadow or path operations for nodes
}

/**
 * Draw node pulse effects (e.g., for sending, receiving, routing packets)
 * @param {CanvasRenderingContext2D} ctx - Canvas rendering context
 * @param {Array} nodePulses - Array of node pulse effect objects
 */
function drawNodePulses(ctx, nodePulses) {
    if (!nodePulses || nodePulses.length === 0) return;

    nodePulses.forEach(pulse => {
        const node = pulse.node;
        if (!node) return;

        const progress = pulse.time / config.NODE_PULSE_DURATION_SECONDS;
        if (progress < 0 || progress > 1) return; // Should be filtered by script.js, but good practice

        const currentRadius = config.NODE_RADIUS + (config.NODE_RADIUS * (config.NODE_PULSE_MAX_RADIUS_FACTOR -1) * progress);
        const alpha = 1 - progress; // Simple linear fade out

        ctx.save();
        ctx.beginPath();
        ctx.arc(node.x, node.y, currentRadius, 0, Math.PI * 2);
        
        // Modify pulse color to include current alpha
        const baseColor = pulse.color.startsWith('rgba') ? pulse.color.substring(0, pulse.color.lastIndexOf(',')) : 'rgba(255,255,255';
        ctx.strokeStyle = `${baseColor}, ${alpha.toFixed(3)})`;
        
        ctx.lineWidth = config.NODE_PULSE_LINE_WIDTH;
        ctx.stroke();
        ctx.restore();

        if (config.DEBUG_MODE) {
            // console.log(`[renderer.js] Drawing pulse for node ${node.id}: time=${pulse.time.toFixed(2)}, radius=${currentRadius.toFixed(2)}, alpha=${alpha.toFixed(2)}`);
        }
    });
}

// Add a log to confirm loading, only if not already present or if DEBUG_MODE is on
if (typeof rendererJsLoaded === 'undefined') {
    if (config.DEBUG_MODE) console.log('renderer.js loaded, using central config');
    globalThis.rendererJsLoaded = true; // Prevent multiple logs if script is somehow re-evaluated
}
