// network.js
// Handles network data model: nodes, edges, packets

// Configuration Constants
const CONFIG = {
    // Node placement
    NODE_MIN_DIST: 60,    // Minimum distance between nodes
    NODE_MARGIN: 30,      // Margin from canvas edges
    NODE_MAX_TRIES: 100,  // Max attempts to place a node
    NODE_MAX_CONN: 4,     // Maximum connections per node
    
    // Packet behavior
    MAX_HOPS: 3,          // Maximum redirects before removal
    PACKET_SPEED: 0.5,    // Movement speed (progress units per second)
    
    // Animation durations
    RIPPLE_DURATION: 0.7, // How long ripples last (seconds)
    BLINK_DURATION: 0.5,  // How long blinks last (seconds)
    
    // Node movement
    NODE_MAX_SPEED: 0.5,         // Maximum node speed
    NODE_ACCELERATION: 0.05,     // How quickly nodes change direction
    NODE_DAMPING: 0.98,          // Friction to prevent excessive speed
    NODE_DRIFT_RADIUS: 30,       // Maximum distance from original position
    NODE_RETURN_FORCE: 0.01      // Force pulling nodes back to original position
};

// Effect queues for renderer
// networkEffects.ripples: {node, time, color, type}, networkEffects.blinks: {node, time}
export const networkEffects = {
    ripples: [],
    blinks: [],
    processingFlashes: [] // Added for node processing flash
};

/**
 * Determines if two line segments (ab and cd) cross each other
 * @param {Node} a - First point of first segment
 * @param {Node} b - Second point of first segment
 * @param {Node} c - First point of second segment
 * @param {Node} d - Second point of second segment
 * @returns {boolean} - True if the segments cross
 */
function edgesCross(a, b, c, d) {
    // Helper: Determine if three points make a counter-clockwise turn
    function ccw(p1, p2, p3) {
        return (p3.y - p1.y) * (p2.x - p1.x) > (p2.y - p1.y) * (p3.x - p1.x);
    }
    
    // Segments cross if they share no endpoints and straddle each other
    return (
        a !== c && a !== d && b !== c && b !== d &&
        ccw(a, c, d) !== ccw(b, c, d) &&
        ccw(a, b, c) !== ccw(a, b, d)
    );
}


/**
 * Represents a node in the network
 */
export class Node {
    /**
     * Create a new node
     * @param {number} id - Unique identifier
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @param {string} color - CSS color string
     */
    constructor(id, x, y, color) {
        this.id = id;
        this.x = x;
        this.y = y;
        this.originalX = x;     // Store original position for drift constraints
        this.originalY = y;     // Store original position for drift constraints
        this.vx = 0;            // X velocity component
        this.vy = 0;            // Y velocity component
        this.color = color;
        this.connections = [];
        this.lastEmitTime = -Infinity; // Track when this node last emitted a packet
    }
}

/**
 * Represents a connection between two nodes
 */
export class Edge {
    /**
     * Create a new edge
     * @param {Node} source - Source node
     * @param {Node} target - Target node
     */
    constructor(source, target) {
        this.source = source;
        this.target = target;
    }
}

/**
 * Represents a packet traveling through the network
 */
export class Packet {
    /**
     * Create a new packet
     * @param {Node} source - Starting node
     * @param {Node} target - Next node to visit
     * @param {string} color - CSS color string
     */
    constructor(source, target, color) {
        this.source = source;         // Current source node
        this.target = target;         // Current target node
        this.progress = 0;            // Progress from 0 (start) to 1 (arrived)
        this.color = color;           // Visual color
        this.active = true;           // Whether packet is still active
        this.hops = 0;                // Number of redirects so far
        this.prevNode = null;         // Previous node (to avoid backtracking)
        this.removed = false;         // Whether packet was removed due to hop limit
        this.removalEffect = null;    // Visual effect for removal {type, node, time}
        this.finalTargetId = null;    // ID of the ultimate destination node
    }
}

/**
 * Main network simulation class
 */
export class Network {
    /**
     * Create a new network
     * @param {number} width - Canvas width
     * @param {number} height - Canvas height
     * @param {number} nodeCount - Number of nodes to create
     */
    constructor(width, height, nodeCount = 10) {
        this.width = width;
        this.height = height;
        this.nodeCount = nodeCount;
        this.nodes = [];
        this.edges = [];
        this.packets = [];
        this.initialize();
    }

    /**
     * Initialize the network with nodes and edges
     */
    initialize() {
        this.nodes = [];
        this.edges = [];
        this.packets = [];
        
        this._placeNodes();
        this._normalizeNodePositions();
        this._createEdges();
    }
    
    /**
     * Resize the network to fit a new canvas size without regenerating the structure
     * @param {number} width - New canvas width
     * @param {number} height - New canvas height
     */
    resizeCanvas(width, height) {
        // Update dimensions
        this.width = width;
        this.height = height;
        
        // Only adjust node positions, keeping the same network structure
        if (this.nodes.length > 0) {
            // Reset velocities to prevent erratic movement after resize
            for (const node of this.nodes) {
                node.vx = 0;
                node.vy = 0;
            }
            
            // Rescale all nodes to fill the entire canvas and update original positions
            this._normalizeNodePositions(true);
        }
    }

    /**
     * Place nodes with minimum distance constraints
     * @private
     */
    _placeNodes() {
        for (let i = 0; i < this.nodeCount; i++) {
            let x, y, tries = 0, ok = false;
            
            // Try to find a position that's not too close to other nodes
            while (!ok && tries < CONFIG.NODE_MAX_TRIES) {
                x = Math.random() * this.width;
                y = Math.random() * this.height;
                ok = true;
                
                for (const other of this.nodes) {
                    const dx = x - other.x;
                    const dy = y - other.y;
                    if (Math.sqrt(dx*dx + dy*dy) < CONFIG.NODE_MIN_DIST) {
                        ok = false;
                        break;
                    }
                }
                tries++;
            }
            
            // Create the node with a random color
            const node = new Node(i, x, y, `hsl(${Math.random()*360},80%,60%)`);
            this.nodes.push(node);
        }
    }

    /**
     * Normalize node positions to fit within margins
     * @private
     * @param {boolean} [updateOriginalPositions=true] - Whether to update original positions
     */
    _normalizeNodePositions(updateOriginalPositions = true) {
        if (this.nodes.length === 0) return;
        
        // Find the bounds of all nodes
        let minX = Math.min(...this.nodes.map(n => n.x));
        let maxX = Math.max(...this.nodes.map(n => n.x));
        let minY = Math.min(...this.nodes.map(n => n.y));
        let maxY = Math.max(...this.nodes.map(n => n.y));
        
        const spanX = maxX - minX || 1; // Avoid division by zero
        const spanY = maxY - minY || 1;
        
        // Scale and translate all nodes to fit within margins
        // Don't preserve aspect ratio - stretch to fill the entire canvas
        for (const node of this.nodes) {
            // Calculate new position scaled to fill the entire canvas
            const newX = CONFIG.NODE_MARGIN + ((node.x - minX) / spanX) * (this.width - 2 * CONFIG.NODE_MARGIN);
            const newY = CONFIG.NODE_MARGIN + ((node.y - minY) / spanY) * (this.height - 2 * CONFIG.NODE_MARGIN);
            
            // Update current position
            node.x = newX;
            node.y = newY;
            
            // Update original position if requested (for resize operations)
            if (updateOriginalPositions) {
                node.originalX = newX;
                node.originalY = newY;
            }
        }
    }

    /**
     * Create edges between nodes
     * @private
     */
    _createEdges() {
        for (const node of this.nodes) {
            // Sort neighbors by distance
            const neighbors = this.nodes.filter(n => n !== node)
                .sort((a, b) => this._getDistanceSquared(node, a) - this._getDistanceSquared(node, b));
            
            // Randomly choose how many connections this node should have (1-4)
            const maxConns = 1 + Math.floor(Math.random() * CONFIG.NODE_MAX_CONN);
            let conns = 0;
            
            // Connect to closest neighbors that don't create crossing edges
            for (let i = 0; i < neighbors.length && conns < maxConns; i++) {
                const neighbor = neighbors[i];
                
                if (!node.connections.includes(neighbor)) {
                    if (!this._edgeWouldCross(node, neighbor)) {
                        this._addEdge(node, neighbor);
                        conns++;
                    }
                }
            }
        }
    }

    /**
     * Calculate squared distance between two nodes
     * @private
     * @param {Node} a - First node
     * @param {Node} b - Second node
     * @returns {number} - Squared distance
     */
    _getDistanceSquared(a, b) {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        return dx*dx + dy*dy;
    }

    /**
     * Check if an edge between two nodes would cross any existing edges
     * @private
     * @param {Node} a - First node
     * @param {Node} b - Second node
     * @returns {boolean} - True if the edge would cross any existing edge
     */
    _edgeWouldCross(a, b) {
        for (const edge of this.edges) {
            if (edgesCross(a, b, edge.source, edge.target)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Add an edge between two nodes
     * @private
     * @param {Node} a - First node
     * @param {Node} b - Second node
     */
    _addEdge(a, b) {
        a.connections.push(b);
        b.connections.push(a);
        this.edges.push(new Edge(a, b));
    }

    /**
     * Update node positions with gentle random movement
     * @param {number} dt - Time delta in seconds
     */
    updateNodePositions(dt) {
        for (const node of this.nodes) {
            // Add small random acceleration
            node.vx += (Math.random() - 0.5) * CONFIG.NODE_ACCELERATION;
            node.vy += (Math.random() - 0.5) * CONFIG.NODE_ACCELERATION;
            
            // Apply damping to prevent excessive speed
            node.vx *= CONFIG.NODE_DAMPING;
            node.vy *= CONFIG.NODE_DAMPING;
            
            // Limit maximum speed
            const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
            if (speed > CONFIG.NODE_MAX_SPEED) {
                node.vx = (node.vx / speed) * CONFIG.NODE_MAX_SPEED;
                node.vy = (node.vy / speed) * CONFIG.NODE_MAX_SPEED;
            }
            
            // Calculate distance from original position
            const dx = node.x - node.originalX;
            const dy = node.y - node.originalY;
            const distanceFromOrigin = Math.sqrt(dx * dx + dy * dy);
            
            // Apply return force proportional to distance from original position
            if (distanceFromOrigin > 0) {
                const returnForce = CONFIG.NODE_RETURN_FORCE * Math.pow(distanceFromOrigin / CONFIG.NODE_DRIFT_RADIUS, 2);
                node.vx -= (dx / distanceFromOrigin) * returnForce;
                node.vy -= (dy / distanceFromOrigin) * returnForce;
            }
            
            // Hard limit on maximum distance from original position
            if (distanceFromOrigin > CONFIG.NODE_DRIFT_RADIUS) {
                node.x = node.originalX + (dx / distanceFromOrigin) * CONFIG.NODE_DRIFT_RADIUS;
                node.y = node.originalY + (dy / distanceFromOrigin) * CONFIG.NODE_DRIFT_RADIUS;
                
                // Bounce velocity when hitting the boundary
                node.vx *= -0.5;
                node.vy *= -0.5;
            } else {
                // Update position
                node.x += node.vx;
                node.y += node.vy;
            }
        }
    }

    /**
     * Update all packets in the network
     * @param {number} dt - Time delta in seconds
     * @param {Object} effects - Visual effects container
     */
    updatePackets(dt, effects) {
        // Update active packets
        for (let i = 0; i < this.packets.length; i++) {
            const packet = this.packets[i];
            if (!packet.active) continue;
            
            // Move the packet
            packet.progress += dt * CONFIG.PACKET_SPEED;
            
            // Check if packet has arrived at its target node
            if (packet.progress >= 1) {
                this._handlePacketArrival(packet, effects);
            }
        }
        
        // Remove inactive packets (except those with active effects)
        this._cleanupPackets();
    }

    /**
     * Handle a packet arriving at its target node
     * @private
     * @param {Packet} packet - The packet that arrived
     * @param {Object} effects - Visual effects container
     */
    _handlePacketArrival(packet, effects) {
        packet.progress = 1;
        const atNode = packet.target;
        
        // Create ripple effect at the node
        effects.ripples.push({
            node: atNode, 
            time: 0, 
            color: packet.color, 
            type: (atNode.id === packet.finalTargetId ? 'target' : 'normal')
        });
        
        // If this is the final destination, mark packet as inactive
        if (atNode.id === packet.finalTargetId) {
            packet.active = false;
            return;
        }
        
        // Otherwise, redirect the packet
        packet.hops++;
        
        // If hop limit reached, remove with blink effect
        if (packet.hops > CONFIG.MAX_HOPS) {
            this._removePacketWithEffect(packet, atNode, effects);
            return;
        }
        
        // Find valid neighbors to forward to
        const neighbors = this._getValidNeighbors(atNode, packet.prevNode);
        
        if (neighbors.length === 0) {
            packet.active = false;
            return;
        }
        
        // Forward to a random neighbor
        const next = neighbors[Math.floor(Math.random() * neighbors.length)];
        packet.prevNode = atNode;
        packet.source = atNode;
        packet.target = next;
        packet.progress = 0;

        // Add processing flash effect to the node that rerouted the packet
        effects.processingFlashes.push({ node: atNode, time: 0 });
        console.log('[network.js] Processing flash added for node:', atNode.id, 'at time:', performance.now());
    }

    /**
     * Remove a packet with a visual effect
     * @private
     * @param {Packet} packet - The packet to remove
     * @param {Node} node - The node where the effect should appear
     * @param {Object} effects - Visual effects container
     */
    _removePacketWithEffect(packet, node, effects) {
        packet.active = false;
        packet.removed = true;
        packet.removalEffect = {type: 'blink', node: node, time: 0};
        effects.blinks.push(packet.removalEffect);
    }

    /**
     * Get valid neighbors for forwarding a packet
     * @private
     * @param {Node} node - Current node
     * @param {Node} prevNode - Previous node (to avoid backtracking)
     * @returns {Node[]} - Array of valid neighbor nodes
     */
    _getValidNeighbors(node, prevNode) {
        const neighbors = [];
        for (let j = 0; j < node.connections.length; j++) {
            if (node.connections[j] !== prevNode) {
                neighbors.push(node.connections[j]);
            }
        }
        return neighbors;
    }

    /**
     * Remove inactive packets that don't have active effects
     * @private
     */
    _cleanupPackets() {
        const newPackets = [];
        for (let i = 0; i < this.packets.length; i++) {
            const p = this.packets[i];
            if (p.active || (p.removed && p.removalEffect && p.removalEffect.time < CONFIG.BLINK_DURATION)) {
                newPackets.push(p);
            }
        }
        this.packets = newPackets;
    }

    /**
     * Create and send a packet from a random source to a random target
     */
    sendRandomPacket() {
        if (this.nodes.length < 2) return;
        
        // Select random source and target nodes
        const source = this._getRandomNode();
        let target = this._getRandomNode(source); // Exclude source
        
        // Ensure source has connections
        if (!source.connections.length) return;
        
        // Create and send the packet
        const firstHop = source.connections[Math.floor(Math.random() * source.connections.length)];
        const color = target.color;
        const packet = new Packet(source, firstHop, color);
        packet.finalTargetId = target.id;
        this.packets.push(packet);
        
        // Track emission time
        source.lastEmitTime = performance.now ? performance.now() : Date.now();
    }

    /**
     * Get a random node from the network
     * @private
     * @param {Node} [exclude] - Node to exclude from selection
     * @returns {Node} - A random node
     */
    _getRandomNode(exclude = null) {
        let node;
        do {
            node = this.nodes[Math.floor(Math.random() * this.nodes.length)];
        } while (node === exclude && this.nodes.length > 1);
        return node;
    }
}
console.log('network.js loaded');
