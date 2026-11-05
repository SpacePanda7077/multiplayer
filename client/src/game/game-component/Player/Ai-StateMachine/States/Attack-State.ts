import { MathHelper } from "../../../utils/Math-Helper";
import { AiController } from "../../Ai-Controller";
import { State } from "./State";

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const rand = (min: number, max: number) => min + Math.random() * (max - min);

export class AttackState extends State {
    private readonly tooCloseRatio = 0.5; // back off inside shootDistance * this
    private readonly tooFarRatio = 0.9; // close in beyond shootDistance * this
    private readonly breakRatio = 1.2; // go back to chasing beyond shootDistance * this
    private readonly maxNoSight = 1.0; // seconds without a view before chasing

    private side: 1 | -1 = 1;
    private flipTimer = 0;
    private noSightTimer = 0;
    private burstOn = true;
    private burstTimer = 0;

    constructor(player: AiController) {
        super(player);
    }

    onEnter(): void {
        const ai = this.player;
        this.side = Math.random() < 0.5 ? 1 : -1;
        this.flipTimer = rand(1, 3);
        this.noSightTimer = 0;
        this.burstOn = true;
        this.burstTimer = 0;
        ai.clearGate("fire"); // fresh reaction delay before the first shot
        ai.setShooting(false);
    }

    onUpdate(dt: number): void {
        const ai = this.player;
        const skill = ai.profile.skill;
        let target = ai.chaseTarget;

        if (!target) {
            ai.state_machine.switchState("idle");
            return;
        }

        let canSee = ai.visibleTargets.includes(target);
        // lost the target but can see someone else: swap, with a fresh reaction delay
        if (!canSee && ai.bestVisible) {
            target = ai.chaseTarget = ai.bestVisible;
            canSee = true;
            ai.clearGate("fire");
        }

        const pos = ai.player.physicsController.position;
        const tp = target.physicsController.position;
        const dist = MathHelper.distance(pos, tp);

        if (dist > ai.shootDistance * this.breakRatio) {
            ai.state_machine.switchState("chase");
            return;
        }

        // 1. aim: delayed vision, limited turn speed, wobble
        ai.updateHumanAim(dt, target, canSee);

        // 2. fire: reaction delay, then only when the real aim is close enough, in bursts
        const ready = ai.react("fire", canSee, dt);
        // rookies fire when roughly on target, pros wait until it is tight
        const tolerance =
            Math.atan2(26, Math.max(dist, 1)) + lerp(0.12, 0.03, skill);
        const onTarget = canSee && ai.isAimedNear(tp, tolerance);

        this.burstTimer -= dt;
        if (this.burstTimer <= 0) {
            this.burstOn = !this.burstOn;
            this.burstTimer = this.burstOn
                ? lerp(0.3, 1.0, skill) * rand(0.7, 1.3) // firing time
                : lerp(0.5, 0.2, skill) * rand(0.7, 1.3); // pause
        }
        ai.setShooting(ready && onTarget && this.burstOn);

        // 3. lost sight for too long: go look for them
        if (canSee) {
            this.noSightTimer = 0;
        } else {
            this.noSightTimer += dt;
            if (this.noSightTimer > this.maxNoSight) {
                ai.state_machine.switchState("chase");
                return;
            }
        }

        // 4. movement: strafe, flipping direction now and then, and hold a comfortable distance
        this.flipTimer -= dt;
        if (this.flipTimer <= 0) {
            this.side = (this.side * -1) as 1 | -1;
            this.flipTimer = rand(1, 3);
        }
        ai.strafe(tp, this.side, 0.7);

        if (dist < ai.shootDistance * this.tooCloseRatio) {
            ai.moveAway(tp, 0.9);
        } else if (dist > ai.shootDistance * this.tooFarRatio) {
            ai.moveToward(tp);
        }
    }

    onExit(): void {
        this.player.setShooting(false);
    }
}
