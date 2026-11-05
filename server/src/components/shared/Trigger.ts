// shared/Trigger.ts
export class Trigger {
  cooldown = 0;
  wasShooting = false;

  tick(
    dt: number,
    isShooting: boolean,
    w: { automatic: boolean; fireRate: number },
  ) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    const pressed = isShooting && !this.wasShooting;
    this.wasShooting = isShooting;
    const wants = w.automatic ? isShooting : pressed;
    if (!wants || this.cooldown > 0) return false;
    this.cooldown = 1 / w.fireRate;
    return true;
  }
}
