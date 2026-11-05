import {
  Ray,
  QueryFilterFlags,
  type World,
  type Collider,
  type RigidBody,
} from "@dimforge/rapier2d-compat";
import { Weapons, type WeaponConfig } from "./Weapons.js";

export type Vec2 = { x: number; y: number };

export type ShootControllerOptions = {
  world: World;
  /** Weapon equipped at start. Can be changed any time with equip(). */
  weapon?: WeaponConfig;
};

export type ShotResult = {
  weaponId: string;
  damage: number;
  origin: Vec2;
  direction: Vec2;
  /** Where the ray ended (hit point, or max range if it missed). */
  end: Vec2;
  hit: boolean;
  distance: number;
  normal?: Vec2;
  collider?: Collider;
  body?: RigidBody | null;
  shooterBody?: RigidBody | null;
};

const IGNORED_TYPES = new Set(["ServerPlayer"]);

export class ShootController {
  private world: World;
  private _weapon: WeaponConfig;

  private cooldown = 0;
  private wasShooting = false;

  /** Fired once per ray after it is resolved. Use it to report hits / send to the server. */
  onShot?: (shot: ShotResult) => void;
  /** Fired only for rays that hit something. */
  onHit?: (shot: ShotResult) => void;
  /** Fired when the weapon changes. */
  onEquip?: (weapon: WeaponConfig) => void;

  constructor(options: ShootControllerOptions) {
    this.world = options.world;
    this._weapon = options.weapon ?? Weapons.list("pistols")[0];
  }

  get weapon() {
    return this._weapon;
  }

  get canFire() {
    return this.cooldown <= 0;
  }

  /** Swap the active gun. Everything (rate, pellets, visuals...) comes from the config. */
  equip(weapon: WeaponConfig) {
    if (weapon.id === this._weapon.id) return;
    this._weapon = weapon;
    this.cooldown = Math.max(this.cooldown, weapon.equipTime);
    this.wasShooting = true; // require a fresh click so semi-autos don't fire on swap
    this.onEquip?.(weapon);
  }

  /**
   * Trigger logic only: advances the cooldown, handles semi-auto vs auto, and
   * returns true when a shot should happen this step. The caller then calls fire().
   * Call once per fixed simulation step.
   */
  tick(dt: number, isShooting: boolean): boolean {
    this.cooldown = Math.max(0, this.cooldown - dt);

    const pressed = isShooting && !this.wasShooting; // rising edge
    this.wasShooting = isShooting;

    const wantsToFire = this._weapon.automatic ? isShooting : pressed;
    if (!wantsToFire || this.cooldown > 0) return false;

    this.cooldown = 1 / this._weapon.fireRate;
    return true;
  }

  /** Convenience: tick() + fire() in one call, when you don't need the gun animation hook. */
  update(
    dt: number,
    origin: Vec2,
    target: Vec2,
    isShooting: boolean,
    excludeBody?: RigidBody,
  ): ShotResult[] {
    if (!this.tick(dt, isShooting)) return [];
    return this.fire(origin, target, excludeBody);
  }

  /**
   * Fire immediately, ignoring fire rate. Returns one result per pellet.
   * `origin` is the gun pivot; the barrel tip is `weapon.muzzleOffset` along the aim.
   */
  fire(origin: Vec2, target: Vec2, excludeBody?: RigidBody): ShotResult[] {
    const w = this._weapon;
    const dx = target.x - origin.x;
    const dy = target.y - origin.y;
    if (Math.hypot(dx, dy) < 0.0001) return [];

    const baseAngle = Math.atan2(dy, dx);
    const muzzle: Vec2 = {
      x: origin.x + Math.cos(baseAngle) * w.muzzleOffset,
      y: origin.y + Math.sin(baseAngle) * w.muzzleOffset,
    };

    const results: ShotResult[] = [];
    for (let i = 0; i < w.pellets; i++) {
      const angle = baseAngle + (Math.random() - 0.5) * w.spread;
      const dir = { x: Math.cos(angle), y: Math.sin(angle) };

      // Cast from the gun pivot so a wall right at the barrel still
      // blocks the shot, but draw the visuals from the muzzle.
      const shot = this.castRay(w, origin, muzzle, dir, excludeBody);
      results.push(shot);

      this.onShot?.(shot);
      if (shot.hit) this.onHit?.(shot);
    }

    return results;
  }

  // ------------------------------------------------------------------
  // Raycast
  // ------------------------------------------------------------------

  private castRay(
    w: WeaponConfig,
    castOrigin: Vec2,
    visualOrigin: Vec2,
    dir: Vec2,
    excludeBody?: RigidBody,
  ): ShotResult {
    const ray = new Ray(castOrigin, dir);

    const hit = this.world.castRayAndGetNormal(
      ray,
      w.range,
      true, // solid: a ray starting inside a collider reports toi 0
      QueryFilterFlags.EXCLUDE_SENSORS,
      undefined, // collision groups
      undefined, // exclude collider
      excludeBody, // don't shoot yourself
      (collider) => {
        // return true to keep the collider, false to skip it
        const tag = collider.parent()?.userData as
          | { type?: string }
          | undefined;
        return !(tag?.type && IGNORED_TYPES.has(tag.type));
      },
    );

    const toi = hit ? hit.timeOfImpact : w.range;
    return {
      weaponId: w.id,
      damage: w.damage,
      origin: visualOrigin,
      direction: dir,
      end: {
        x: castOrigin.x + dir.x * toi,
        y: castOrigin.y + dir.y * toi,
      },
      hit: !!hit,
      distance: toi,
      normal: hit ? { x: hit.normal.x, y: hit.normal.y } : undefined,
      collider: hit?.collider,
      body: hit?.collider.parent() ?? null,
    };
  }
}
