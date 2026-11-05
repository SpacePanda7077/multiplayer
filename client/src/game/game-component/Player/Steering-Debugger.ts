import { Scene, GameObjects } from "phaser";
import { Vec2 } from "../utils/Math-Helper";
import { ContextSteering } from "./Context-Steering";

export type SightLine = {
    /** Target position. */
    x: number;
    y: number;
    /** Where the ray stopped (equals target position when nothing blocked it). */
    hitX: number;
    hitY: number;
    /** clear = nothing hit, target = hit the target itself, wall = hit non-player, player = another player is in the way. */
    kind: "clear" | "target" | "wall" | "player";
    visible: boolean;
    /** True for the target the bot picked. */
    chosen: boolean;
};

export type DebugInfo = {
    position: Vec2;
    steering: ContextSteering;
    /** Per-slot normalized wall danger from raycasts (0 = no hit, 1 = touching). */
    wallDanger: Float32Array;
    wallLookAhead: number;
    avoidRadius: number;
    shootDistance: number;
    chaseDistance: number;
    aimPoint?: Vec2;
    seenPoint?: Vec2;
    sights?: SightLine[];
    lastSeen: Vec2 | null;
    lastSeenAge: number;
};

/**
 * Draws what the context steering is "thinking".
 *
 * Steering (per slot, around the bot):
 *   thin grey line      = wall ray, full look-ahead length
 *   thick red line      = wall ray up to where it hit a wall
 *   cyan bar            = interest (length = strength)
 *   orange bar          = interest that got MASKED OUT by danger
 *   yellow bar          = the winning slot
 *   red dot (outer)     = total danger in that slot
 *   white line + dot    = final smoothed movement output
 *
 * Line of sight (one line per nearby player):
 *   green line          = clear view (thicker = the chosen target)
 *   red line + dot      = blocked by a wall/other object, dim grey part = the hidden remainder
 *   orange line + dot   = blocked by ANOTHER player standing in the way
 *   ring around player  = green if visible, red if not
 *
 * F2 toggles everything, F4 toggles only the line-of-sight lines.
 */
export class SteeringDebugger {
    static enabled = true;
    static showSight = true;
    private static keyInstalled = false;

    private g: GameObjects.Graphics;
    private readonly barStart = 20;
    private readonly barScale = 60;
    private readonly dotRadius = 90;

    constructor(scene: Scene) {
        this.g = scene.add.graphics().setDepth(1000);

        if (!SteeringDebugger.keyInstalled && scene.input.keyboard) {
            SteeringDebugger.keyInstalled = true;
            scene.input.keyboard.on("keydown-F2", () => {
                SteeringDebugger.enabled = !SteeringDebugger.enabled;
            });
            scene.input.keyboard.on("keydown-F4", () => {
                SteeringDebugger.showSight = !SteeringDebugger.showSight;
            });
        }
    }

    draw(info: DebugInfo) {
        const g = this.g;
        g.clear();
        if (!SteeringDebugger.enabled) return;

        const { x, y } = info.position;
        const s = info.steering;

        // reference rings
        g.lineStyle(1, 0xffffff, 0.08);
        g.strokeCircle(x, y, info.shootDistance);
        g.strokeCircle(x, y, info.chaseDistance);
        g.lineStyle(1, 0xaaaaaa, 0.35);
        g.strokeCircle(x, y, info.avoidRadius);

        for (let i = 0; i < s.slots; i++) {
            const d = s.dirs[i];

            // wall ray: grey = full length, red = up to hit point
            g.lineStyle(1, 0x888888, 0.25);
            g.lineBetween(
                x,
                y,
                x + d.x * info.wallLookAhead,
                y + d.y * info.wallLookAhead,
            );
            const wd = info.wallDanger[i];
            if (wd > 0) {
                const hitDist = (1 - wd) * info.wallLookAhead;
                g.lineStyle(2, 0xff3333, 0.9);
                g.lineBetween(x, y, x + d.x * hitDist, y + d.y * hitDist);
                g.fillStyle(0xff3333, 1);
                g.fillCircle(x + d.x * hitDist, y + d.y * hitDist, 3);
            }

            // interest bar
            const interest = s.interest[i];
            if (interest > 0) {
                let color = 0x33ddff; // cyan
                if (s.maskedOut[i]) color = 0xff8800; // orange: ignored
                if (i === s.bestSlot) color = 0xffee00; // yellow: winner
                const len = interest * this.barScale;
                g.lineStyle(i === s.bestSlot ? 4 : 3, color, 0.95);
                g.lineBetween(
                    x + d.x * this.barStart,
                    y + d.y * this.barStart,
                    x + d.x * (this.barStart + len),
                    y + d.y * (this.barStart + len),
                );
            }

            // danger dot on the outer ring
            const danger = s.danger[i];
            if (danger > 0) {
                g.fillStyle(0xff0000, 0.9);
                g.fillCircle(
                    x + d.x * this.dotRadius,
                    y + d.y * this.dotRadius,
                    2 + danger * 8,
                );
            } else {
                g.fillStyle(0x444444, 0.5);
                g.fillCircle(
                    x + d.x * this.dotRadius,
                    y + d.y * this.dotRadius,
                    1.5,
                );
            }
        }

        // final output vector
        const o = s.output;
        const ox = x + o.x * 100;
        const oy = y + o.y * 100;
        g.lineStyle(3, 0xffffff, 1);
        g.lineBetween(x, y, ox, oy);
        g.fillStyle(0xffffff, 1);
        g.fillCircle(ox, oy, 5);

        // where the bot is actually aiming (magenta) and where it thinks the target is (green ring)
        if (info.aimPoint) {
            g.lineStyle(2, 0xff44ff, 0.8);
            g.lineBetween(x, y, info.aimPoint.x, info.aimPoint.y);
        }
        if (info.seenPoint) {
            g.lineStyle(2, 0x44ff44, 0.9);
            g.strokeCircle(info.seenPoint.x, info.seenPoint.y, 12);
        }

        // line of sight to nearby players
        if (info.sights && SteeringDebugger.showSight) {
            for (const sl of info.sights) {
                if (sl.visible) {
                    g.lineStyle(
                        sl.chosen ? 3 : 2,
                        0x33ff66,
                        sl.chosen ? 1 : 0.6,
                    );
                    g.lineBetween(x, y, sl.x, sl.y);
                } else {
                    const color = sl.kind === "player" ? 0xff9900 : 0xff3333;
                    g.lineStyle(2, color, 0.95);
                    g.lineBetween(x, y, sl.hitX, sl.hitY);
                    g.lineStyle(1, 0x888888, 0.35);
                    g.lineBetween(sl.hitX, sl.hitY, sl.x, sl.y);
                    g.fillStyle(color, 1);
                    g.fillCircle(sl.hitX, sl.hitY, 4);
                }
                g.lineStyle(2, sl.visible ? 0x33ff66 : 0xff3333, 0.9);
                g.strokeCircle(sl.x, sl.y, 14);
            }
        }
        // last known position: yellow X, fades as the memory gets old
        if (info.lastSeen && SteeringDebugger.showSight) {
            const fade = 1 - Math.min((info.lastSeenAge ?? 0) / 10, 1) * 0.7;
            const p = info.lastSeen;
            g.lineStyle(1, 0xffee00, 0.35 * fade);
            g.lineBetween(x, y, p.x, p.y);
            g.lineStyle(3, 0xffee00, fade);
            g.lineBetween(p.x - 10, p.y - 10, p.x + 10, p.y + 10);
            g.lineBetween(p.x - 10, p.y + 10, p.x + 10, p.y - 10);
        }
    }

    destroy() {
        this.g.destroy();
    }
}
