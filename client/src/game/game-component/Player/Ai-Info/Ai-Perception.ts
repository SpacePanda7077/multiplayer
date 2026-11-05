import { Vec2 } from "../../utils/Math-Helper";

const CAP = 128; // enough for ~0.9s even at 144 fps

/**
 * Ring buffer of the target's recent positions, so the bot can look at where
 * the target was `perceptionDelay` seconds ago. Allocates nothing per frame.
 */
export class Perception {
    private times = new Float64Array(CAP);
    private xs = new Float32Array(CAP);
    private ys = new Float32Array(CAP);
    private start = 0;
    private count = 0;
    /** Reused result object, don't store it. */
    readonly out: Vec2 = { x: 0, y: 0 };

    clear() {
        this.start = 0;
        this.count = 0;
    }

    push(time: number, p: Vec2) {
        let idx: number;
        if (this.count < CAP) {
            idx = (this.start + this.count) % CAP;
            this.count++;
        } else {
            idx = this.start;
            this.start = (this.start + 1) % CAP;
        }
        this.times[idx] = time;
        this.xs[idx] = p.x;
        this.ys[idx] = p.y;
    }

    /** Position of the target at `time` (newest sample at or before it, else the oldest we have). */
    get(time: number): Vec2 {
        if (this.count === 0) {
            this.out.x = 0;
            this.out.y = 0;
            return this.out;
        }
        for (let i = this.count - 1; i >= 0; i--) {
            const idx = (this.start + i) % CAP;
            if (this.times[idx] <= time) {
                this.out.x = this.xs[idx];
                this.out.y = this.ys[idx];
                return this.out;
            }
        }
        const idx = this.start;
        this.out.x = this.xs[idx];
        this.out.y = this.ys[idx];
        return this.out;
    }
}
