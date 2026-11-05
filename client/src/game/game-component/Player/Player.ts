import { GameObjects, Scene, Types, Math as PMath } from "phaser";
import { PhysicsController } from "./Physics";
import { type World } from "@dimforge/rapier2d-compat";
import { PlayerInputState } from "../Input-Controller/PlayerInputs";
import { type ShootController } from "../shoot-Controller/Shoot-Controller";
import { Weapons, type WeaponConfig } from "../shoot-Controller/Weapons";
import { gunPivot } from "../shared/GunPivots";
import { Trigger } from "../shared/Trigger";
import { Inventory, InventoryType } from "../shared/Inventory";

export type Config = {
    x: number;
    y: number;
    world: World;
    shootController: ShootController;
    inventory: InventoryType;
};

type serverState = {
    x: number;
    y: number;
    vx: number;
    vy: number;
    targetX: number;
    targetY: number;
    shotsFired: number;
    isShooting: boolean;
    isDodging: boolean;
};

/** Gives the neck position at a height y (writes into `out`) and returns the heading in radians from straight up. */
type NeckPlacer = (y: number, out: Types.Math.Vector2Like) => number;

// ---- layout (character is a rod: feet at the body origin, head at the top)
const SEGMENTS = 40;
const CHAR_HEIGHT = 128; // rope length = character height
const HALF = CHAR_HEIGHT / 2;
const BODY_SIZE = 64;
const ROPE_Y = -HALF; // rope top, relative to the pivot (middle of the character)

// flexible neck section, as fractions of the height (0 = top of the rope)
const NECK_START = 0.4;
const NECK_END = 0.75;
const EYE = NECK_START; // height of the face / where the aim is measured from

// ---- face
const EYE_OFFSET_X = 0; // px, shifts the face sideways off the neck line (+ = right of the neck)
const FACE_SMOOTHING = 14; // how fast the face turns toward the target
const FACE_MAX_ANGLE = 50; // degrees, how far the face can turn up / down from straight ahead

// ---- walk
const HOP_HZ = 3;
const HOP_SCALE = 0.1;
const HOP_LIFT = 10;

// ---- dive roll
const DIVE_FRACTION = 0.4;
const DIVE_LIFT = 1;
const NECK_CURL = 110;
const LAND_FRACTION = 0.12;

// ---- aiming
const MAX_BEND = 60; // degrees, max neck bend toward the aim
const BEND_STRENGTH = 1; // 1 = turns fully toward the target
const BEND_DIRECTION: 1 | -1 = 1; // flip to -1 if the neck bends the wrong way
const SMOOTHING = 12; // how fast the neck follows the aim

// ---- shooting (base values, each weapon scales them with its `recoil`)
const RECOIL_IMPULSE = 70; // px/s push on the player per shot (physics applyRecoil)
const GUN_BASE = { x: 0, y: 32 }; // where the gun pivots (visuals space)
const GUN_ORIGIN_X = 0.2; // pivot position along the gun (0 = butt, 1 = tip)
const GUN_THICKNESS = 20;
const GUN_REST_ANGLE = 0.3; // radians, gun angle when not aiming
const GUN_KICK = 18; // px the gun slides back per shot
const GUN_KICK_MAX = 40;
const GUN_RECOVERY = 16; // higher = gun returns faster
const NECK_RECOIL = 12; // rad/s the neck snaps back per shot
const NECK_STIFFNESS = 180; // spring stiffness, higher = returns faster
const NECK_DAMPING = 7; // lower = swings for longer

export class Player {
    scene: Scene;
    body: Phaser.GameObjects.Container; // follows physics (feet at 0,0)
    visuals: Phaser.GameObjects.Container; // pivot = middle of the character
    rect: Phaser.GameObjects.Rectangle;
    physicsController: PhysicsController;
    sprite: Phaser.GameObjects.Rope;

    gun: Phaser.GameObjects.Rectangle;
    debugGfx: Phaser.GameObjects.Graphics;
    shootController: ShootController;

    debugEnabled = false; // F2 toggles

    /**
     * World position of the animated gun pivot (un-kicked), updated every frame.
     * Visual only. Shots use gunPivot(feet) from the shared module so the client
     * ray matches the server's.
     */
    readonly gunPivotWorld = new PMath.Vector2();

    private facing: 1 | -1 = 1;
    private rollSpin: 1 | -1 = 1;
    private wasRolling = false;
    private walkTime = 0;
    private walkWeight = 0;
    private swayPhase = 0;
    private swayWeight = 0;
    private currentAngle = 0; // radians, neck bend from aim + sway
    private rollBend = 0; // radians, extra curl while rolling
    private faceAngle = 0; // radians, rotation of the face in visuals space

    // shooting state
    private firedThisStep = false;
    private gunKick = 0; // px the gun is pushed back right now, fades to 0
    private neckRecoilAngle = 0; // radians, + = toward the way the player faces
    private neckRecoilVel = 0; // radians per second

    private readonly worldMatrix = new GameObjects.Components.TransformMatrix();
    private readonly localTarget = new PMath.Vector2();
    aimAngle = 0;
    isShooting = false;
    trigger: Trigger;
    inventory: Inventory;
    activeWeapon: import("../shoot-Controller/Weapons.js").WeaponConfig;

    //Remote

    private remoteDodgeTime = 0;
    private remoteDodgeDir = { x: 0, y: 0 };
    private shotTrigger = new Trigger(); // visual-only trigger for remote players
    lastShotFired = 0;

    constructor(scene: Scene, config: Config) {
        this.scene = scene;
        this.shootController = config.shootController;
        this.trigger = new Trigger();
        this.setUpInventory(config.inventory);
        this.activeWeapon = this.inventory.primary;
        this.createPlayer(config);
    }

    createPlayer(config: Config) {
        this.body = this.scene.add.container(config.x, config.y);
        this.visuals = this.scene.add.container(0, -HALF);

        this.rect = this.scene.add
            .rectangle(0, HALF, BODY_SIZE, BODY_SIZE, 0xff0000)
            .setOrigin(0.5, 1);

        const initialPoints: Types.Math.Vector2Like[] = [];
        for (let i = 0; i < SEGMENTS; i++) {
            initialPoints.push({ x: 0, y: (i / (SEGMENTS - 1)) * CHAR_HEIGHT });
        }

        this.sprite = this.scene.add.rope(
            0,
            ROPE_Y,
            "body",
            0,
            initialPoints,
            false,
        );

        this.gun = this.scene.add
            .rectangle(GUN_BASE.x, GUN_BASE.y, 100, GUN_THICKNESS, 0x00ff00)
            .setOrigin(GUN_ORIGIN_X, 0.5)
            .setStrokeStyle(3, 0x000000);
        this.debugGfx = this.scene.add.graphics();

        // draw order: body, neck, face on the neck, gun, debug on top
        this.visuals.add([this.rect, this.sprite, this.gun, this.debugGfx]);
        this.body.add(this.visuals);

        // the gun sprite is sized from the equipped weapon, so tracer and barrel always match
        this.applyWeapon(this.shootController.weapon);
        this.shootController.onEquip = (weapon) => this.applyWeapon(weapon);

        this.scene.input.keyboard?.on("keydown-F2", (e: KeyboardEvent) => {
            e.preventDefault();
            this.debugEnabled = !this.debugEnabled;
        });

        this.physicsController = new PhysicsController(config);
    }

    /** Resize the gun so its tip sits exactly `muzzleOffset` from the pivot. */
    private applyWeapon(weapon: WeaponConfig) {
        this.gun.setSize(
            weapon.muzzleOffset / (1 - GUN_ORIGIN_X),
            GUN_THICKNESS,
        );
    }

    update(dt: number, inputState: PlayerInputState) {
        this.physicsController.update(inputState, dt);
        const pos = this.physicsController.position;

        this.isShooting = inputState.isShooting;
        this.handleFire(dt, inputState);
        this.setPosition();
        this.animate(dt, inputState);
        this.drawDebug();

        // fire only now: the body and gun transform are up to date for this step
        if (this.firedThisStep) {
            this.firedThisStep = false;
            this.onFire(inputState);
        }
    }

    setPosition() {
        const position = this.physicsController.position;
        this.body.setPosition(position.x, position.y);
    }

    // ----------------------------------------------------------------- shooting

    private handleFire(dt: number, input: PlayerInputState) {
        // no shooting mid-dodge. tick() owns the cooldown, fire rate and semi/auto logic.
        const shooting = input.isShooting && !this.physicsController.isDodging;
        if (!this.trigger.tick(dt, shooting, this.activeWeapon)) return;

        const recoil = this.activeWeapon.recoil;

        // 1. pushes the player back, away from the aim (real physics)
        this.physicsController.applyRecoil(input, RECOIL_IMPULSE * recoil);
        // 2. kicks the gun back
        this.gunKick = Math.min(GUN_KICK * recoil, GUN_KICK_MAX);
        // 3. snaps the neck back, the spring then swings it
        this.neckRecoilVel -= NECK_RECOIL * recoil;
        this.firedThisStep = true;
    }

    /** Same ray origin the server uses, so client prediction and server hits agree. */
    onFire = (input: PlayerInputState) => {
        this.shootController.fire(
            gunPivot(this.physicsController.position),
            { x: input.targetX, y: input.targetY },
            this.activeWeapon,
            this.physicsController.rigidBody,
        );
    };

    setState(s: serverState, dt: number) {
        const pc = this.physicsController;
        pc.rigidBody.setTranslation({ x: s.x, y: s.y }, true);
        pc.velocity.x = s.vx;
        pc.velocity.y = s.vy;
        pc.isDodging = s.isDodging;

        // local dodge progress (use the same duration as the real dodge)
        if (s.isDodging) this.remoteDodgeTime += dt;
        else this.remoteDodgeTime = 0;
        const progress = Math.min(this.remoteDodgeTime / pc.dodgeDuration, 1);

        // no dodgeDirection from the server, so use the velocity at the start of the dodge
        const dirX = s.vx;

        // ... shot visuals (below) ...

        const shooting = s.isShooting && !s.isDodging;
        if (s.shotsFired > this.lastShotFired) {
            this.kickVisuals();
            // optional: tracer/muzzle flash only, no hit logic
            this.onFire({
                moveX: 0,
                moveY: 0,
                targetX: s.targetX,
                targetY: s.targetY,
                isShooting: s.isShooting,
                dodge: false,
            });
            this.lastShotFired = s.shotsFired;
        }

        this.animate(
            dt,
            {
                moveX: 0,
                moveY: 0,
                targetX: s.targetX,
                targetY: s.targetY,
                isShooting: s.isShooting,
                dodge: false,
            },
            progress,
            dirX,
        );
        this.setPosition();
    }

    // ---------------------------------------------------------------- animation

    private animate(
        dt: number,
        input: PlayerInputState,
        dodgeProgress?: number,
        dodgeDirX?: number,
    ) {
        const pc = this.physicsController;

        const speed = Math.hypot(pc.velocity.x, pc.velocity.y);
        const rolling = pc.isDodging;
        const p = dodgeProgress ?? pc.dodgeProgress;

        // aiming = holding shoot (never mid-roll)
        const aiming = input.isShooting && !rolling;

        // non-automatic guns always track the target, automatic guns only while shooting.
        // read from the equipped weapon every frame, so equip() switches the rule instantly
        const alwaysTrack = !this.activeWeapon.automatic;
        const tracking = alwaysTrack ? !rolling : aiming;

        // lock the spin direction (and facing) when the dodge starts
        if (rolling && !this.wasRolling) {
            const dx = dodgeDirX ?? pc.dodgeDirection.x;
            this.rollSpin =
                Math.abs(dx) > 0.2 ? (dx < 0 ? -1 : 1) : this.facing;
            this.facing = this.rollSpin;
        }
        this.wasRolling = rolling;

        // facing: toward the target while tracking, otherwise the way we walk
        if (!rolling) {
            if (tracking) {
                const dx = input.targetX - pc.position.x;
                if (Math.abs(dx) > 8) this.facing = dx < 0 ? -1 : 1; // deadzone stops flicker
            } else if (Math.abs(pc.velocity.x) > 5) {
                this.facing = pc.velocity.x < 0 ? -1 : 1;
            }
        }

        // ---- walk
        const walking = speed > 10 && !rolling;
        if (walking) this.walkTime += dt;
        this.walkWeight +=
            ((walking ? 1 : 0) - this.walkWeight) * (1 - Math.exp(-10 * dt));

        const hop = rolling
            ? 0
            : Math.abs(Math.sin(this.walkTime * Math.PI * HOP_HZ)) *
              this.walkWeight;
        const scaleY = 1 + hop * HOP_SCALE; // size never changes during the roll
        const half = HALF * scaleY;

        // ---- dive + roll: the body is a stiff rod rotating about its middle
        const diveEnd = DIVE_FRACTION;
        const landHeight = half * LAND_FRACTION;
        let tilt = 0;
        let lift = 0;
        let centerHeight = half;
        this.rollBend = 0;

        if (rolling) {
            if (p < diveEnd) {
                const u = p / diveEnd;
                tilt = (Math.PI / 2) * PMath.Easing.Quadratic.In(u);
                lift = Math.sin(u * Math.PI) * half * DIVE_LIFT;
                centerHeight =
                    landHeight +
                    (half - landHeight) * Math.abs(Math.cos(tilt)) +
                    lift;
            } else {
                const v = (p - diveEnd) / (1 - diveEnd);
                tilt =
                    Math.PI / 2 +
                    ((Math.PI * 3) / 2) * PMath.Easing.Sine.Out(v);
                centerHeight =
                    landHeight + (half - landHeight) * PMath.Easing.Sine.In(v);
                this.rollBend =
                    Math.sin(v * Math.PI) * PMath.DegToRad(NECK_CURL);
            }
        }
        const angle = this.rollSpin * tilt;

        this.visuals.setScale(this.facing, scaleY);
        this.visuals.setRotation(angle);
        this.visuals.setPosition(0, -centerHeight - hop * HOP_LIFT);

        // ---- aim target in the visuals' own space (after the transform is set)
        this.visuals.getWorldTransformMatrix(this.worldMatrix);
        this.worldMatrix.applyInverse(
            input.targetX,
            input.targetY,
            this.localTarget,
        );
        const lt = this.localTarget;

        // animated gun pivot in world space (through the mirror / hop / roll transform)
        this.worldMatrix.transformPoint(
            GUN_BASE.x,
            GUN_BASE.y,
            this.gunPivotWorld,
        );

        // ---- neck bend toward the aim
        const maxRad = PMath.DegToRad(MAX_BEND);
        let bend = 0;
        if (aiming) {
            const eyeY = ROPE_Y + EYE * CHAR_HEIGHT;
            // 0 = level with the eye, + = target above, - = target below
            const elevation = Math.atan2(eyeY - lt.y, Math.abs(lt.x));
            bend = PMath.Clamp(
                -elevation * BEND_STRENGTH * BEND_DIRECTION,
                -maxRad,
                maxRad,
            );
        }

        // ---- idle / walk sway (off while aiming or rolling)
        const amplitude = PMath.Linear(12, 30, this.walkWeight);
        const swaySpeed = PMath.Linear(0.5, 3, this.walkWeight);
        this.swayPhase += Math.PI * 2 * swaySpeed * dt;
        this.swayWeight +=
            ((aiming || rolling ? 0 : 1) - this.swayWeight) *
            (1 - Math.exp(-4 * dt));
        const sway =
            Math.sin(this.swayPhase) *
            PMath.DegToRad(amplitude) *
            this.swayWeight;

        const wanted = PMath.Clamp(bend + sway, -maxRad, maxRad);
        this.currentAngle +=
            (wanted - this.currentAngle) * (1 - Math.exp(-SMOOTHING * dt));

        // ---- neck recoil spring: underdamped, so it overshoots and swings back
        const springDt = Math.min(dt, 1 / 30);
        this.neckRecoilVel +=
            (-NECK_STIFFNESS * this.neckRecoilAngle -
                NECK_DAMPING * this.neckRecoilVel) *
            springDt;
        this.neckRecoilAngle = PMath.Clamp(
            this.neckRecoilAngle + this.neckRecoilVel * springDt,
            -1.4,
            1.4,
        );

        // ---- gun: aims at the target, kicks back along its aim
        this.gunKick *= Math.exp(-GUN_RECOVERY * dt);
        if (this.gunKick < 0.05) this.gunKick = 0;

        // non-automatic guns always point at the target, automatic ones only while shooting
        const gunAngle = tracking
            ? Math.atan2(lt.y - GUN_BASE.y, lt.x - GUN_BASE.x)
            : GUN_REST_ANGLE;
        const k = this.gunKick;
        this.gun.setRotation(gunAngle - k * 0.012); // muzzle climbs a little
        this.gun.setPosition(
            GUN_BASE.x - Math.cos(gunAngle) * k,
            GUN_BASE.y - Math.sin(gunAngle) * k,
        );

        // ---- apply everything to the neck, then put the face on it
        const place = this.makeNeckPlacer(
            this.currentAngle + this.rollBend + this.neckRecoilAngle,
        );
        this.updateNeck(place);
        this.updateFace(place, tracking, lt, dt);
    }

    private kickVisuals() {
        const recoil = this.activeWeapon.recoil;
        this.gunKick = Math.min(GUN_KICK * recoil, GUN_KICK_MAX);
        this.neckRecoilVel -= NECK_RECOIL * recoil;
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

    /**
     * Builds a function that gives the neck position at a height y (0 = top of the rope),
     * for a total bend of `phi` radians (positive = toward +x). Used by the rope and the face.
     */
    private makeNeckPlacer(phi: number): NeckPlacer {
        const H = CHAR_HEIGHT;
        const yEnd = NECK_END * H;
        const zoneLen = Math.max(yEnd - NECK_START * H, 0.001);
        const curvature = phi / zoneLen;
        const flat = Math.abs(phi) < 1e-4;
        const tipX = flat ? 0 : (1 - Math.cos(phi)) / curvature;
        const tipY = yEnd - (flat ? zoneLen : Math.sin(phi) / curvature);

        return (y, out) => {
            if (y >= yEnd) {
                // body below the flexible section stays put
                out.x = 0;
                out.y = y;
                return 0;
            }

            const s = yEnd - y; // distance above the anchor
            if (s <= zoneLen) {
                // flexible section: a circular arc with total turn phi
                if (flat) {
                    out.x = 0;
                    out.y = y;
                    return 0;
                }
                const a = curvature * s;
                out.x = (1 - Math.cos(a)) / curvature;
                out.y = yEnd - Math.sin(a) / curvature;
                return a;
            }

            // head: straight, rotated by phi
            const extra = s - zoneLen;
            out.x = tipX + Math.sin(phi) * extra;
            out.y = tipY - Math.cos(phi) * extra;
            return phi;
        };
    }

    private updateNeck(place: NeckPlacer) {
        const points = this.sprite.points;
        const n = points.length;
        for (let i = 0; i < n; i++) {
            place((i / (n - 1)) * CHAR_HEIGHT, points[i]);
        }
        this.sprite.setDirty();
    }

    /** Puts the face on the bent neck and turns it toward the target. */
    private updateFace(
        place: NeckPlacer,
        tracking: boolean,
        target: PMath.Vector2,
        dt: number,
    ) {
        const pos = { x: 0, y: 0 };
        const heading = place(EYE * CHAR_HEIGHT, pos);

        // rope points are relative to the rope, so add the rope's own position
        const x = this.sprite.x + pos.x + Math.cos(heading) * EYE_OFFSET_X;
        const y = this.sprite.y + pos.y + Math.sin(heading) * EYE_OFFSET_X;

        // look at the target, or straight ahead (local +x) when not tracking
        // the angle is clamped, so the face never turns further than FACE_MAX_ANGLE
        const faceLimit = PMath.DegToRad(FACE_MAX_ANGLE);
        const wanted = tracking
            ? PMath.Clamp(
                  Math.atan2(target.y - y, target.x - x),
                  -faceLimit,
                  faceLimit,
              )
            : 0;
        this.faceAngle +=
            PMath.Angle.Wrap(wanted - this.faceAngle) *
            (1 - Math.exp(-FACE_SMOOTHING * dt));
    }

    // -------------------------------------------------------------------- debug

    private drawDebug() {
        const g = this.debugGfx;
        g.clear();
        if (!this.debugEnabled) return;

        const pts = this.sprite.points;
        const ox = this.sprite.x;
        const oy = this.sprite.y;

        g.lineStyle(1, 0xffff00, 1);
        g.beginPath();
        pts.forEach((p, i) => {
            const x = ox + (p.x ?? 0);
            const y = oy + (p.y ?? 0);
            if (i === 0) g.moveTo(x, y);
            else g.lineTo(x, y);
        });
        g.strokePath();

        pts.forEach((p, i) => {
            const color =
                i === 0 ? 0xff0000 : i === pts.length - 1 ? 0x00ff00 : 0x00ffff;
            g.fillStyle(color, 1);
            g.fillCircle(ox + (p.x ?? 0), oy + (p.y ?? 0), i % 5 === 0 ? 4 : 2);
        });

        // flexible section limits (blue = start, orange = end/anchor)
        g.fillStyle(0x3399ff, 1).fillCircle(
            0,
            ROPE_Y + NECK_START * CHAR_HEIGHT,
            5,
        );
        g.fillStyle(0xffaa00, 1).fillCircle(
            0,
            ROPE_Y + NECK_END * CHAR_HEIGHT,
            5,
        );

        // rest height of the face (purple) and the aim target (red)
        const eyeY = ROPE_Y + EYE * CHAR_HEIGHT;
        g.fillStyle(0xcc66ff, 1).fillCircle(0, eyeY, 5);
        g.lineStyle(1, 0xcc66ff, 0.5);
        g.lineBetween(-150, eyeY, 150, eyeY);
        g.fillStyle(0xff3333, 1).fillCircle(
            this.localTarget.x,
            this.localTarget.y,
            6,
        );

        // gun pivot (green): where shots start
        g.fillStyle(0x00ff00, 1).fillCircle(GUN_BASE.x, GUN_BASE.y, 4);

        // pivot cross (what the dive and roll rotate around)
        g.lineStyle(1, 0xffffff, 1);
        g.lineBetween(-6, 0, 6, 0);
        g.lineBetween(0, -6, 0, 6);
    }
}
