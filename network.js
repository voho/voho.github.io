// network.js
// Handles network data model: nodes, edges, packets
import { config } from './config.js'; // Added import for new config

// Helper function for random integer in a range
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Helper function to shuffle an array
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

/**
 * Represents a node in the network
 */
export class Node {
    constructor(id, x, y, color = config.NODE_COLOR) {
        this.id = id;
        this.x = x;
        this.y = y;
        this.originalX = x; // Store original position for any potential return logic
        this.originalY = y;
        this.vx = 0; // Velocity x
        this.vy = 0; // Velocity y
        this.color = color;
        this.connections = []; // Stores Edge objects
        this.isSelected = false;
        this.lastEmitTime = 0;
        this.lastPulseTime = 0; // For visual effects
        this.gridR = null; // Grid row
        this.gridC = null; // Grid column
    }
}

/**
 * Represents a connection between two nodes
 */
export class Edge {
    constructor(source, target) {
        this.id = `edge-${source.id}-${target.id}`;
        this.source = source;
        this.target = target;
    }
}

/**
 * Represents a packet traveling through the network
 */
export class Packet {
    constructor(sourceNode, targetNode, finalTargetId, color = 'white', hops = 0) {
        this.id = `packet-${sourceNode.id}-${targetNode.id}-${Date.now()}`;
        this.sourceNode = sourceNode;
        this.targetNode = targetNode;
        this.finalTargetId = finalTargetId;
        this.x = sourceNode.x;
        this.y = sourceNode.y;
        this.progress = 0; // 0 to 1 for movement along the edge
        this.color = color;
        this.active = true;
        this.hops = hops;
        this.path = [sourceNode.id]; // Track nodes visited
    }
}

/**
 * Main network simulation class
 */
export class Network {
    /**
     * Create a new network
     * @param {number} canvasWidth - Canvas width
     * @param {number} canvasHeight - Canvas height
     */
    constructor(canvasWidth, canvasHeight) {
        this.nodes = [];
        this.edges = [];
        this.packets = [];
        this.canvasWidth = canvasWidth;
        this.canvasHeight = canvasHeight;
        this.effects = {
            nodePulses: [],
            processingFlashes: [],
            blinks: [] // Will be populated by the main update loop that manages this network instance
        };

        this._createLatticeNodes();
        this._createClosestNeighborEdges();

        if (config.DEBUG_MODE) {
            console.log(`[network.js] Network created with ${this.nodes.length} nodes and ${this.edges.length} edges.`);
        }
    }

    /**
     * Create lattice nodes
     * @private
     */
    _createLatticeNodes() {
        const numNodes = config.NUM_NODES;
        const aspectRatio = this.canvasWidth / this.canvasHeight;
        let cols = Math.ceil(Math.sqrt(numNodes * aspectRatio));
        let rows = Math.ceil(numNodes / cols);

        // Adjust cols/rows to be closer to NUM_NODES if the calculation overshoots significantly
        while (cols * rows > numNodes * 1.5 && cols > 1 && rows > 1) {
            if ((cols-1)*rows >= numNodes) cols--;
            else if (cols*(rows-1) >= numNodes) rows--;
            else break;
        }

        const cellWidth = this.canvasWidth / cols;
        const cellHeight = this.canvasHeight / rows;
        const margin = config.NODE_RADIUS * 2 + 5; // Ensure nodes aren't on the very edge

        let nodeIdCounter = 0;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (nodeIdCounter >= numNodes) break;

                let baseX = (c + 0.5) * cellWidth;
                let baseY = (r + 0.5) * cellHeight;

                const noiseX = (Math.random() - 0.5) * cellWidth * config.LATTICE_NOISE_FACTOR;
                const noiseY = (Math.random() - 0.5) * cellHeight * config.LATTICE_NOISE_FACTOR;

                let x = baseX + noiseX;
                let y = baseY + noiseY;

                // Clamp positions to be within canvas bounds (with margin)
                x = Math.max(margin, Math.min(this.canvasWidth - margin, x));
                y = Math.max(margin, Math.min(this.canvasHeight - margin, y));

                const node = new Node(nodeIdCounter++, x, y);
                node.gridR = r; // Store grid row
                node.gridC = c; // Store grid column
                this.nodes.push(node);
            }
            if (nodeIdCounter >= numNodes) break;
        }
    }

    /**
     * Create edges by connecting nodes to their closest neighbors.
     * @private
     */
    _createClosestNeighborEdges() {
        if (this.nodes.length < 2) return;

        const _distance = (node1, node2) => {
            const dx = node1.x - node2.x;
            const dy = node1.y - node2.y;
            return Math.sqrt(dx * dx + dy * dy);
        };

        this.nodes.forEach(sourceNode => {
            const numEdgesToCreate = randomInt(config.EDGES_PER_NODE_MIN, config.EDGES_PER_NODE_MAX);
            let actualEdgesCreated = 0;

            const potentialTargetsWithDistances = this.nodes
                .filter(n => n.id !== sourceNode.id)
                .map(targetNode => ({
                    node: targetNode,
                    distance: _distance(sourceNode, targetNode)
                }))
                .sort((a, b) => a.distance - b.distance);
            
            for (const { node: targetNode } of potentialTargetsWithDistances) {
                if (actualEdgesCreated >= numEdgesToCreate) break;

                // Check if an edge already exists (in either direction to avoid visual overlap)
                const edgeExists = this.edges.some(edge => 
                    (edge.source.id === sourceNode.id && edge.target.id === targetNode.id) ||
                    (edge.source.id === targetNode.id && edge.target.id === sourceNode.id)
                );

                if (!edgeExists) {
                    const edge = new Edge(sourceNode, targetNode);
                    this.edges.push(edge);
                    sourceNode.connections.push(edge); // For packet routing: sourceNode initiated this connection
                    // targetNode.connections.push(edge); // Not adding to target's connections here to keep 'connections' as purely outgoing initiated by source
                    actualEdgesCreated++;
                }
            }
        });
    }

    /**
     * Update node positions with gentle random movement
     * @param {number} dt - Time delta in seconds
     */
    updateNodePositions(dt) {
        if (config.NODE_ACCELERATION === 0 && config.NODE_RETURN_FORCE_STRENGTH === 0) {
             // If movement is disabled, nodes might still have residual velocity from previous states.
            // Dampen any existing velocity quickly.
            this.nodes.forEach(node => {
                node.vx *= (1 - (1 - config.NODE_DAMPING) * 10 * dt); // Stronger damping if static
                node.vy *= (1 - (1 - config.NODE_DAMPING) * 10 * dt);
                node.x += node.vx * dt;
                node.y += node.vy * dt;

                // Clamp to canvas boundaries (optional, if nodes shouldn't pass edges)
                // node.x = Math.max(config.NODE_RADIUS, Math.min(this.canvasWidth - config.NODE_RADIUS, node.x));
                // node.y = Math.max(config.NODE_RADIUS, Math.min(this.canvasHeight - config.NODE_RADIUS, node.y));
            });
            return; // No further movement logic if static
        }

        // Original movement logic (will be mostly inactive if acceleration is 0)
        this.nodes.forEach(node => {
            // Random acceleration
            const ax = (Math.random() - 0.5) * 2 * config.NODE_ACCELERATION;
            const ay = (Math.random() - 0.5) * 2 * config.NODE_ACCELERATION;

            node.vx += ax * dt;
            node.vy += ay * dt;

            // Damping
            node.vx *= config.NODE_DAMPING;
            node.vy *= config.NODE_DAMPING;

            // Speed limit (optional, if NODE_MAX_SPEED is defined and > 0)
            if (config.NODE_MAX_SPEED > 0) {
                const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
                if (speed > config.NODE_MAX_SPEED) {
                    node.vx = (node.vx / speed) * config.NODE_MAX_SPEED;
                    node.vy = (node.vy / speed) * config.NODE_MAX_SPEED;
                }
            }
            
            // Apply velocity
            node.x += node.vx * dt;
            node.y += node.vy * dt;

            // Return to original position (if configured)
            if (config.NODE_RETURN_FORCE_STRENGTH > 0 && (node.originalX !== undefined && node.originalY !== undefined)) {
                const dxToOrigin = node.originalX - node.x;
                const dyToOrigin = node.originalY - node.y;
                // Optional: if NODE_DRIFT_RADIUS is used, only apply return force if outside radius
                // const distToOrigin = Math.sqrt(dxToOrigin * dxToOrigin + dyToOrigin * dyToOrigin);
                // if (distToOrigin > config.NODE_DRIFT_RADIUS) { ... }
                
                node.vx += dxToOrigin * config.NODE_RETURN_FORCE_STRENGTH * dt;
                node.vy += dyToOrigin * config.NODE_RETURN_FORCE_STRENGTH * dt;
            }

            // Boundary checks (simple bounce or clamp)
            const radius = config.NODE_RADIUS;
            if (node.x < radius) { node.x = radius; node.vx *= -0.5; }
            if (node.x > this.canvasWidth - radius) { node.x = this.canvasWidth - radius; node.vx *= -0.5; }
            if (node.y < radius) { node.y = radius; node.vy *= -0.5; }
            if (node.y > this.canvasHeight - radius) { node.y = this.canvasHeight - radius; node.vy *= -0.5; }
        });

        // Node repulsion logic is removed as per request.
    }

    /**
     * Updates the network's dimensions and recalculates node positions.
     * @param {number} newCanvasWidth - The new width of the canvas.
     * @param {number} newCanvasHeight - The new height of the canvas.
     */
    updateDimensions(newCanvasWidth, newCanvasHeight) {
        this.canvasWidth = newCanvasWidth;
        this.canvasHeight = newCanvasHeight;

        const numNodes = this.nodes.length; // Use actual number of existing nodes
        if (numNodes === 0) return; // Should not happen if called after construction

        const aspectRatio = this.canvasWidth / this.canvasHeight;
        let cols = Math.ceil(Math.sqrt(numNodes * aspectRatio));
        let rows = Math.ceil(numNodes / cols);

        while (cols * rows > numNodes * 1.5 && cols > 1 && rows > 1) {
            if ((cols - 1) * rows >= numNodes) cols--;
            else if (cols * (rows - 1) >= numNodes) rows--;
            else break;
        }
        
        // Ensure cols and rows can accommodate all nodes if numNodes is fixed
        // This logic might need refinement if numNodes can change, but for fixed NUM_NODES from config, it should be fine.
        // The original _createLatticeNodes logic for cols/rows is good here.

        const cellWidth = this.canvasWidth / cols;
        const cellHeight = this.canvasHeight / rows;
        const margin = config.NODE_RADIUS * 2 + 5;

        this.nodes.forEach(node => {
            // Use stored gridR and gridC
            let baseX = (node.gridC + 0.5) * cellWidth;
            let baseY = (node.gridR + 0.5) * cellHeight;

            // Reapply consistent noise if desired, or recalculate for new scale
            // For simplicity, let's re-calculate noise based on new cell size. 
            // If we wanted *identical* relative jitter, we'd need to store noise factors or initial offsets.
            const noiseX = (Math.random() - 0.5) * cellWidth * config.LATTICE_NOISE_FACTOR;
            const noiseY = (Math.random() - 0.5) * cellHeight * config.LATTICE_NOISE_FACTOR;

            let newX = baseX + noiseX;
            let newY = baseY + noiseY;

            newX = Math.max(margin, Math.min(this.canvasWidth - margin, newX));
            newY = Math.max(margin, Math.min(this.canvasHeight - margin, newY));

            // Update node's current and target positions
            // For smooth transition, update targetX/Y and let updateNodePositions handle movement.
            // For immediate jump, set x/y directly.
            // Let's do immediate jump for resize, simpler.
            node.x = newX;
            node.y = newY;
            node.originalX = newX; // Also update originalX/Y to prevent immediate drift
            node.originalY = newY;
        });

        // Edges don't need explicit update as they are drawn between node x/y coordinates.
        // Packets will continue on their current edges; their relative progress should remain valid.
        // If edges were re-calculated (e.g. _createClosestNeighborEdges), packets might need re-evaluation.
        // For now, keeping existing edges is fine.

        if (config.DEBUG_MODE) {
            console.log(`[network.js] Network dimensions updated. Width: ${this.canvasWidth}, Height: ${this.canvasHeight}`);
        }
    }

    /**
     * Create and send a packet from a random source to a random target
     */
    sendRandomPacket() {
        if (this.nodes.length < 2 || this.edges.length === 0) return;

        const sourceIndex = randomInt(0, this.nodes.length - 1);
        let source = this.nodes[sourceIndex];
        
        // Ensure source has outgoing connections defined by our new edge creation logic
        const outgoingEdges = this.edges.filter(edge => edge.source.id === source.id);
        if (outgoingEdges.length === 0) {
            // Try to find a node that *does* have outgoing edges if the first pick doesn't
            const possibleSources = shuffleArray(this.nodes.filter(n => this.edges.some(e => e.source.id === n.id)));
            if (possibleSources.length === 0) return; // No nodes have outgoing edges
            source = possibleSources[0];
        }

        const directConnections = this.edges.filter(edge => edge.source.id === source.id);
        if (directConnections.length === 0) return; // Source has no outgoing edges

        const targetEdge = directConnections[randomInt(0, directConnections.length - 1)];
        const firstHopTarget = targetEdge.target;

        // Determine a final target (could be multi-hop or the first hop itself)
        let finalTarget = firstHopTarget;
        if (config.PACKET_MAX_HOPS > 0 && Math.random() < 0.7) { // 70% chance to try multi-hop if allowed
            let current = firstHopTarget;
            let visitedForThisPath = new Set([source.id, firstHopTarget.id]);
            for (let i = 0; i < config.PACKET_MAX_HOPS -1; i++) { // -1 because first hop is already chosen
                const potentialNextHops = this.edges.filter(e => e.source.id === current.id && !visitedForThisPath.has(e.target.id));
                if (potentialNextHops.length === 0) break;
                current = potentialNextHops[randomInt(0, potentialNextHops.length - 1)].target;
                visitedForThisPath.add(current.id);
                finalTarget = current;
                if (Math.random() < 0.3) break; // Chance to stop early at an intermediate hop
            }
        }

        const packetColor = `hsl(${randomInt(0, 360)}, 70%, 70%)`;
        const packet = new Packet(source, firstHopTarget, finalTarget.id, packetColor, 0);
        this.packets.push(packet);

        this.effects.nodePulses.push({ 
            node: source, 
            time: 0, 
            type: 'send',
            color: config.NODE_PULSE_SEND_COLOR
        });

        source.lastEmitTime = performance.now ? performance.now() : Date.now();
    }

    /**
     * Handle packet arrival at a node
     * @param {Packet} packet - The arrived packet
     * @param {Node} atNode - The node where the packet arrived
     */
    _handlePacketArrival(packet, atNode) {
        packet.progress = 0; // Reset progress for the next hop
        packet.path.push(atNode.id);

        // effects.ripples.push({ node: atNode, time: 0, color: packet.color, type: (atNode.id === packet.finalTargetId) ? 'target' : 'normal' }); // Removed ripple creation

        if (atNode.id === packet.finalTargetId) {
            packet.active = false;
            this.effects.nodePulses.push({ 
                node: atNode, 
                time: 0, 
                type: 'receive_final', 
                color: config.NODE_PULSE_RECEIVE_FINAL_COLOR 
            });
            this.effects.processingFlashes.push({ node: atNode, time: 0 });
            return;
        }

        packet.hops++;
        if (packet.hops >= config.PACKET_MAX_HOPS) {
            packet.active = false;
            // Optional: effect for expired packet
            return;
        }

        // Find next hop, avoid going back to the immediate previous node in the path
        const lastNodeId = packet.path.length > 1 ? packet.path[packet.path.length - 2] : null;
        const potentialNextEdges = this.edges.filter(edge => 
            edge.source.id === atNode.id && 
            edge.target.id !== lastNodeId && 
            !packet.path.includes(edge.target.id) // Avoid cycles in the current path
        );

        if (potentialNextEdges.length === 0) {
            // If no valid non-cyclic forward path, try any path that isn't immediately back
            const fallbackEdges = this.edges.filter(edge => edge.source.id === atNode.id && edge.target.id !== lastNodeId);
            if (fallbackEdges.length > 0) {
                const nextEdge = fallbackEdges[randomInt(0, fallbackEdges.length - 1)];
                packet.sourceNode = atNode;
                packet.targetNode = nextEdge.target;
            } else {
                 // No way forward, even allowing going back to non-immediate previous nodes
                const anyNextEdge = this.edges.filter(edge => edge.source.id === atNode.id);
                if (anyNextEdge.length > 0) {
                    const nextEdge = anyNextEdge[randomInt(0, anyNextEdge.length - 1)];
                    packet.sourceNode = atNode;
                    packet.targetNode = nextEdge.target;
                } else {
                    packet.active = false; // No outgoing edges from this node
                }
            }
        } else {
            const nextEdge = potentialNextEdges[randomInt(0, potentialNextEdges.length - 1)];
            packet.sourceNode = atNode;
            packet.targetNode = nextEdge.target;
        }

        // If the packet is still active, it's being routed. Add a 'route' pulse.
        // The processingFlash indicates the node handled the packet, regardless of successful routing.
        if (packet.active) {
            this.effects.nodePulses.push({
                node: atNode,
                time: 0,
                type: 'route',
                color: config.NODE_PULSE_ROUTE_COLOR // This color will be used by the renderer
            });
        }
        this.effects.processingFlashes.push({ node: atNode, time: 0 });
    }

    /**
     * Update all packets in the network
     * @param {number} dt - Delta time in seconds
     */
    updatePackets(dt) {
        // Filter out inactive packets first, and create blinks for those removed due to inactivity
        const stillActivePackets = [];
        for (let i = this.packets.length - 1; i >= 0; i--) {
            const packet = this.packets[i];
            if (packet.active) {
                stillActivePackets.push(packet);
            } else {
                // Packet became inactive, create a blink effect at its last known sourceNode or targetNode
                const blinkNode = packet.sourceNode || (packet.path.length > 0 ? this.nodes.find(n => n.id === packet.path[packet.path.length-1]) : null);
                if (blinkNode) {
                    this.effects.blinks.push({
                        node: blinkNode,
                        time: 0,
                        // Blink properties will be taken from config in renderer
                    });
                }
            }
        }
        this.packets = stillActivePackets.reverse(); // Maintain order if it matters

        this.packets.forEach(packet => {
            if (!packet.active) return;

            packet.progress += config.PACKET_SPEED * dt;

            if (packet.progress >= 1) {
                packet.progress = 1; // Ensure it lands exactly for logic
                this._handlePacketArrival(packet, packet.targetNode);
                // If still active after arrival (i.e., has a new target), progress is reset in _handlePacketArrival
            }

            if (packet.active) { // Update position if still active (might have been deactivated in _handlePacketArrival)
                const dx = packet.targetNode.x - packet.sourceNode.x;
                const dy = packet.targetNode.y - packet.sourceNode.y;
                packet.x = packet.sourceNode.x + dx * packet.progress;
                packet.y = packet.sourceNode.y + dy * packet.progress;
            }
        });
    }

    /**
     * Advances the time for all visual effects and filters out expired ones.
     * @param {number} dt - Delta time in seconds.
     */
    advanceEffects(dt) {
        // Advance time for all effects
        this.effects.nodePulses.forEach(p => p.time += dt);
        this.effects.processingFlashes.forEach(pf => pf.time += dt);
        this.effects.blinks.forEach(b => b.time += dt);

        // Filter effects based on their duration from the central config
        this.effects.nodePulses = this.effects.nodePulses.filter(p => p.time < config.NODE_PULSE_DURATION_SECONDS);
        this.effects.processingFlashes = this.effects.processingFlashes.filter(pf => pf.time < config.PROCESSING_FLASH_DURATION_SECONDS);
        this.effects.blinks = this.effects.blinks.filter(b => b.time < config.BLINK_DURATION_SECONDS);

        // Ripples would be handled here too if they existed
        // this.effects.ripples.forEach(r => r.time += dt);
        // this.effects.ripples = this.effects.ripples.filter(r => r.time < config.RIPPLE_DURATION_SECONDS);
    }
}

// Initial log to confirm loading
if (config.DEBUG_MODE) {
    console.log('[network.js] Network module loaded, using central config.');
}
