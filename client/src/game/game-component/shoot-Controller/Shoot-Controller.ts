import { BlendModes, Scene } from "phaser";
import {
    Collider,
    Ray,
    QueryFilterFlags,
    type World,
    type RigidBody,
} from "@dimforge/rapier2d-compat";
import { Weapons, type WeaponConfig } from "./Weapons";

export type Vec2 = { x: number; y: number };

export type ShootControllerOptions = {
    world: World;
    /** Weapon equipped at start. Can be changed any time with equip(). */
    weapon?: WeaponConfig;
    /** Draw the raw ray for a moment (debugging). */
    debugRay?: boolean;
    depth?: number;
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
    private scene: Scene;
    private world: World;
    private _weapon: WeaponConfig;
    private debugRay: boolean;
    private depth: number;

    private cooldown = 0;
    private wasShooting = false;
    private graphicsPool: Phaser.GameObjects.Graphics[] = [];

    /** Fired once per ray after it is resolved. Use it to report hits / send to the server. */
    onShot?: (shot: ShotResult) => void;
    /** Fired only for rays that hit something. */
    onHit?: (shot: ShotResult) => void;
    /** Fired when the weapon changes. */
    onEquip?: (weapon: WeaponConfig) => void;

    constructor(scene: Scene, options: ShootControllerOptions) {
        this.scene = scene;
        this.world = options.world;
        this._weapon = options.weapon ?? Weapons.list("pistols")[0];
        this.debugRay = options.debugRay ?? false;
        this.depth = options.depth ?? 900;
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
    // update(
    //     dt: number,
    //     origin: Vec2,
    //     target: Vec2,
    //     isShooting: boolean,
    //     excludeBody?: RigidBody,
    // ): ShotResult[] {
    //     if (!this.tick(dt, isShooting)) return [];
    //     return this.fire(origin, target, excludeBody);
    // }

    /**
     * Fire immediately, ignoring fire rate. Returns one result per pellet.
     * `origin` is the gun pivot; the barrel tip is `weapon.muzzleOffset` along the aim.
     */
    fire(
        origin: Vec2,
        target: Vec2,
        w: WeaponConfig,
        excludeBody?: RigidBody,
    ): ShotResult[] {
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

            this.spawnTracer(w, muzzle, shot.end);
            if (shot.hit) this.spawnImpact(w, shot.end, shot.normal);
            if (this.debugRay) this.spawnDebugRay(muzzle, shot.end);

            this.onShot?.(shot);
            if (shot.hit) this.onHit?.(shot);
        }

        this.playMuzzleFlash(w, muzzle, baseAngle);
        if (w.visuals.shake > 0) {
            this.scene.cameras.main.shake(50, w.visuals.shake);
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
            shooterBody: excludeBody ?? null,
        };
    }

    // ------------------------------------------------------------------
    // Visuals (all driven by the weapon's visuals config)
    // ------------------------------------------------------------------

    private spawnTracer(w: WeaponConfig, from: Vec2, to: Vec2) {
        const v = w.visuals;
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 1) return;
        const ux = dx / dist;
        const uy = dy / dist;

        const g = this.acquireGraphics();
        const state = { t: 0 };
        const duration = Math.max(30, (dist / v.tracerSpeed) * 1000);

        this.scene.tweens.add({
            targets: state,
            t: 1,
            duration,
            ease: "Linear",
            onUpdate: () => {
                const head = state.t * dist;
                const tail = Math.max(0, head - v.tracerLength);
                const x1 = from.x + ux * tail;
                const y1 = from.y + uy * tail;
                const x2 = from.x + ux * head;
                const y2 = from.y + uy * head;

                g.clear();
                g.lineStyle(v.tracerWidth * 3, v.tracerColor, 0.25); // glow
                g.lineBetween(x1, y1, x2, y2);
                g.lineStyle(v.tracerWidth, 0xffffff, 1); // hot core
                g.lineBetween(x1, y1, x2, y2);
            },
            onComplete: () => this.releaseGraphics(g),
        });
    }

    private playMuzzleFlash(w: WeaponConfig, pos: Vec2, angle: number) {
        const v = w.visuals;
        const position = {
            x: pos.x + Math.cos(angle) * 10,
            y: pos.y + Math.sin(angle) * 10,
        };
        const flash = this.scene.add
            .ellipse(
                position.x,
                position.y,
                34 * v.muzzleFlashScale,
                18 * v.muzzleFlashScale,
                v.muzzleFlashColor,
                0.95,
            )
            .setRotation(angle)
            .setDepth(this.depth + 1);
        const light = this.scene.add
            .image(position.x, position.y, "shoot_light") // radial gradient texture
            .setTint(v.muzzleFlashColor)
            .setBlendMode(BlendModes.ADD)
            .setScale(3)
            .setAlpha(0.25)
            .setDepth(this.depth);

        this.scene.tweens.add({
            targets: flash,
            scaleX: 0.4,
            scaleY: 0.2,
            alpha: 0,
            duration: 70,
            ease: "Quad.easeOut",
            onComplete: () => {
                flash.destroy();
            },
        });
        this.scene.tweens.add({
            targets: light,
            alpha: 0,
            scale: 0.6,
            duration: 90,
            onComplete: () => light.destroy(),
        });
    }

    private spawnImpact(w: WeaponConfig, pos: Vec2, normal?: Vec2) {
        const v = w.visuals;
        const depth = this.depth + 1;

        const ring = this.scene.add
            .circle(pos.x, pos.y, 4, v.impactColor, 0)
            .setStrokeStyle(2, v.impactColor, 1)
            .setDepth(depth);
        this.scene.tweens.add({
            targets: ring,
            scale: 3,
            alpha: 0,
            duration: 160,
            ease: "Quad.easeOut",
            onComplete: () => ring.destroy(),
        });

        const baseAngle = normal
            ? Math.atan2(normal.y, normal.x)
            : Math.random() * Math.PI * 2;
        for (let i = 0; i < v.impactSparks; i++) {
            const a = baseAngle + (Math.random() - 0.5) * Math.PI * 0.9;
            const speed = 40 + Math.random() * 60;
            const spark = this.scene.add
                .circle(pos.x, pos.y, 1.5 + Math.random() * 1.5, v.impactColor)
                .setDepth(depth);
            this.scene.tweens.add({
                targets: spark,
                x: pos.x + Math.cos(a) * speed,
                y: pos.y + Math.sin(a) * speed,
                alpha: 0,
                scale: 0.2,
                duration: 180 + Math.random() * 120,
                ease: "Quad.easeOut",
                onComplete: () => spark.destroy(),
            });
        }
    }

    private spawnDebugRay(from: Vec2, to: Vec2) {
        const g = this.acquireGraphics();
        g.clear();
        g.lineStyle(1, 0xff0000, 0.8);
        g.lineBetween(from.x, from.y, to.x, to.y);
        this.scene.time.delayedCall(120, () => this.releaseGraphics(g));
    }

    // ------------------------------------------------------------------
    // Graphics pool
    // ------------------------------------------------------------------

    private acquireGraphics() {
        const g =
            this.graphicsPool.pop() ??
            this.scene.add.graphics().setDepth(this.depth);
        g.setVisible(true);
        return g;
    }

    private releaseGraphics(g: Phaser.GameObjects.Graphics) {
        g.clear();
        g.setVisible(false);
        this.graphicsPool.push(g);
    }

    destroy() {
        for (const g of this.graphicsPool) g.destroy();
        this.graphicsPool.length = 0;
    }
}
