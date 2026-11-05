import { PhysicsController } from "./Physics.js";
import { type World } from "@dimforge/rapier2d-compat";
import { PlayerInputState } from "../Input-Controller/PlayerInputs.js";
import { ShootController } from "../shoot-Controller/Shoot-Controller.js";
import { gunPivot } from "../shared/GunPivots.js";
import { Trigger } from "../shared/Trigger.js";
import { Inventory, InventoryType } from "../shared/Inventory.js";
import { Weapons } from "../shoot-Controller/Weapons.js";
export type Config = {
  x: number;
  y: number;
  world: World;
  shootController: ShootController;
  inventory: InventoryType;
};

const RECOIL_IMPULSE = 70; // px/s push on the player per shot (physics applyRecoil)

export class Player {
  physicsController: PhysicsController;

  firedThisStep = true;
  shootController: ShootController;
  trigger: Trigger;
  inventory: Inventory;
  activeWeapon: import("../shoot-Controller/Weapons.js").WeaponConfig;
  aimAngle = 0;
  isShooting = false;
  shotsFired = 0;
  constructor(config: Config) {
    this.shootController = config.shootController;
    this.trigger = new Trigger();
    this.setUpInventory(config.inventory);
    this.activeWeapon = this.inventory.primary;
    this.createPlayer(config);
  }

  createPlayer(config: Config) {
    this.physicsController = new PhysicsController(config);
  }
  update(dt: number, inputState: PlayerInputState) {
    this.physicsController.update(inputState, dt);
    const pos = this.physicsController.position;
    this.aimAngle = Math.atan2(
      inputState.targetY - pos.y,
      inputState.targetX - pos.x,
    );
    this.isShooting = inputState.isShooting;
    this.handleFire(dt, inputState);
    if (this.firedThisStep) {
      this.firedThisStep = false;
      this.onFire(inputState);
    }
  }

  private handleFire(dt: number, input: PlayerInputState) {
    // no shooting mid-dodge. tick() owns the cooldown, fire rate and semi/auto logic.
    const shooting = input.isShooting && !this.physicsController.isDodging; // same on all three
    if (!this.trigger.tick(dt, shooting, this.activeWeapon)) return;

    const recoil = this.activeWeapon.recoil;

    // 1. pushes the player back, away from the aim (real physics)
    this.physicsController.applyRecoil(input, RECOIL_IMPULSE * recoil);

    this.firedThisStep = true;
    this.shotsFired++;
  }

  onFire = (input: PlayerInputState) => {
    this.shootController.fire(
      gunPivot(this.physicsController.position),
      { x: input.targetX, y: input.targetY },
      this.physicsController.rigidBody,
    );
  };

  getState(inputState: PlayerInputState) {
    const p = this.physicsController.rigidBody.translation();
    const v = this.physicsController.velocity;

    return {
      x: p.x,
      y: p.y,
      vx: v.x,
      vy: v.y,
      targetX: inputState.targetX,
      targetY: inputState.targetY,
      shotsFired: this.shotsFired,
      isShooting: inputState.isShooting,
      isDodging: this.physicsController.isDodging,
      cooldown: this.trigger.cooldown,
      wasShooting: this.trigger.wasShooting,
    };
  }

  setUpInventory(inventory: InventoryType) {
    const primary_weapon = Weapons.list(inventory.primary.category)[
      inventory.primary.weapon
    ];
    const secondary_weapon = Weapons.list(inventory.secondary.category)[
      inventory.secondary.weapon
    ];

    this.inventory = {
      primary: primary_weapon,
      secondary: secondary_weapon,
      ammos: inventory.ammos,
      granades: inventory.granades,
    };
  }
}
