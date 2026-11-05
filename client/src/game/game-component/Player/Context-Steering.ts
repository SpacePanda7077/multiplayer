import { MathHelper, Vec2 } from "../utils/Math-Helper";

export class ContextSteering {
    readonly slots: number;
    readonly dirs: Vec2[] = [];
    readonly interest: Float32Array;
    readonly danger: Float32Array;

    /** Slots with danger above (lowest danger + this) are masked out. */
    maskTolerance = 0.05;
    /** Bonus for the previously chosen slot, stops left/right flip-flopping. */
    hysteresis = 0.1;
    /** Higher = turns faster. */
    turnRate = 10;

    // --- exposed for debugging ---
    /** Interest after masking (what the picker actually saw). */
    readonly masked: Float32Array;
    /** 1 if the slot was masked out by danger this frame. */
    readonly maskedOut: Uint8Array;
    /** Index of the winning slot, or -1 if nothing was interesting. */
    bestSlot = -1;
    /** Final smoothed output, length 0..1. */
    readonly output: Vec2 = { x: 0, y: 0 };

    private lastSlot = -1;

    constructor(slots = 16) {
        this.slots = slots;
        this.interest = new Float32Array(slots);
        this.danger = new Float32Array(slots);
        this.masked = new Float32Array(slots);
        this.maskedOut = new Uint8Array(slots);
        for (let i = 0; i < slots; i++) {
            this.dirs.push(MathHelper.fromAngle((i / slots) * Math.PI * 2));
        }
    }

    /** Call at the start of every frame before adding anything. */
    reset() {
        this.interest.fill(0);
        this.danger.fill(0);
    }

    /** "I'd like to move roughly this way." Slots facing `dir` get the most interest. */
    addInterest(dir: Vec2, weight = 1) {
        const d = MathHelper.normalize(dir);
        if (d.x === 0 && d.y === 0) return;
        for (let i = 0; i < this.slots; i++) {
            const dot = MathHelper.dot(this.dirs[i], d);
            if (dot > 0)
                this.interest[i] = Math.max(this.interest[i], dot * weight);
        }
    }

    /** "Something is in this direction." Spreads to neighbouring slots. */
    addDanger(dir: Vec2, weight = 1) {
        const d = MathHelper.normalize(dir);
        if (d.x === 0 && d.y === 0) return;
        for (let i = 0; i < this.slots; i++) {
            const dot = MathHelper.dot(this.dirs[i], d);
            // only slots within ~60 degrees, falling off smoothly
            if (dot > 0.5) {
                const falloff = (dot - 0.5) / 0.5;
                this.danger[i] = Math.max(this.danger[i], weight * falloff);
            }
        }
    }

    /** Danger for one specific slot (used by raycasts), bleeds into neighbours. */
    addDangerSlot(i: number, weight: number) {
        const n = this.slots;
        this.danger[i] = Math.max(this.danger[i], weight);
        const l = (i + n - 1) % n;
        const r = (i + 1) % n;
        this.danger[l] = Math.max(this.danger[l], weight * 0.5);
        this.danger[r] = Math.max(this.danger[r], weight * 0.5);
    }

    /** Skip smoothing and start moving in this direction right away. */
    snap(x: number, y: number) {
        this.output.x = x;
        this.output.y = y;
        this.lastSlot = -1;
    }

    /** Returns a movement vector with length 0..1. (Returned object is reused, don't store it.) */
    resolve(dt: number): Vec2 {
        const n = this.slots;

        let minDanger = Infinity;
        for (let i = 0; i < n; i++)
            minDanger = Math.min(minDanger, this.danger[i]);

        // mask: dangerous slots lose all interest
        this.masked.fill(0);
        let best = -1;
        let bestVal = 0;
        for (let i = 0; i < n; i++) {
            if (this.danger[i] > minDanger + this.maskTolerance) {
                this.maskedOut[i] = 1;
                continue;
            }
            this.maskedOut[i] = 0;
            this.masked[i] =
                this.interest[i] +
                (i === this.lastSlot ? this.hysteresis * this.interest[i] : 0);
            if (this.masked[i] > bestVal) {
                bestVal = this.masked[i];
                best = i;
            }
        }

        let tx = 0;
        let ty = 0;
        if (best >= 0) {
            // blend best slot with its neighbours for sub-slot precision
            const l = (best + n - 1) % n;
            const r = (best + 1) % n;
            const m = this.masked;
            const sx =
                this.dirs[best].x * m[best] +
                this.dirs[l].x * m[l] +
                this.dirs[r].x * m[r];
            const sy =
                this.dirs[best].y * m[best] +
                this.dirs[l].y * m[l] +
                this.dirs[r].y * m[r];
            const len = Math.sqrt(sx * sx + sy * sy);
            if (len > 0) {
                const mag = MathHelper.clamp(bestVal, 0, 1);
                tx = (sx / len) * mag;
                ty = (sy / len) * mag;
            }
        }
        this.lastSlot = best;
        this.bestSlot = best;

        // smooth so the bot doesn't jitter between slots
        const t = 1 - Math.exp(-this.turnRate * dt);
        this.output.x += (tx - this.output.x) * t;
        this.output.y += (ty - this.output.y) * t;
        return this.output;
    }
}
