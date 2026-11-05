import { MathHelper } from "../../../utils/Math-Helper.js";
import { AiController } from "../../Ai-Controller.js";
import { StateMachine } from "../State-Machine.js";
import { State } from "./State.js";

export class InvestigateState extends State {
  private readonly arriveDist = 40;
  private readonly maxTime = 8; // give up after this long overall
  private readonly lookTime = 2; // how long it looks around once there

  private timer = 0;
  private lookTimer = 0;
  private arrived = false;
  private lookAngle = 0;
  private lookDir: 1 | -1 = 1;
  private stuckTimer = 0;
  private lastX = 0;
  private lastY = 0;

  constructor(player: AiController) {
    super(player);
  }

  onEnter(): void {
    const ai = this.player;
    const pos = ai.player.physicsController.position;
    this.timer = 0;
    this.lookTimer = 0;
    this.arrived = false;
    this.stuckTimer = 0;
    this.lastX = pos.x;
    this.lastY = pos.y;
    this.lookDir = Math.random() < 0.5 ? 1 : -1;
    this.player.resetStuck();
  }

  onUpdate(dt: number): void {
    const ai = this.player;
    if (this.player.stuckEvents >= 2) {
      this.giveUp();
      return;
    }
    // saw someone (the same player or a new one): back to the fight
    if (ai.bestVisible) {
      ai.chaseTarget = ai.bestVisible;
      ai.state_machine.switchState("chase");
      return;
    }

    const spot = ai.predictedLastSeen();
    if (!spot) {
      this.giveUp();
      return;
    }

    this.timer += dt;
    if (this.timer > this.maxTime) {
      this.giveUp();
      return;
    }

    const pos = ai.player.physicsController.position;

    if (!this.arrived) {
      if (ai.reachedLastSeen(this.arriveDist)) {
        this.arrived = true;
        this.lookAngle = Math.atan2(spot.y - pos.y, spot.x - pos.x);
      } else {
        // stuck against something for a second: stop trying to reach it
        this.stuckTimer += dt;
        if (this.stuckTimer >= 1) {
          if (
            MathHelper.distance(pos, {
              x: this.lastX,
              y: this.lastY,
            }) < 12
          ) {
            this.arrived = true; // treat as arrived and look around from here
          }
          this.lastX = pos.x;
          this.lastY = pos.y;
          this.stuckTimer = 0;
        }
        ai.moveToward(spot, 60);
        return;
      }
    }

    // arrived: sweep the view left and right, then leave
    this.lookTimer += dt;
    this.lookAngle += this.lookDir * 2.5 * dt;
    ai.inputState.targetX = pos.x + Math.cos(this.lookAngle) * 100;
    ai.inputState.targetY = pos.y + Math.sin(this.lookAngle) * 100;

    if (this.lookTimer >= this.lookTime) this.giveUp();
  }

  private giveUp() {
    this.player.clearLastSeen();
    this.player.chaseTarget = null;
    this.player.state_machine.switchState("wander");
  }

  onExit(): void {}
}
