// quality.js
// DOM-free adaptive quality governor. Feeds on rendered frame times and trades
// render scale (then effects) for frame rate, probing back up with backoff so
// a device that cannot hold a level is not asked again and again.

import { config } from './config.js';

export class QualityGovernor {
    constructor(lowPower = false) {
        this.scale = lowPower ? config.SCALE_START_LOW_POWER : config.SCALE_START;
        this.lite = false;
        this.grace = config.QUALITY_GRACE_S;
        this.probeAfter = config.QUALITY_PROBE_S;
        this.time = 0;
        this.frames = 0;
        this.expected = 0;
        this.goodTime = 0;
        this.sinceUp = Infinity;
    }

    // Per-frame render settings for the current level.
    get settings() {
        const lite = this.lite ? config.LITE : null;
        return {
            scale: this.scale,
            marchSteps: lite ? lite.marchSteps : config.BH_MARCH_STEPS,
            bloom: lite ? lite.bloom : true,
            // Not tied to scale: grains popping in and out on every scale
            // step reads as a glitch.
            dust: Math.round(config.DUST_COUNT * (lite ? lite.dustFraction : 1)),
            maxParticles: lite ? lite.maxParticles : config.MAX_PARTICLES,
        };
    }

    // Call once per rendered frame. Returns true when the level changed.
    // With mayRaise false the level can only drop.
    sample(dt, targetFps, mayRaise = true) {
        if (this.grace > 0) {
            this.grace -= dt;
            return false;
        }
        // One long hiccup (GC, tab wake) must not read as a slow GPU.
        const clamped = Math.min(dt, 0.1);
        this.time += clamped;
        this.frames++;
        // The target changes when the loop goes idle, so count expected
        // frames as they come instead of dividing by one target at the end.
        this.expected += clamped * targetFps;
        if (this.time < config.QUALITY_SAMPLE_S) return false;

        const ratio = this.frames / this.expected;
        this.sinceUp += this.time;
        this.time = 0;
        this.frames = 0;
        this.expected = 0;

        if (ratio < config.QUALITY_SLOW) return this.stepDown();
        if (ratio < config.QUALITY_GOOD) {
            this.goodTime = 0;
            return false;
        }
        if (!mayRaise) return false;
        this.goodTime += config.QUALITY_SAMPLE_S;
        return this.goodTime >= this.probeAfter && this.stepUp();
    }

    stepDown() {
        this.goodTime = 0;
        if (this.sinceUp < 3 * config.QUALITY_SAMPLE_S) {
            this.probeAfter = Math.min(config.QUALITY_PROBE_MAX_S, this.probeAfter * 2);
        }
        if (this.scale > config.SCALE_MIN) {
            this.scale = Math.max(config.SCALE_MIN, this.scale * config.SCALE_DOWN);
            return true;
        }
        if (!this.lite) {
            this.lite = true;
            return true;
        }
        return false;
    }

    stepUp() {
        this.goodTime = 0;
        if (this.lite) {
            this.lite = false;
        } else if (this.scale < 1) {
            this.scale = Math.min(1, this.scale * config.SCALE_UP);
        } else {
            return false;
        }
        this.sinceUp = 0;
        return true;
    }
}
