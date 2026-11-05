import { Scene } from "phaser";
import { PhysicsController, type PhysicsState } from "./Physics";
import { type World } from "@dimforge/rapier2d-compat";
import { PlayerInputState } from "../Input-Controller/PlayerInputs";
import { ShootController } from "../shoot-Controller/Shoot-Controller";
import { Player } from "./Player";
import { Trigger } from "../shared/Trigger.js";
export type Config = {
    x: number;
    y: number;
    world: World;
    shootController: ShootController;
    player: Player;
};
const RECOIL_IMPULSE = 70;

/** Everything the reconciler rewinds to: movement state + trigger state. */
export type ServerPlayerState = PhysicsState & {
    cooldown: number;
    wasShooting: boolean;
};

export class ServerPlayer {
    scene: Scene;
    body: Phaser.GameObjects.Container;
    sprite: Phaser.GameObjects.Arc;
    physicsController: PhysicsController;
    firedThisStep = false;
    shootController: ShootController;
    trigger: Trigger;
    player: Player;
    constructor(scene: Scene, config: Config) {
        this.scene = scene;
        this.shootController = config.shootController;
        this.trigger = new Trigger();
        this.player = config.player;
        this.createPlayer(config);
    }

    createPlayer(config: Config) {
        this.body = this.scene.add.container(config.x, config.y).setDepth(1000);
        this.sprite = this.scene.add
            .circle(0, 0, 32, 0xfff000)
            .setOrigin(0.5, 1)
            .setAlpha(0.7);
        this.body.add(this.sprite);
        this.physicsController = new PhysicsController({
            ...config,
            type: "ServerPlayer",
        });
    }
    update(dt: number, inputState: PlayerInputState) {
        this.physicsController.update(inputState, dt);
        this.handleFire(dt, inputState);
        if (this.firedThisStep) {
            this.firedThisStep = false;
        }
        this.setPosition();
    }

    setPosition() {
        const position = this.physicsController.position;
        this.body.setPosition(position.x, position.y);
    }
    private handleFire(dt: number, input: PlayerInputState) {
        // no shooting mid-dodge. tick() owns the cooldown, fire rate and semi/auto logic.
        const shooting = input.isShooting && !this.physicsController.isDodging; // same on all three
        if (!this.trigger.tick(dt, shooting, this.player.activeWeapon)) return;

        const recoil = this.player.activeWeapon.recoil;

        // 1. pushes the player back, away from the aim (real physics)
        this.physicsController.applyRecoil(input, RECOIL_IMPULSE * recoil);

        this.firedThisStep = true;
    }

    syncWithServer(x: number, y: number) {
        this.physicsController.teleport(x, y);
        this.body.setPosition(x, y);
    }

    /** Rewind to the server's state before replaying inputs. */
    setState(s: ServerPlayerState) {
        this.physicsController.setState(s);
        this.trigger.cooldown = s.cooldown;
        this.trigger.wasShooting = s.wasShooting;
    }

    getState(): ServerPlayerState {
        return {
            ...this.physicsController.getState(),
            cooldown: this.trigger.cooldown,
            wasShooting: this.trigger.wasShooting,
        };
    }
}
