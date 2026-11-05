import { MathHelper } from "../../../utils/Math-Helper.js";
import { AiController } from "../../Ai-Controller.js";
import { State } from "./State.js";

export class IdleState extends State {
  private readonly minTime = 1;
  private readonly maxTime = 3;
  private readonly turnSpeed = 2.5; // rad/s, how fast the head turns

  private timer = 0;
  private duration = 0;
  private lookTimer = 0;
  private lookAngle = 0;
  private wantedAngle = 0;

  constructor(player: AiController) {
    super(player);
  }

  onEnter(): void {
    const ai = this.player;
    ai.resetStuck();
    ai.inputState.isShooting = false;

    this.timer = 0;
    this.duration =
      this.minTime + Math.random() * (this.maxTime - this.minTime);
    this.lookTimer = 0;
    this.lookAngle = Math.random() * Math.PI * 2;
    this.wantedAngle = this.lookAngle;
  }

  onUpdate(dt: number): void {
    const ai = this.player;

    this.timer += dt;

    // glance somewhere new every so often, turning smoothly
    this.lookTimer -= dt;
    if (this.lookTimer <= 0) {
      this.lookTimer = 0.8 + Math.random() * 1.2;
      this.wantedAngle = this.lookAngle + (Math.random() * 2 - 1) * 1.5;
    }
    const diff = MathHelper.angleDifference(this.lookAngle, this.wantedAngle);
    const step = MathHelper.clamp(
      diff,
      -this.turnSpeed * dt,
      this.turnSpeed * dt,
    );
    this.lookAngle += step;

    const pos = ai.player.physicsController.position;
    ai.inputState.targetX = pos.x + Math.cos(this.lookAngle) * 100;
    ai.inputState.targetY = pos.y + Math.sin(this.lookAngle) * 100;

    // no moveToward call, so the bot stands still (avoidance still nudges it off other players)
    if (this.timer >= this.duration) {
      ai.state_machine.switchState("wander");
    }
  }

  onExit(): void {}
}
