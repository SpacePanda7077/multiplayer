import { MathHelper, Vec2 } from "../../../utils/Math-Helper.js";
import { AiController } from "../../Ai-Controller.js";
import { State } from "./State.js";

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class DodgeState extends State {
  private dir: Vec2 = { x: 0, y: 1 };
  private timer = 0;
  private duration = 0.45;
  private willJuke = false;
  private juked = false;

  constructor(player: AiController) {
    super(player);
  }

  onEnter(): void {
    const ai = this.player;
    const me = ai.player.physicsController.position;
    const attacker = ai.threat.attacker;

    this.timer = 0;
    this.duration = ai.profile.dodgeDuration;
    this.willJuke = Math.random() < 0.35; // sometimes reverse halfway, like a human juke
    this.juked = false;
    ai.setShooting(false);

    // a bot that was minding its own business now turns on whoever shot at it
    if (attacker) ai.noticeAttacker(attacker); // the shooter becomes the target and its position is remembered

    // step sideways, perpendicular to the attacker's aim line, on the side we're already on
    const a = ai.threat.aimDir;
    const ap = attacker ? attacker.physicsController.position : me;
    const cross = a.x * (me.y - ap.y) - a.y * (me.x - ap.x);
    let side = cross >= 0 ? 1 : -1;
    if (Math.abs(cross) < 5) side = Math.random() < 0.5 ? 1 : -1; // dead centre: pick randomly
    this.dir = side > 0 ? { x: -a.y, y: a.x } : { x: a.y, y: -a.x };

    // if there's a wall on that side, go the other way
    const blocked = (d: Vec2) =>
      !ai.hasLineOfSight({ x: me.x + d.x * 80, y: me.y + d.y * 80 });
    if (blocked(this.dir)) {
      const opp = { x: -this.dir.x, y: -this.dir.y };
      if (!blocked(opp)) this.dir = opp;
    }

    // start moving immediately instead of waiting for steering smoothing, then roll
    ai.steering.snap(this.dir.x, this.dir.y);
    ai.pressDodge();
  }

  onUpdate(dt: number): void {
    const ai = this.player;
    this.timer += dt;

    if (this.willJuke && !this.juked && this.timer > this.duration * 0.6) {
      this.dir = { x: -this.dir.x, y: -this.dir.y };
      this.juked = true;
    }

    ai.moveDir(this.dir, 1);

    // keep tracking the enemy with the same human aim, so it doesn't snap while dodging
    const target = ai.chaseTarget;
    if (target) {
      const canSee = ai.visibleTargets.includes(target);
      ai.updateHumanAim(dt, target, canSee);

      // good players keep shooting while they dodge, but only when the aim is actually on target
      if (ai.profile.shootWhileDodging && canSee) {
        const tp = target.physicsController.position;
        const dist = MathHelper.distance(
          ai.player.physicsController.position,
          tp,
        );
        const tolerance =
          Math.atan2(26, Math.max(dist, 1)) +
          lerp(0.12, 0.03, ai.profile.skill);
        ai.setShooting(ai.isAimedNear(tp, tolerance));
      } else {
        ai.setShooting(false);
      }
    } else {
      ai.setShooting(false);
    }

    if (this.timer >= this.duration) this.finish();
  }

  private finish() {
    const ai = this.player;
    const target = ai.chaseTarget;

    if (!target) {
      ai.state_machine.switchState("idle");
      return;
    }
    const dist = MathHelper.distance(
      ai.player.physicsController.position,
      target.physicsController.position,
    );
    const canSee = ai.visibleTargets.includes(target);
    ai.state_machine.switchState(
      canSee && dist <= ai.shootDistance * 1.2 ? "attack" : "chase",
    );
  }

  onExit(): void {
    this.player.setShooting(false);
  }
}
