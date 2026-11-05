export interface Vec2 {
    x: number;
    y: number;
}

/**
 * Small collection of 2D vector/angle math helpers.
 * All angles are in radians, using Phaser's convention:
 *   angle 0 = pointing along +X, increasing = clockwise on screen (y-down).
 */
export class MathHelper {
    /** Clamp a value between a minimum and maximum. */
    static clamp(value: number, min: number, max: number): number {
        return Math.min(Math.max(value, min), max);
    }

    /** Euclidean distance between two points. */
    static distance(a: Vec2, b: Vec2): number {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /** Squared distance — use when you only need to compare distances (avoids sqrt). */
    static distanceSq(a: Vec2, b: Vec2): number {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        return dx * dx + dy * dy;
    }

    /** Dot product of two vectors (or two points treated as vectors from origin). */
    static dot(a: Vec2, b: Vec2): number {
        return a.x * b.x + a.y * b.y;
    }

    /** Magnitude (length) of a vector. */
    static length(v: Vec2): number {
        return Math.sqrt(v.x * v.x + v.y * v.y);
    }

    /** Returns a unit-length copy of v. Returns {x:0,y:0} if v has zero length. */
    static normalize(v: Vec2): Vec2 {
        const len = MathHelper.length(v);
        if (len === 0) return { x: 0, y: 0 };
        return { x: v.x / len, y: v.y / len };
    }

    /**
     * Absolute angle (radians) of the vector from `a` to `b`, in world space.
     * 0 = b is directly to the right of a, increasing clockwise (Phaser convention).
     */
    static angleTo(a: Vec2, b: Vec2): number {
        return Math.atan2(b.y - a.y, b.x - a.x);
    }

    /**
     * Signed angle (radians) between two vectors, in range (-PI, PI].
     * Positive = b is clockwise from a (screen y-down convention).
     */
    static angleBetween(a: Vec2, b: Vec2): number {
        return Math.atan2(a.x * b.y - a.y * b.x, MathHelper.dot(a, b));
    }

    /**
     * Unsigned angle (radians) between two vectors, in range [0, PI].
     */
    static angleBetweenUnsigned(a: Vec2, b: Vec2): number {
        const denom = MathHelper.length(a) * MathHelper.length(b);
        if (denom === 0) return 0;

        const cos = MathHelper.dot(a, b) / denom;

        return MathHelper.clamp(cos, -1, 1) === cos
            ? Math.acos(cos)
            : Math.acos(MathHelper.clamp(cos, -1, 1));
    }

    /** Shortest signed difference between two angles (radians), result in (-PI, PI]. */
    static angleDifference(from: number, to: number): number {
        let diff = (to - from) % (Math.PI * 2);

        if (diff > Math.PI) diff -= Math.PI * 2;
        if (diff < -Math.PI) diff += Math.PI * 2;

        return diff;
    }

    /** Linearly interpolate between two angles, taking the shortest path. */
    static lerpAngle(from: number, to: number, t: number): number {
        return from + MathHelper.angleDifference(from, to) * t;
    }

    /** Unit vector for an angle in radians. */
    static fromAngle(angle: number): Vec2 {
        return { x: Math.cos(angle), y: Math.sin(angle) };
    }
}
