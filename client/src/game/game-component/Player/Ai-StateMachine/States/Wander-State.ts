import { MathHelper, Vec2 } from "../../../utils/Math-Helper";
import { AiController } from "../../Ai-Controller";
import { State } from "./State";

// Optional: keep bots inside the playable area. Set to your map size, or leave null.
const WORLD_BOUNDS: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
} | null = null;

export class WanderState extends State {
    private readonly reachDistance = 24; // close enough = arrived
    private readonly slowRadius = 80; // starts slowing down inside this
    private readonly minWander = 150;
    private readonly maxWander = 400;
    private readonly maxTime = 6; // give up after this many seconds

    private target: Vec2 | null = null;
    private timer = 0;

    constructor(player: AiController) {
        super(player);
    }

    onEnter(): void {
        const ai = this.player;
        ai.resetStuck();
        ai.inputState.isShooting = false;

        this.timer = 0;
        this.target = this.pickTarget();
    }

    /** Random point relative to the bot, with nothing between us and it. */
    private pickTarget(): Vec2 | null {
        const ai = this.player;
        const pos = ai.player.physicsController.position;

        for (let i = 0; i < 8; i++) {
            const angle = Math.random() * Math.PI * 2;
            const r =
                this.minWander +
                Math.random() * (this.maxWander - this.minWander);
            let x = pos.x + Math.cos(angle) * r;
            let y = pos.y + Math.sin(angle) * r;

            if (WORLD_BOUNDS) {
                x = MathHelper.clamp(x, WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX);
                y = MathHelper.clamp(y, WORLD_BOUNDS.minY, WORLD_BOUNDS.maxY);
            }

            const t = { x, y };
            if (ai.hasLineOfSight(t)) return t;
        }
        return null; // boxed in, nothing clear found
    }

    onUpdate(dt: number): void {
        const ai = this.player;
        const target = this.target;

        if (!target) {
            ai.state_machine.switchState("idle");
            return;
        }

        const pos = ai.player.physicsController.position;
        this.timer += dt;

        // arrived, took too long, or keeps getting stuck on walls
        if (
            MathHelper.distance(pos, target) <= this.reachDistance ||
            this.timer > this.maxTime ||
            ai.stuckEvents >= 2
        ) {
            ai.state_machine.switchState("idle");
            return;
        }

        ai.moveToward(target, this.slowRadius);

        // look where we're walking
        const m = ai.steering.output;
        if (m.x * m.x + m.y * m.y > 0.01) {
            ai.inputState.targetX = pos.x + m.x * 100;
            ai.inputState.targetY = pos.y + m.y * 100;
        }
    }

    onExit(): void {
        this.target = null;
    }
}
