// renderer.js
// Handles drawing the network on the canvas

import { networkEffects } from './network.js';

// Visual constants
const VISUAL = {
    // Nodes
    NODE_RADIUS: 22,
    NODE_ALPHA: 0.6,
    NODE_SHADOW_BLUR: 12,
    
    // Packets
    PACKET_RADIUS: 10,
    PACKET_ALPHA: 0.7,
    PACKET_SHADOW_BLUR: 10,
    PACKET_BLUR: '2px',
    
    // Edges
    EDGE_COLOR: 'rgba(60,60,60,0.9)',
    EDGE_WIDTH: 5,
    
    // Ripples
    RIPPLE_BASE_RADIUS: 22,
    RIPPLE_MAX_RADIUS: 44,
    RIPPLE_WIDTH: 5,
    RIPPLE_ALPHA_START: 0.5,
    RIPPLE_FADE_RATE: 0.7,
    RIPPLE_TARGET_SPACING: 10,
    
    // Blinks
    BLINK_RADIUS: 26,
    BLINK_COLOR: 'red',
    BLINK_WIDTH: 8,
    BLINK_SHADOW_BLUR: 18,
    BLINK_ALPHA: 0.7,
    BLINK_DURATION_FACTOR: 4
};

/**
 * Main rendering function for the network
 * @param {CanvasRenderingContext2D} ctx - Canvas rendering context
 * @param {Object} network - Network object containing nodes, edges, and packets
 */
export function renderNetwork(ctx, network) {
    // Clear canvas
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // Draw all elements in correct order (back to front)
    drawRipples(ctx);
    drawBlinks(ctx);
    drawEdges(ctx, network.edges);
    drawPackets(ctx, network.packets);
    drawNodes(ctx, network.nodes);
}

/**
 * Draw ripple effects
 * @param {CanvasRenderingContext2D} ctx - Canvas rendering context
 */
function drawRipples(ctx) {
    for (const ripple of networkEffects.ripples) {
        const {node, time, color, type} = ripple;
        const radius = VISUAL.RIPPLE_BASE_RADIUS + time * VISUAL.RIPPLE_MAX_RADIUS;
        const alpha = Math.max(0, VISUAL.RIPPLE_ALPHA_START - time * VISUAL.RIPPLE_FADE_RATE);
        
        if (alpha <= 0) continue;
        
        ctx.save();
        
        if (type === 'target') {
            drawTargetRipple(ctx, node, radius, alpha);
        } else {
            drawNormalRipple(ctx, node, radius, alpha, color || node.color);
        }
        
        ctx.restore();
    }
}

/**
 * Draw a target ripple (3 concentric circles)
 * @param {CanvasRenderingContext2D} ctx - Canvas rendering context
 * @param {Object} node - The node at the center of the ripple
 * @param {number} radius - Base radius of the ripple
 * @param {number} alpha - Opacity of the ripple
 */
function drawTargetRipple(ctx, node, radius, alpha) {
    ctx.strokeStyle = VISUAL.EDGE_COLOR;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = VISUAL.RIPPLE_WIDTH;
    
    for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + i * VISUAL.RIPPLE_TARGET_SPACING, 0, 2 * Math.PI);
        ctx.stroke();
    }
}

/**
 * Draw a normal ripple (single circle)
 * @param {CanvasRenderingContext2D} ctx - Canvas rendering context
 * @param {Object} node - The node at the center of the ripple
 * @param {number} radius - Radius of the ripple
 * @param {number} alpha - Opacity of the ripple
 * @param {string} color - Color of the ripple
 */
function drawNormalRipple(ctx, node, radius, alpha, color) {
    ctx.beginPath();
    ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = VISUAL.RIPPLE_WIDTH;
    ctx.stroke();
}

/**
 * Draw blink effects (for packet removal)
 * @param {CanvasRenderingContext2D} ctx - Canvas rendering context
 */
function drawBlinks(ctx) {
    for (const {node, time} of networkEffects.blinks) {
        const alpha = VISUAL.BLINK_ALPHA * (1 - Math.abs(time * VISUAL.BLINK_DURATION_FACTOR - 1));
        
        if (alpha <= 0) continue;
        
        ctx.save();
        ctx.beginPath();
        ctx.arc(node.x, node.y, VISUAL.BLINK_RADIUS, 0, 2 * Math.PI);
        ctx.strokeStyle = VISUAL.BLINK_COLOR;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = VISUAL.BLINK_WIDTH;
        ctx.shadowColor = VISUAL.BLINK_COLOR;
        ctx.shadowBlur = VISUAL.BLINK_SHADOW_BLUR;
        ctx.stroke();
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
    ctx.strokeStyle = VISUAL.EDGE_COLOR;
    ctx.lineWidth = VISUAL.EDGE_WIDTH;
    
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
    for (const packet of packets) {
        // Interpolate position based on progress
        const x = packet.source.x + (packet.target.x - packet.source.x) * packet.progress;
        const y = packet.source.y + (packet.target.y - packet.source.y) * packet.progress;
        
        ctx.save();
        ctx.globalAlpha = VISUAL.PACKET_ALPHA;
        ctx.filter = `blur(${VISUAL.PACKET_BLUR})`;
        ctx.beginPath();
        ctx.arc(x, y, VISUAL.PACKET_RADIUS, 0, 2 * Math.PI);
        ctx.fillStyle = packet.color;
        ctx.shadowColor = packet.color;
        ctx.shadowBlur = VISUAL.PACKET_SHADOW_BLUR;
        ctx.fill();
        ctx.restore();
    }
}

/**
 * Draw all nodes in the network
 * @param {CanvasRenderingContext2D} ctx - Canvas rendering context
 * @param {Array} nodes - Array of node objects
 */
function drawNodes(ctx, nodes) {
    for (const node of nodes) {
        ctx.save();
        ctx.globalAlpha = VISUAL.NODE_ALPHA;
        ctx.beginPath();
        ctx.arc(node.x, node.y, VISUAL.NODE_RADIUS, 0, 2 * Math.PI);
        ctx.fillStyle = node.color;
        ctx.shadowColor = node.color;
        ctx.shadowBlur = VISUAL.NODE_SHADOW_BLUR;
        ctx.fill();
        ctx.restore();
    }
}
