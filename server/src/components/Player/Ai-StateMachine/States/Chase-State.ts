import { MathHelper } from "../../../utils/Math-Helper.js";
import { AiController } from "../../Ai-Controller.js";
import { State } from "./State.js";

export class ChaseState extends State {
  private readonly loseMultiplier = 1.3;
  private readonly lostSightDelay = 0.6; // seconds without a view before investigating
  private lostTimer = 0;

  constructor(player: AiController) {
    super(player);
  }

  onEnter(): void {
    this.lostTimer = 0;
    if (!this.player.chaseTarget) {
      this.player.chaseTarget = this.player.bestVisible;
    }
  }

  onUpdate(dt: number): void {
    const ai = this.player;
    let target = ai.chaseTarget;

    if (!target) {
      ai.state_machine.switchState("idle");
      return;
    }

    let canSee = ai.visibleTargets.includes(target);

    // lost the original target but can see someone else: switch to them
    if (!canSee && ai.bestVisible) {
      target = ai.chaseTarget = ai.bestVisible;
      canSee = true;
    }

    const pos = ai.player.physicsController.position;
    ai.updateHumanAim(dt, target, canSee);

    if (canSee) {
      this.lostTimer = 0;
      const tp = target.physicsController.position;
      const dist = MathHelper.distance(pos, tp);

      if (dist > ai.chaseDistance * this.loseMultiplier) {
        ai.chaseTarget = null;
        ai.state_machine.switchState("idle");
        return;
      }
      if (dist <= ai.shootDistance) {
        ai.state_machine.switchState("attack");
        return;
      }
      ai.moveToward(tp);
      return;
    }

    // can't see them: head for where they were last seen
    this.lostTimer += dt;
    const spot = ai.predictedLastSeen();
    if (!spot) {
      ai.chaseTarget = null;
      ai.state_machine.switchState("idle");
      return;
    }
    ai.moveToward(spot);

    if (this.lostTimer >= this.lostSightDelay) {
      ai.state_machine.switchState("investigate");
    }
  }

  onExit(): void {}
}
