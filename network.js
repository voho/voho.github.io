// network.js
// Builds the background graph and runs the simulation state.
//
// Layout: nodes sit on a jittered grid (one extra ring outside the viewport
// so the mesh bleeds past every screen edge), connected by a Delaunay
// triangulation that is thinned to a lighter web. Delaunay triangulations
// are planar, and removing edges keeps them planar, so the mesh can never
// contain crossing lines. A spanning tree is always kept whole, so every
// node stays reachable for the routed signals.

import { config } from './config.js';

const TAU = Math.PI * 2;

function rand(min, max) {
    return min + Math.random() * (max - min);
}

function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function pointSegDist(px, py, ax, ay, bx, by) {
    const abx = bx - ax, aby = by - ay;
    const len2 = abx * abx + aby * aby;
    let t = 0;
    if (len2 > 0) {
        t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / len2));
    }
    const dx = px - (ax + abx * t);
    const dy = py - (ay + aby * t);
    return Math.sqrt(dx * dx + dy * dy);
}

// --- Delaunay triangulation (Bowyer-Watson) ---------------------------------
// Returns the unique edges [i, j] of the triangulation of the given points.

const EDGE_KEY_BASE = 1 << 20; // supports up to ~a million vertices

function delaunayEdges(points) {
    const n = points.length;
    if (n < 2) return [];

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    const span = Math.max(maxX - minX, maxY - minY) || 1;
    const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;

    // Vertices = input points plus a super-triangle far outside the box.
    const vx = new Float64Array(n + 3);
    const vy = new Float64Array(n + 3);
    for (let i = 0; i < n; i++) {
        vx[i] = points[i].x;
        vy[i] = points[i].y;
    }
    vx[n] = midX - span * 32; vy[n] = midY - span * 24;
    vx[n + 1] = midX + span * 32; vy[n + 1] = midY - span * 24;
    vx[n + 2] = midX; vy[n + 2] = midY + span * 40;

    const circumcircle = (a, b, c) => {
        const ax = vx[a], ay = vy[a], bx = vx[b], by = vy[b], cx = vx[c], cy = vy[c];
        const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
        if (Math.abs(d) < 1e-12) return { x: 0, y: 0, r2: Infinity };
        const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
        const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
        const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
        const dx = ux - ax, dy = uy - ay;
        return { x: ux, y: uy, r2: dx * dx + dy * dy };
    };

    let triangles = [{ a: n, b: n + 1, c: n + 2, cc: circumcircle(n, n + 1, n + 2) }];

    for (let i = 0; i < n; i++) {
        const px = vx[i], py = vy[i];
        const bad = [];
        const kept = [];
        for (const t of triangles) {
            const dx = px - t.cc.x, dy = py - t.cc.y;
            if (dx * dx + dy * dy <= t.cc.r2) bad.push(t);
            else kept.push(t);
        }
        // The hole boundary = edges belonging to exactly one bad triangle.
        const counts = new Map();
        const addEdge = (u, v) => {
            const key = u < v ? u * EDGE_KEY_BASE + v : v * EDGE_KEY_BASE + u;
            counts.set(key, (counts.get(key) || 0) + 1);
        };
        for (const t of bad) {
            addEdge(t.a, t.b);
            addEdge(t.b, t.c);
            addEdge(t.c, t.a);
        }
        triangles = kept;
        for (const [key, count] of counts) {
            if (count !== 1) continue;
            const u = Math.floor(key / EDGE_KEY_BASE), v = key % EDGE_KEY_BASE;
            triangles.push({ a: u, b: v, c: i, cc: circumcircle(u, v, i) });
        }
    }

    const edgeSet = new Set();
    for (const t of triangles) {
        if (t.a >= n || t.b >= n || t.c >= n) continue; // touches the super-triangle
        for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) {
            edgeSet.add(u < v ? u * EDGE_KEY_BASE + v : v * EDGE_KEY_BASE + u);
        }
    }
    return [...edgeSet].map(key => [Math.floor(key / EDGE_KEY_BASE), key % EDGE_KEY_BASE]);
}

// --- Disjoint set union, for the spanning tree --------------------------------

class DSU {
    constructor(n) {
        this.parent = new Int32Array(n);
        for (let i = 0; i < n; i++) this.parent[i] = i;
    }

    find(x) {
        while (this.parent[x] !== x) {
            this.parent[x] = this.parent[this.parent[x]];
            x = this.parent[x];
        }
        return x;
    }

    union(a, b) {
        const ra = this.find(a), rb = this.find(b);
        if (ra === rb) return false;
        this.parent[ra] = rb;
        return true;
    }
}

// --- Network construction -------------------------------------------------------

export function buildNetwork(width, height) {
    const area = Math.max(1, width * height);
    const spacing = Math.min(config.SPACING_MAX,
        Math.max(config.SPACING_MIN, Math.sqrt(area / config.SPACING_AREA_DIVISOR)));

    const cols = Math.max(2, Math.round(width / spacing));
    const rows = Math.max(2, Math.round(height / spacing));
    const cellW = width / cols;
    const cellH = height / rows;

    // One extra ring of nodes outside the viewport so the mesh covers the
    // whole screen edge-to-edge (and survives the small parallax shift).
    const nodes = [];
    for (let r = -1; r <= rows; r++) {
        for (let c = -1; c <= cols; c++) {
            const x = (c + 0.5) * cellW + rand(-1, 1) * cellW * config.JITTER;
            const y = (r + 0.5) * cellH + rand(-1, 1) * cellH * config.JITTER;
            nodes.push({
                x, y,           // current (drifted) position
                hx: x, hy: y,   // home position
                r: rand(config.NODE_RADIUS_MIN, config.NODE_RADIUS_MAX),
                alpha: rand(config.NODE_ALPHA_MIN, config.NODE_ALPHA_MAX),
                tw: rand(config.TWINKLE_FREQ_MIN, config.TWINKLE_FREQ_MAX) * TAU,
                twPhase: rand(0, TAU),
                dfx: rand(config.DRIFT_FREQ_MIN, config.DRIFT_FREQ_MAX) * TAU,
                dfy: rand(config.DRIFT_FREQ_MIN, config.DRIFT_FREQ_MAX) * TAU,
                dpx: rand(0, TAU), dpy: rand(0, TAU),
                dpx2: rand(0, TAU), dpy2: rand(0, TAU),
                deg: 0,
                lit: 0,
                hover: 0,
            });
        }
    }

    // Thin the triangulation: keep a spanning tree (connectivity), then a
    // random share of the remaining short edges.
    const all = delaunayEdges(nodes)
        .map(([a, b]) => {
            const dx = nodes[a].x - nodes[b].x, dy = nodes[a].y - nodes[b].y;
            return { a, b, len: Math.sqrt(dx * dx + dy * dy), lit: 0, color: null };
        })
        .sort((e, f) => e.len - f.len);

    const dsu = new DSU(nodes.length);
    const edges = [];
    for (const e of all) {
        if (dsu.union(e.a, e.b)) {
            edges.push(e); // tree edge: always kept
        } else if (e.len <= spacing * config.LONG_EDGE_FACTOR
            && Math.random() < config.EXTRA_EDGE_KEEP) {
            edges.push(e);
        }
    }

    const adj = nodes.map(() => []);
    edges.forEach((e, i) => {
        adj[e.a].push({ n: e.b, e: i });
        adj[e.b].push({ n: e.a, e: i });
        nodes[e.a].deg++;
        nodes[e.b].deg++;
    });

    // Largest drift radius that provably cannot create a crossing: if every
    // node stays closer to home than half its distance to the nearest
    // non-incident edge, no segment can ever sweep across another.
    let minClearance = Infinity;
    for (let i = 0; i < nodes.length; i++) {
        const p = nodes[i];
        for (const e of edges) {
            if (e.a === i || e.b === i) continue;
            const d = pointSegDist(p.hx, p.hy,
                nodes[e.a].hx, nodes[e.a].hy, nodes[e.b].hx, nodes[e.b].hy);
            if (d < minClearance) minClearance = d;
        }
    }
    const drift = Math.min(spacing * config.DRIFT_MAX_FRAC,
        minClearance * config.DRIFT_SAFETY);

    return { width, height, spacing, nodes, edges, adj, drift };
}

// --- Simulation -------------------------------------------------------------------

export class Simulation {
    constructor(width, height) {
        this.time = 0;
        this.rebuild(width, height);
    }

    rebuild(width, height) {
        this.net = buildNetwork(width, height);
        this.signals = [];
        this.rings = [];
        this.spawnIn = rand(0.2, 0.8);

        this.dust = [];
        const count = Math.round((width * height) / config.DUST_AREA_PER_PARTICLE);
        for (let i = 0; i < count; i++) {
            this.dust.push({
                x: rand(-20, width + 20),
                y: rand(-20, height + 20),
                r: rand(0.5, 1.5),
                alpha: rand(0.12, 0.4),
                vy: -rand(config.DUST_SPEED_MIN, config.DUST_SPEED_MAX),
                tw: rand(0.2, 0.6) * TAU,
                twPhase: rand(0, TAU),
            });
        }
    }

    update(dt) {
        this.time += dt;
        const net = this.net;
        const t = this.time;

        // Gentle node drift, always inside the provably safe radius.
        const amp = net.drift * 0.7; // 0.7 * sqrt(2) < 1, so |offset| < drift
        const edgeDecay = Math.exp(-dt / config.EDGE_LIT_DECAY_S);
        const nodeDecay = Math.exp(-dt / config.NODE_LIT_DECAY_S);
        for (const n of net.nodes) {
            n.x = n.hx + amp * (0.7 * Math.sin(n.dfx * t + n.dpx)
                + 0.3 * Math.sin(n.dfx * 1.7 * t + n.dpx2));
            n.y = n.hy + amp * (0.7 * Math.sin(n.dfy * t + n.dpy)
                + 0.3 * Math.sin(n.dfy * 1.7 * t + n.dpy2));
            n.lit = n.lit > 0.001 ? n.lit * nodeDecay : 0;
        }
        for (const e of net.edges) {
            e.lit = e.lit > 0.001 ? e.lit * edgeDecay : 0;
        }

        // Signals.
        this.spawnIn -= dt;
        if (this.spawnIn <= 0 && this.signals.length < config.SIGNAL_MAX) {
            this._spawnSignal();
            this.spawnIn = rand(config.SIGNAL_SPAWN_MIN_S, config.SIGNAL_SPAWN_MAX_S);
        }
        for (const s of this.signals) this._advanceSignal(s, dt);
        this.signals = this.signals.filter(s => !s.done);

        // Arrival rings.
        for (const ring of this.rings) ring.t += dt;
        this.rings = this.rings.filter(r => r.t < config.RING_DURATION_S);

        // Dust drifts slowly upward and wraps around.
        for (const d of this.dust) {
            d.y += d.vy * dt;
            if (d.y < -24) {
                d.y = net.height + 20;
                d.x = rand(-20, net.width + 20);
            }
        }
    }

    // Picks a visible source, BFS-routes to a visible target a few hops away
    // and starts a packet along the shortest path.
    _spawnSignal() {
        const net = this.net;
        const visible = [];
        for (let i = 0; i < net.nodes.length; i++) {
            const n = net.nodes[i];
            if (n.deg >= 2 && n.hx >= 0 && n.hx <= net.width
                && n.hy >= 0 && n.hy <= net.height) {
                visible.push(i);
            }
        }
        if (visible.length < 2) return;
        const from = pick(visible);

        const dist = new Int32Array(net.nodes.length).fill(-1);
        const prev = new Int32Array(net.nodes.length).fill(-1);
        const queue = [from];
        dist[from] = 0;
        for (let qi = 0; qi < queue.length; qi++) {
            const u = queue[qi];
            for (const { n } of net.adj[u]) {
                if (dist[n] === -1) {
                    dist[n] = dist[u] + 1;
                    prev[n] = u;
                    queue.push(n);
                }
            }
        }

        let candidates = visible.filter(i =>
            dist[i] >= config.SIGNAL_HOPS_MIN && dist[i] <= config.SIGNAL_HOPS_MAX);
        if (candidates.length === 0) candidates = visible.filter(i => dist[i] >= 2);
        if (candidates.length === 0) return;
        const to = pick(candidates);

        const path = [to];
        while (path[path.length - 1] !== from) {
            path.push(prev[path[path.length - 1]]);
        }
        path.reverse();

        const edgeIdx = [];
        for (let i = 0; i < path.length - 1; i++) {
            edgeIdx.push(net.adj[path[i]].find(l => l.n === path[i + 1]).e);
        }

        const color = Math.random() < config.SIGNAL_ACCENT_CHANCE
            ? config.SIGNAL_ACCENT
            : pick(config.SIGNAL_COLORS);

        this.signals.push({
            path,
            edgeIdx,
            leg: 0,     // index into edgeIdx
            t: 0,       // 0..1 progress along the current leg
            speed: rand(config.SIGNAL_SPEED_MIN, config.SIGNAL_SPEED_MAX),
            color,
            done: false,
        });
        net.nodes[from].lit = 1;
    }

    _advanceSignal(s, dt) {
        const net = this.net;
        let remaining = s.speed * dt;
        while (remaining > 0 && !s.done) {
            const a = net.nodes[s.path[s.leg]];
            const b = net.nodes[s.path[s.leg + 1]];
            const len = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
            s.t += remaining / len;
            remaining = 0;
            if (s.t >= 1) {
                remaining = (s.t - 1) * len;
                s.t = 0;
                const edge = net.edges[s.edgeIdx[s.leg]];
                edge.lit = 1;
                edge.color = s.color;
                net.nodes[s.path[s.leg + 1]].lit = 1;
                s.leg++;
                if (s.leg >= s.edgeIdx.length) {
                    s.done = true;
                    const target = net.nodes[s.path[s.path.length - 1]];
                    this.rings.push({ node: target, t: 0, color: s.color });
                }
            }
        }
    }
}
