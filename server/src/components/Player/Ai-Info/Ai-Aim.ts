import { MathHelper, Vec2 } from "../../utils/Math-Helper.js";
import { AiProfile } from "./Ai-Profile.js";

export class AiAim {
  /** Current aim direction in radians. */
  angle = 0;
  /** World point the bot is aiming at (written to inputState.targetX/Y). */
  readonly point: Vec2 = { x: 0, y: 0 };
  /** Target speed (units/s) at which the moving-target penalty is at full strength. */
  fastTargetSpeed = 250;

  private hasAngle = false;
  private errorAngle = 0;
  private errorTarget = 0;
  private errorTimer = 0;
  private settle = 0;
  private lastX = 0;
  private lastY = 0;
  private hasLast = false;
  private targetSpeed = 0;

  /** Call when the bot switches to a new target: aim starts sloppy again. */
  reset() {
    this.settle = 0;
    this.hasLast = false;
    this.targetSpeed = 0;
  }

  /** Start aiming from the bot's current facing instead of snapping onto the target. */
  seed(angle: number) {
    this.angle = angle;
    this.hasAngle = true;
  }

  update(dt: number, origin: Vec2, seen: Vec2, p: AiProfile) {
    const dx = seen.x - origin.x;
    const dy = seen.y - origin.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const desired = Math.atan2(dy, dx);
    if (!this.hasAngle) {
      this.angle = desired;
      this.hasAngle = true;
    }

    // estimate how fast the target is moving (as the bot sees it)
    if (this.hasLast && dt > 0) {
      const sp = Math.hypot(seen.x - this.lastX, seen.y - this.lastY) / dt;
      this.targetSpeed += (sp - this.targetSpeed) * Math.min(1, dt * 6);
    }
    this.lastX = seen.x;
    this.lastY = seen.y;
    this.hasLast = true;

    // aim gets steadier the longer it stays on the same target
    this.settle = Math.min(1, this.settle + dt / Math.max(0.01, p.settleTime));

    // pick a new error offset every 0.15-0.4s, then drift towards it
    this.errorTimer -= dt;
    if (this.errorTimer <= 0) {
      this.errorTimer = 0.15 + Math.random() * 0.25;
      const speedFactor =
        1 +
        p.movingTargetPenalty *
          MathHelper.clamp(this.targetSpeed / this.fastTargetSpeed, 0, 1);
      const settleFactor = 1 + (1 - this.settle) * 1.5;
      const maxErr =
        ((p.aimErrorDeg * Math.PI) / 180) * speedFactor * settleFactor;
      // triangular distribution: small errors are more common than big ones
      this.errorTarget = (Math.random() + Math.random() - 1) * maxErr;
    }
    this.errorAngle +=
      (this.errorTarget - this.errorAngle) * (1 - Math.exp(-8 * dt));

    // turn towards (true angle + error), limited by max turn speed
    const want = desired + this.errorAngle;
    const diff = MathHelper.angleDifference(this.angle, want);
    const smooth = diff * (1 - Math.exp(-p.aimSmoothing * dt));
    const maxStep = p.aimTurnSpeed * dt;
    this.angle += MathHelper.clamp(smooth, -maxStep, maxStep);

    const d = Math.max(dist, 60);
    this.point.x = origin.x + Math.cos(this.angle) * d;
    this.point.y = origin.y + Math.sin(this.angle) * d;
  }
}
