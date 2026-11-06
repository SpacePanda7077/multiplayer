import {
  type Collider,
  ColliderDesc,
  type KinematicCharacterController,
  QueryFilterFlags,
  type RigidBody,
  RigidBodyDesc,
  type World,
} from "@dimforge/rapier2d-compat";
import { PlayerInputState } from "../Input-Controller/PlayerInputs.js";

export type Config = {
  x: number;
  y: number;
  type?: string;
  world: World;
  maxSpeed?: number; // px/s
  acceleration?: number; // px/s^2 while input is held
  deceleration?: number; // px/s^2 while input is released
};

type Vec2 = { x: number; y: number };

/**
 * EVERYTHING that influences the next step of the movement sim.
 * The server writes this into the schema, the client rewinds to it before a replay.
 * If you add a field to the controller that affects movement, add it here too.
 */
export type PhysicsState = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rvx: number; // recoil velocity
  rvy: number;
  isDodging: boolean;
  dodgeTime: number;
  cooldownTime: number;
  dodgeDirX: number;
  dodgeDirY: number;
  lastMoveX: number;
  lastMoveY: number;
  prevDodgeInput: boolean;
};

export class PhysicsController {
  world: World;
  rigidBody: RigidBody;
  collider: Collider;
  charcterController: KinematicCharacterController;

  // Movement
  velocity: Vec2 = { x: 0, y: 0 };
  maxSpeed: number;
  acceleration: number;
  deceleration: number;

  // Dodge tuning
  dodgeSpeed = 800; // px/s at the start of the dodge
  dodgeDuration = 0.8; // seconds
  dodgeCooldown = 0.05; // seconds after the dodge ends
  dodgeEndSpeed = 0.3; // fraction of dodgeSpeed left at the end

  // Recoil tuning
  recoilImpulse = 220; // px/s kick added per shot
  recoilDamping = 12; // higher = recoil dies faster
  maxRecoilSpeed = 450; // cap so rapid fire can't launch you
  recoilDuringDodge = false; // ignore recoil while dodging

  // Recoil state (separate from movement velocity, so they don't fight)
  recoilVelocity: Vec2 = { x: 0, y: 0 };

  // Dodge state
  isDodging = false;
  invulnerable = false; // read this from your damage code
  private dodgeTime = 0;
  private cooldownTime = 0;
  private dodgeDir: Vec2 = { x: 0, y: 1 };
  private lastMoveDir: Vec2 = { x: 0, y: 1 }; // fallback when standing still
  private prevDodgeInput = false;
  type: string;

  constructor(config: Config) {
    this.world = config.world;
    this.maxSpeed = config.maxSpeed ?? 0;
    this.type = config.type ?? "Player";
    this.acceleration = config.acceleration ?? 2200;
    this.deceleration = config.deceleration ?? 2400;
    this.createBody(config);
  }

  createBody(config: Config) {
    const rigidBodyDesc = RigidBodyDesc.kinematicPositionBased()
      .setTranslation(config.x, config.y)
      .setUserData({ type: this.type });
    this.rigidBody = this.world.createRigidBody(rigidBodyDesc);
    const colliderDesc = ColliderDesc.ball(45).setTranslation(0, -45);
    this.collider = this.world.createCollider(colliderDesc, this.rigidBody);
    this.charcterController = this.world.createCharacterController(0.01);
    this.charcterController.setSlideEnabled(true); // slide along walls
  }

  // ------------------------------------------------------------ state sync

  /**
   * Moves the body AND its collider right now. Nothing waits for world.step(), so
   * the next computeColliderMovement() always starts from where we say we are.
   * (Replays on the client never step the world, so this matters there.)
   */
  teleport(x: number, y: number) {
    this.rigidBody.setTranslation({ x, y }, true);
    this.world.propagateModifiedBodyPositionsToColliders();
  }

  getState(): PhysicsState {
    const p = this.rigidBody.translation();
    return {
      x: p.x,
      y: p.y,
      vx: this.velocity.x,
      vy: this.velocity.y,
      rvx: this.recoilVelocity.x,
      rvy: this.recoilVelocity.y,
      isDodging: this.isDodging,
      dodgeTime: this.dodgeTime,
      cooldownTime: this.cooldownTime,
      dodgeDirX: this.dodgeDir.x,
      dodgeDirY: this.dodgeDir.y,
      lastMoveX: this.lastMoveDir.x,
      lastMoveY: this.lastMoveDir.y,
      prevDodgeInput: this.prevDodgeInput,
    };
  }

  setState(s: PhysicsState) {
    this.teleport(s.x, s.y);
    this.velocity.x = s.vx;
    this.velocity.y = s.vy;
    this.recoilVelocity.x = s.rvx;
    this.recoilVelocity.y = s.rvy;
    this.isDodging = s.isDodging;
    this.invulnerable = s.isDodging;
    this.dodgeTime = s.dodgeTime;
    this.cooldownTime = s.cooldownTime;
    this.dodgeDir = { x: s.dodgeDirX, y: s.dodgeDirY };
    this.lastMoveDir = { x: s.lastMoveX, y: s.lastMoveY };
    this.prevDodgeInput = s.prevDodgeInput;
  }

  // ---------------------------------------------------------------- update

  /** Call once per fixed step. dt is in seconds. */
  update(input: PlayerInputState, dt: number) {
    // Normalize move input so diagonals aren't faster
    let ix = input.moveX;
    let iy = input.moveY;
    const len = Math.hypot(ix, iy);
    if (len > 1) {
      ix /= len;
      iy /= len;
    }
    const hasInput = len > 0.001;
    if (hasInput) {
      const l = Math.hypot(ix, iy);
      this.lastMoveDir = { x: ix / l, y: iy / l };
    }

    // Cooldown tick
    if (this.cooldownTime > 0) this.cooldownTime -= dt;

    // Start a dodge on the rising edge of the button
    const dodgePressed = input.dodge && !this.prevDodgeInput;
    this.prevDodgeInput = input.dodge;
    if (dodgePressed && !this.isDodging && this.cooldownTime <= 0) {
      this.startDodge(this.lastMoveDir);
    }

    if (this.isDodging) {
      this.updateDodge(dt);
    } else {
      this.updateMovement(ix, iy, hasInput, dt);
    }
  }

  private updateMovement(
    ix: number,
    iy: number,
    hasInput: boolean,
    dt: number,
  ) {
    const rate = (hasInput ? this.acceleration : this.deceleration) * dt;
    this.velocity.x = moveToward(this.velocity.x, ix * this.maxSpeed, rate);
    this.velocity.y = moveToward(this.velocity.y, iy * this.maxSpeed, rate);
    this.applyVelocity(dt);
  }

  private startDodge(dir: Vec2) {
    this.isDodging = true;
    this.invulnerable = true;
    this.dodgeTime = 0;
    this.dodgeDir = { x: dir.x, y: dir.y };
  }

  private updateDodge(dt: number) {
    this.dodgeTime += dt;
    const t = Math.min(this.dodgeTime / this.dodgeDuration, 1);

    // Ease out: fast at the start, slower at the end
    const eased = 1 - t * t;
    const speed =
      this.dodgeSpeed * (this.dodgeEndSpeed + (1 - this.dodgeEndSpeed) * eased);

    this.velocity.x = this.dodgeDir.x * speed;
    this.velocity.y = this.dodgeDir.y * speed;
    this.applyVelocity(dt);

    if (t >= 1) {
      this.isDodging = false;
      this.invulnerable = false;
      this.cooldownTime = this.dodgeCooldown;
      // Hand momentum back to normal movement so the exit isn't abrupt
      this.velocity.x = this.dodgeDir.x * this.maxSpeed;
      this.velocity.y = this.dodgeDir.y * this.maxSpeed;
    }
  }

  /**
   * Call when a shot is actually fired (your weapon decides the fire rate).
   * Kicks the player opposite to the aim direction.
   * Pass a custom impulse for heavier or lighter weapons.
   */
  applyRecoil(input: PlayerInputState, impulse = this.recoilImpulse) {
    if (this.isDodging && !this.recoilDuringDodge) return;

    const pos = this.rigidBody.translation();
    const dx = input.targetX - pos.x;
    const dy = input.targetY - pos.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.001) return;

    this.recoilVelocity.x -= (dx / len) * impulse;
    this.recoilVelocity.y -= (dy / len) * impulse;

    // Clamp total recoil speed
    const speed = Math.hypot(this.recoilVelocity.x, this.recoilVelocity.y);
    if (speed > this.maxRecoilSpeed) {
      const k = this.maxRecoilSpeed / speed;
      this.recoilVelocity.x *= k;
      this.recoilVelocity.y *= k;
    }
  }

  private decayRecoil(dt: number) {
    // Frame-rate independent exponential decay
    const k = Math.exp(-this.recoilDamping * dt);
    this.recoilVelocity.x *= k;
    this.recoilVelocity.y *= k;
    if (Math.abs(this.recoilVelocity.x) < 0.5) this.recoilVelocity.x = 0;
    if (Math.abs(this.recoilVelocity.y) < 0.5) this.recoilVelocity.y = 0;
  }

  private applyVelocity(dt: number) {
    // Movement + recoil are added together for the actual displacement
    const desired = {
      x: (this.velocity.x + this.recoilVelocity.x) * dt,
      y: (this.velocity.y + this.recoilVelocity.y) * dt,
    };
    this.charcterController.computeColliderMovement(
      this.collider,
      desired,
      QueryFilterFlags.EXCLUDE_KINEMATIC,
    );
    const moved = this.charcterController.computedMovement();

    // Apply the move immediately (body + collider), not on the next world.step().
    const pos = this.rigidBody.translation();
    this.teleport(pos.x + moved.x, pos.y + moved.y);

    // Zero velocity on blocked axes so you don't stick to walls
    if (dt > 0) {
      if (Math.abs(moved.x) < Math.abs(desired.x) * 0.5) {
        this.velocity.x = 0;
        this.recoilVelocity.x = 0;
      }
      if (Math.abs(moved.y) < Math.abs(desired.y) * 0.5) {
        this.velocity.y = 0;
        this.recoilVelocity.y = 0;
      }
    }

    this.decayRecoil(dt);
  }

  get position() {
    return this.rigidBody.translation();
  }

  /** 0..1 progress through the current dodge, handy for animation. */
  get dodgeProgress() {
    return this.isDodging ? this.dodgeTime / this.dodgeDuration : 0;
  }

  get dodgeDirection(): Vec2 {
    return this.dodgeDir;
  }
}

function moveToward(current: number, target: number, maxDelta: number) {
  const diff = target - current;
  if (Math.abs(diff) <= maxDelta) return target;
  return current + Math.sign(diff) * maxDelta;
}
