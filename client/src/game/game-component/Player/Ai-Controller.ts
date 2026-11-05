import {
    Collider,
    Ray,
    RayColliderHit,
    World,
} from "@dimforge/rapier2d-compat";
import { ShootController } from "../shoot-Controller/Shoot-Controller";
import { InventoryType } from "../shared/Inventory";
import { Player } from "./Player";
import { Scene } from "phaser";
import { Get_NO_INPUT } from "../Input-Controller/PlayerInputs";
import { StateMachine } from "./Ai-StateMachine/State-Machine";
import { MathHelper, Vec2 } from "../utils/Math-Helper";
import { ContextSteering } from "./Context-Steering";
import { SightLine, SteeringDebugger } from "./Steering-Debugger";
import { AiProfile, createProfile } from "./Ai-Info/Ai-Profile";
import { Perception } from "./Ai-Info/Ai-Perception";
import { AiAim } from "./Ai-Info/Ai-Aim";

// Set this to the collision groups your WALLS belong to so rays ignore players/bullets.
// Rapier format: (membership << 16) | filter. Leave undefined to hit everything.
const WALL_RAY_GROUPS: number | undefined = undefined;

// One ray reused by every bot. Safe because castRay is synchronous.
const sharedRay = new Ray({ x: 0, y: 0 }, { x: 1, y: 0 });

// Sight rays skip ghosts but players DO block them.
const IGNORED_TYPES = new Set(["ServerPlayer"]);
// Wall rays skip every player, otherwise bots treat each other (and their target) as walls.
const WALL_IGNORED_TYPES = new Set(["ServerPlayer", "Player"]);

// Prebuilt predicates so no closure is allocated per raycast.
const hitEverything = (c: Collider) => {
    const tag = c.parent()?.userData as { type?: string } | undefined;
    return !(tag?.type && IGNORED_TYPES.has(tag.type));
};
const hitWallsOnly = (c: Collider) => {
    const tag = c.parent()?.userData as { type?: string } | undefined;
    return !(tag?.type && WALL_IGNORED_TYPES.has(tag.type));
};

export type Config = {
    x: number;
    y: number;
    id: string;
    world: World;
    shootController: ShootController;
    inventory: InventoryType;
    everyone: Map<string, Player>;
    /** 0 = rookie, 1 = pro. Random if omitted. */
    skill?: number;
};

export class AiController {
    player: Player;
    state_machine: StateMachine;
    inputState = Get_NO_INPUT();
    facing: number = 1;
    shootDistance: number;
    chaseDistance: number;
    everyone: Map<string, Player>;
    distanceCheckTime = 0;
    timeForDistanceCheck = 0.5;
    chaseTarget: Player | null = null;
    closePlayers: Player[] = [];
    id: string;

    // --- context steering ---
    world: World;
    steering = new ContextSteering(16);
    wallLookAhead = 100;
    bodyRadius = 24;
    avoidRadius = 70;
    private wallTimer = Math.random() * 0.1;
    private wallDanger = new Float32Array(this.steering.slots);

    // --- wall sliding ---
    private wallN: Vec2 = { x: 0, y: 0 };
    private wallNear = 0;
    private slideSide: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
    private slideOut: Vec2 = { x: 0, y: 0 };

    // --- stuck detection ---
    stuckMinSpeed = 15;
    stuckEvents = 0;
    private stuckTime = 0;
    private movingTime = 0;
    private stuckCheckTimer = 0;
    private stuckLastX = 0;
    private stuckLastY = 0;
    private escapeTimer = 0;
    private escapeDir: Vec2 = { x: 0, y: 0 };

    // --- sight ---
    sights: SightLine[] = [];
    visibleTargets: Player[] = [];
    bestVisible: Player | null = null;
    lostSightTime = 0;

    // --- last known position ---
    lastSeenPos: Vec2 | null = null;
    lastSeenVel: Vec2 = { x: 0, y: 0 };
    lastSeenTarget: Player | null = null;
    memoryTime = 10;
    private lastSeenStore: Vec2 = { x: 0, y: 0 };
    private lastSeenAt = 0;
    private predicted: Vec2 = { x: 0, y: 0 };
    private clock = 0;

    private sightTimer = Math.random() * 0.1;

    // --- human-like behaviour ---
    profile: AiProfile;
    perception = new Perception();
    aim = new AiAim();
    private aimTarget: Player | null = null;
    private aimHasSample = false;
    private gates = new Map<string, { t: number; need: number }>();

    // --- threat awareness / dodge / startle ---
    threat: { attacker: Player | null; level: number; aimDir: Vec2 } = {
        attacker: null,
        level: 0,
        aimDir: { x: 1, y: 0 },
    };
    threatRadius = 60; // how "wide" the bot is to an aimer
    dodgeCooldown = 0;
    private dodgePressed = false;
    private peakLevel = 0;
    private threatAware = false;
    private threatCheckTimer = Math.random() * 0.1;
    private threatClearTimer = 0;
    /** While > 0 the bot sees a bit further (it knows someone hostile is around). */
    private alertTimer = 0;
    /** After being hit, keep the threat alive this long even if the aim scan no longer matches. */
    private hitGrace = 0;
    /** Countdown to investigate after being hit by a shooter we never saw. */
    private startle = 0;

    // --- debug ---
    debug = true;
    private debugger: SteeringDebugger;

    constructor(scene: Scene, config: Config) {
        this.id = config.id;
        this.world = config.world;
        this.profile = createProfile(config.skill);
        this.player = new Player(scene, config);
        this.state_machine = new StateMachine(this);
        this.shootDistance = 300;
        this.chaseDistance = 500;
        this.everyone = config.everyone;
        this.debugger = new SteeringDebugger(scene);

        // Looser mask: slots with a little wall danger stay usable, so the bot can slide along walls.
        this.steering.maskTolerance = 0.35;

        const p = this.player.physicsController.position;
        this.stuckLastX = p.x;
        this.stuckLastY = p.y;
    }

    update(dt: number) {
        this.clock += dt;
        this.alertTimer = Math.max(0, this.alertTimer - dt);
        this.hitGrace = Math.max(0, this.hitGrace - dt);
        this.checkDistance(dt);

        this.steering.reset();
        this.handleStates(dt);
        this.updateThreat(dt);
        this.state_machine.update(dt); // states call moveToward / moveAway / strafe / updateHumanAim
        this.addPlayerAvoidance();
        this.addWallAvoidance(dt);
        this.applyEscape(dt);

        const move = this.steering.resolve(dt);
        this.inputState.moveX = move.x;
        this.inputState.moveY = move.y;

        this.updateStuck(dt, move);

        // dodge is a one-frame press: set it, let Player read it, then release
        this.inputState.dodge = this.dodgePressed;
        this.player.update(dt, this.inputState);
        this.inputState.dodge = false;
        this.dodgePressed = false;

        if (this.debug) this.drawDebug();
    }

    destroy() {
        this.debugger.destroy();
    }

    private drawDebug() {
        const showAim =
            this.aimHasSample && this.isInState("attack", "dodge", "chase");
        this.debugger.draw({
            position: this.player.physicsController.position,
            steering: this.steering,
            wallDanger: this.wallDanger,
            wallLookAhead: this.wallLookAhead,
            avoidRadius: this.avoidRadius,
            shootDistance: this.shootDistance,
            chaseDistance: this.chaseDistance,
            sights: this.sights,
            lastSeen: this.lastSeenPos,
            lastSeenAge: this.lastSeenAge,
            aimPoint: showAim ? this.aim.point : undefined,
            seenPoint: showAim ? this.perception.out : undefined,
        });
    }

    // =====================================================
    //  Reaction gates
    // =====================================================

    /**
     * Human-style reaction delay. Returns true once `condition` has been
     * continuously true for this bot's reaction time (with a little randomness).
     * Any frame the condition is false, the gate resets.
     * `scale` stretches the delay (e.g. 1.3 = caught off guard).
     */
    react(key: string, condition: boolean, dt: number, scale = 1): boolean {
        if (!condition) {
            this.gates.delete(key);
            return false;
        }
        let g = this.gates.get(key);
        if (!g) {
            g = {
                t: 0,
                need:
                    this.profile.reactionTime *
                    scale *
                    (0.8 + Math.random() * 0.4),
            };
            this.gates.set(key, g);
        }
        g.t += dt;
        return g.t >= g.need;
    }

    clearGate(key: string) {
        this.gates.delete(key);
    }

    // =====================================================
    //  Human-like aiming / inputs
    // =====================================================

    /**
     * Call every frame from a state that wants the bot to aim at `target`.
     * Aims at where the target was a moment ago, turns at a limited speed, and has wobble.
     * If the bot can't see the target, it keeps aiming at the last position it saw.
     */
    updateHumanAim(dt: number, target: Player, canSee: boolean) {
        const pos = this.player.physicsController.position;

        if (target !== this.aimTarget) {
            this.aimTarget = target;
            this.perception.clear();
            this.aim.reset();
            this.aimHasSample = false;
            // start from the current facing so the aim has to swing onto the new target
            this.aim.seed(
                Math.atan2(
                    this.inputState.targetY - pos.y,
                    this.inputState.targetX - pos.x,
                ),
            );
        }

        if (canSee) {
            this.perception.push(this.clock, target.physicsController.position);
            this.aimHasSample = true;
        } else if (
            !this.aimHasSample &&
            this.lastSeenPos &&
            this.lastSeenTarget === target
        ) {
            // never saw them directly (e.g. just got shot): aim at where we remember them
            this.perception.push(this.clock, this.lastSeenPos);
            this.aimHasSample = true;
        }
        if (!this.aimHasSample) return;

        const seen = this.perception.get(
            this.clock - this.profile.perceptionDelay,
        );
        this.aim.update(dt, pos, seen, this.profile);
        this.inputState.targetX = this.aim.point.x;
        this.inputState.targetY = this.aim.point.y;
    }

    /** Is the bot's actual aim within `tolerance` radians of `target`? */
    isAimedNear(target: Vec2, tolerance = 0.3): boolean {
        const pos = this.player.physicsController.position;
        const want = MathHelper.angleTo(pos, target);
        return (
            Math.abs(MathHelper.angleDifference(this.aim.angle, want)) <=
            tolerance
        );
    }

    setShooting(shooting: boolean) {
        this.inputState.isShooting = shooting;
    }

    /** Request a dodge roll. Held for exactly one player.update() so Player sees a clean press. */
    pressDodge() {
        this.dodgePressed = true;
    }

    // =====================================================
    //  Threat awareness, startle reaction, dodge trigger
    // =====================================================

    /**
     * Someone hostile has been noticed (aimed/shot at us). Makes them the target and remembers
     * where they are, so Chase/Investigate have somewhere to go. Does not switch state.
     */
    noticeAttacker(attacker: Player) {
        this.chaseTarget = attacker;
        this.rememberTarget(attacker);
        this.alertTimer = 5;
        this.lostSightTime = 0;
    }

    /**
     * Call this from your damage code when this bot gets hit.
     * attacker: who shot it, if known. fromPos: where the shot came from, if the shooter is unknown.
     */
    onHit(attacker: Player | null = null, fromPos?: Vec2) {
        this.threatAware = true;
        this.threatClearTimer = 0;
        this.hitGrace = 1.5;
        this.peakLevel = 1;
        this.threat.level = 1;

        if (attacker) {
            this.noticeAttacker(attacker);
            this.threat.attacker = attacker;
            if (Number.isFinite(attacker.aimAngle)) {
                this.threat.aimDir.x = Math.cos(attacker.aimAngle);
                this.threat.aimDir.y = Math.sin(attacker.aimAngle);
            }
        } else if (fromPos) {
            // unknown shooter: remember where the shot came from and go look
            this.lastSeenStore.x = fromPos.x;
            this.lastSeenStore.y = fromPos.y;
            this.lastSeenPos = this.lastSeenStore;
            this.lastSeenTarget = null;
            this.lastSeenVel.x = 0;
            this.lastSeenVel.y = 0;
            this.lastSeenAt = this.clock;
            this.alertTimer = 5;
            this.startle =
                this.profile.reactionTime * (1 + Math.random() * 0.4);
        }
    }

    private updateThreat(dt: number) {
        this.dodgeCooldown = Math.max(0, this.dodgeCooldown - dt);

        this.threatCheckTimer -= dt;
        if (this.threatCheckTimer <= 0) {
            this.threatCheckTimer = 0.1;
            this.scanThreat();

            if (this.threat.level > 0) {
                this.threatClearTimer = 0;
                // each check is a chance to notice, so low awareness = noticed later
                if (
                    !this.threatAware &&
                    Math.random() < this.profile.awareness
                ) {
                    this.threatAware = true;
                }
            } else if (this.hitGrace <= 0) {
                // grace period: a human doesn't forget the second your aim wobbles off them
                this.threatClearTimer += 0.1;
                if (this.threatClearTimer >= 0.4) {
                    this.threatAware = false;
                    this.threat.attacker = null;
                    this.peakLevel = 0;
                }
            }
        }

        const attacker = this.threat.attacker;
        const passive = this.isInState("idle", "wander", "investigate");

        // 1. startled while idle/wandering: turn on the shooter.
        //    Slower than a normal reaction, the bot was caught off guard. Independent of the dodge roll.
        const wantsAlert = this.threatAware && attacker !== null && passive;
        if (this.react("alert", wantsAlert, dt, 1.3)) {
            this.clearGate("alert");
            if (attacker) this.noticeAttacker(attacker);
            this.state_machine.switchState("chase");
        }

        // 2. hit by a shooter we never saw: go and look where the shot came from
        if (this.startle > 0) {
            this.startle -= dt;
            if (this.startle <= 0 && passive && this.lastSeenPos) {
                this.state_machine.switchState("investigate");
            }
        }

        // 3. dodge
        const wantsDodge =
            this.threatAware &&
            attacker !== null &&
            this.dodgeCooldown <= 0 &&
            !this.isInState("dodge");

        if (this.react("threat", wantsDodge, dt)) {
            this.clearGate("threat");
            // aiming alone gives 60% of the chance, being shot at gives 100%
            const chance =
                this.profile.dodgeChance * (0.6 + 0.4 * this.peakLevel);
            if (Math.random() < chance) {
                this.dodgeCooldown =
                    this.profile.dodgeCooldown * (0.8 + Math.random() * 0.4);
                this.peakLevel = 0;
                this.state_machine.switchState("dodge");
            } else {
                this.dodgeCooldown = 0.5; // failed roll: try again soon
            }
        }
    }

    /** Finds the most dangerous player currently aiming at us. */
    private scanThreat() {
        const me = this.player.physicsController.position;
        const range = this.chaseDistance * 1.2;
        const rangeSq = range * range;
        let bestLevel = 0;
        let best: Player | null = null;

        for (const [id, other] of this.everyone) {
            if (id === this.id || !other) continue;
            if (!Number.isFinite(other.aimAngle)) continue;

            const op = other.physicsController.position;
            const dSq = MathHelper.distanceSq(me, op);
            if (dSq > rangeSq) continue;

            const dist = Math.sqrt(dSq);
            const toMe = Math.atan2(me.y - op.y, me.x - op.x);
            const diff = Math.abs(
                MathHelper.angleDifference(other.aimAngle, toMe),
            );
            // floor on the cone so long-range threats aren't impossibly narrow
            const cone = Math.max(
                Math.atan2(this.threatRadius, Math.max(dist, 1)),
                0.12,
            );

            // shooting near us counts double-wide; just aiming = lower threat
            const level = other.isShooting
                ? diff <= cone * 2
                    ? 1
                    : 0
                : diff <= cone
                  ? 0.5
                  : 0;
            if (level <= bestLevel) continue;
            if (!this.hasLineOfSight(op, 24)) continue; // it can't hit us through a wall

            bestLevel = level;
            best = other;
        }

        if (best) {
            this.threat.attacker = best;
            this.threat.level = bestLevel;
            this.peakLevel = Math.max(this.peakLevel, bestLevel);
            this.threat.aimDir.x = Math.cos(best.aimAngle);
            this.threat.aimDir.y = Math.sin(best.aimAngle);
        } else {
            this.threat.level = 0; // attacker is kept for the grace period in updateThreat
        }
    }

    // =====================================================
    //  Sight + state decisions
    // =====================================================

    isInState(...names: string[]): boolean {
        const sm = this.state_machine;
        for (const n of names) {
            if (sm.states[n] && sm.currentState === sm.states[n]) return true;
        }
        return false;
    }

    /** Decides whether to start chasing. Sight is scanned at 10 Hz, not every frame. */
    private handleStates(dt: number) {
        this.sightTimer -= dt;
        if (this.sightTimer <= 0) {
            this.sightTimer = 0.1;
            this.scanSight();
        }

        if (this.bestVisible) {
            this.lostSightTime = 0;
            if (!this.chaseTarget) this.chaseTarget = this.bestVisible;

            // spotted someone while idle/wandering: go after them
            if (
                this.isInState("idle", "wander") &&
                this.state_machine.states["chase"]
            ) {
                this.chaseTarget = this.bestVisible;
                this.state_machine.switchState("chase");
            }
        } else {
            this.lostSightTime += dt;
            if (this.lastSeenPos && this.lastSeenAge > this.memoryTime) {
                this.clearLastSeen();
            }
        }
    }

    /** Raycasts to every player within sight range and records what each ray hit first. */
    private scanSight() {
        this.sights.length = 0;
        this.visibleTargets.length = 0;
        this.bestVisible = null;

        const pos = this.player.physicsController.position;
        // sees a bit further while alert (someone hostile is around)
        const range = this.chaseDistance * (this.alertTimer > 0 ? 1.25 : 1);
        const rangeSq = range * range;
        let bestDistSq = Infinity;
        let bestLine: SightLine | null = null;

        for (const [id, other] of this.everyone) {
            if (id === this.id || !other) continue;

            const tp = other.physicsController.position;
            const dSq = MathHelper.distanceSq(pos, tp);
            if (dSq > rangeSq) continue;

            const line = this.sightTo(id, tp);
            this.sights.push(line);
            if (!line.visible) continue;

            this.visibleTargets.push(other);
            if (dSq < bestDistSq) {
                bestDistSq = dSq;
                this.bestVisible = other;
                bestLine = line;
            }
        }
        if (bestLine) bestLine.chosen = true;
        if (this.bestVisible) this.rememberTarget(this.bestVisible);
    }

    get lastSeenAge(): number {
        return this.clock - this.lastSeenAt;
    }

    private rememberTarget(p: Player) {
        const tp = p.physicsController.position;

        if (this.lastSeenPos && this.lastSeenTarget === p) {
            const dt = this.clock - this.lastSeenAt;
            if (dt > 0.001) {
                const vx = (tp.x - this.lastSeenStore.x) / dt;
                const vy = (tp.y - this.lastSeenStore.y) / dt;
                this.lastSeenVel.x += (vx - this.lastSeenVel.x) * 0.5;
                this.lastSeenVel.y += (vy - this.lastSeenVel.y) * 0.5;
            }
        } else {
            this.lastSeenVel.x = 0;
            this.lastSeenVel.y = 0;
        }

        this.lastSeenStore.x = tp.x;
        this.lastSeenStore.y = tp.y;
        this.lastSeenPos = this.lastSeenStore;
        this.lastSeenTarget = p;
        this.lastSeenAt = this.clock;
    }

    clearLastSeen() {
        this.lastSeenPos = null;
        this.lastSeenTarget = null;
        this.lastSeenVel.x = 0;
        this.lastSeenVel.y = 0;
    }

    reachedLastSeen(radius = 40): boolean {
        if (!this.lastSeenPos) return false;
        return (
            MathHelper.distanceSq(
                this.player.physicsController.position,
                this.lastSeenPos,
            ) <=
            radius * radius
        );
    }

    predictedLastSeen(maxSeconds = 0.6): Vec2 | null {
        if (!this.lastSeenPos) return null;
        const t = Math.min(this.lastSeenAge, maxSeconds);
        this.predicted.x = this.lastSeenPos.x + this.lastSeenVel.x * t;
        this.predicted.y = this.lastSeenPos.y + this.lastSeenVel.y * t;
        return this.predicted;
    }

    /** One sight check: what does a ray from us to this player hit first? */
    private sightTo(id: string, tp: Vec2): SightLine {
        const pos = this.player.physicsController.position;
        const line: SightLine = {
            x: tp.x,
            y: tp.y,
            hitX: tp.x,
            hitY: tp.y,
            kind: "clear",
            visible: true,
            chosen: false,
        };

        const dx = tp.x - pos.x;
        const dy = tp.y - pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist === 0) return line;

        const dirX = dx / dist;
        const dirY = dy / dist;
        sharedRay.origin.x = pos.x;
        sharedRay.origin.y = pos.y;
        sharedRay.dir.x = dirX;
        sharedRay.dir.y = dirY;

        const hit = this.rayHit(dist);
        if (!hit) return line;

        const t = (hit as any).timeOfImpact ?? (hit as any).toi;
        line.hitX = pos.x + dirX * t;
        line.hitY = pos.y + dirY * t;

        const ud: any = hit.collider.parent()?.userData;
        const hitIsPlayer = ud?.type === "Player";
        const hitIsTarget =
            hitIsPlayer && (ud.id === undefined || ud.id === id);

        if (hitIsTarget) {
            line.kind = "target";
            line.visible = true;
        } else if (hitIsPlayer) {
            line.kind = "player";
            line.visible = false;
        } else {
            line.kind = "wall";
            line.visible = false;
        }
        return line;
    }

    // =====================================================
    //  Movement API for states
    // =====================================================

    moveToward(target: Vec2, arriveRadius = 0) {
        const pos = this.player.physicsController.position;
        const dx = target.x - pos.x;
        const dy = target.y - pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const weight =
            arriveRadius > 0 ? MathHelper.clamp(dist / arriveRadius, 0, 1) : 1;
        this.addGoal(dx, dy, weight);
    }

    moveAway(target: Vec2, weight = 1) {
        const pos = this.player.physicsController.position;
        this.addGoal(pos.x - target.x, pos.y - target.y, weight);
    }

    strafe(target: Vec2, side: 1 | -1 = 1, weight = 1) {
        const pos = this.player.physicsController.position;
        const tx = target.x - pos.x;
        const ty = target.y - pos.y;
        this.addGoal(-ty * side, tx * side, weight);
    }

    moveDir(dir: Vec2, weight = 1) {
        this.addGoal(dir.x, dir.y, weight);
    }

    private addGoal(dx: number, dy: number, weight: number) {
        const d = this.slideDir(dx, dy);
        if (d.x === 0 && d.y === 0) return;
        this.steering.addInterest(d, weight);
    }

    private slideDir(dx: number, dy: number): Vec2 {
        const out = this.slideOut;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 1e-5) {
            out.x = 0;
            out.y = 0;
            return out;
        }
        let ux = dx / len;
        let uy = dy / len;

        const n = this.wallN;
        if (this.wallNear > 0.15 && (n.x !== 0 || n.y !== 0)) {
            const into = ux * n.x + uy * n.y;
            if (into < 0) {
                let sx = ux - n.x * into;
                let sy = uy - n.y * into;
                const sl = Math.sqrt(sx * sx + sy * sy);
                if (sl < 0.3) {
                    sx = -n.y * this.slideSide;
                    sy = n.x * this.slideSide;
                } else {
                    sx /= sl;
                    sy /= sl;
                    this.slideSide = sx * -n.y + sy * n.x >= 0 ? 1 : -1;
                }
                ux = sx;
                uy = sy;
            }
        }
        out.x = ux;
        out.y = uy;
        return out;
    }

    // =====================================================
    //  Stuck detection + escape
    // =====================================================

    resetStuck() {
        this.stuckEvents = 0;
        this.stuckTime = 0;
    }

    get isEscaping(): boolean {
        return this.escapeTimer > 0;
    }

    private updateStuck(dt: number, move: Vec2) {
        this.stuckCheckTimer += dt;
        if (this.stuckCheckTimer < 0.25) return;
        const elapsed = this.stuckCheckTimer;
        this.stuckCheckTimer = 0;

        const pos = this.player.physicsController.position;
        const moved = Math.hypot(
            pos.x - this.stuckLastX,
            pos.y - this.stuckLastY,
        );
        this.stuckLastX = pos.x;
        this.stuckLastY = pos.y;

        const wantsToMove =
            this.escapeTimer <= 0 && Math.hypot(move.x, move.y) > 0.35;

        if (wantsToMove && moved < this.stuckMinSpeed * elapsed) {
            this.stuckTime += elapsed;
            this.movingTime = 0;
            if (this.stuckTime >= 0.7) this.beginEscape();
        } else {
            this.stuckTime = Math.max(0, this.stuckTime - elapsed * 2);
            this.movingTime += elapsed;
            if (this.movingTime > 3) this.stuckEvents = 0;
        }
    }

    private beginEscape() {
        this.stuckTime = 0;
        this.stuckEvents++;
        this.slideSide = (this.slideSide * -1) as 1 | -1;

        const n = this.wallN;
        let dx: number;
        let dy: number;
        if (this.wallNear > 0.15 && (n.x !== 0 || n.y !== 0)) {
            dx = n.x * 0.7 - n.y * this.slideSide;
            dy = n.y * 0.7 + n.x * this.slideSide;
        } else {
            const a = Math.random() * Math.PI * 2;
            dx = Math.cos(a);
            dy = Math.sin(a);
        }
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        this.escapeDir.x = dx / len;
        this.escapeDir.y = dy / len;
        this.escapeTimer = 0.6 + Math.random() * 0.5;
    }

    private applyEscape(dt: number) {
        if (this.escapeTimer <= 0) return;
        this.escapeTimer -= dt;
        this.steering.interest.fill(0);
        this.steering.addInterest(this.escapeDir, 1);
    }

    // =====================================================
    //  Raycasts / danger
    // =====================================================

    private rayHit(maxDist: number, wallsOnly = false): RayColliderHit | null {
        // adjust these two to however your PlayerPhysicsController exposes them
        const pc = this.player.physicsController as any;
        return this.world.castRay(
            sharedRay,
            maxDist,
            true,
            undefined,
            WALL_RAY_GROUPS,
            pc.collider,
            pc.body ?? pc.rigidBody,
            wallsOnly ? hitWallsOnly : hitEverything,
        );
    }

    private castWall(maxDist: number): number {
        const hit = this.rayHit(maxDist, true);
        if (!hit) return -1;
        return (hit as any).timeOfImpact ?? (hit as any).toi;
    }

    hasLineOfSight(target: Vec2, stopShort = 0): boolean {
        const pos = this.player.physicsController.position;
        const dx = target.x - pos.x;
        const dy = target.y - pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const castDist = dist - stopShort;
        if (castDist <= 0) return true;

        sharedRay.origin.x = pos.x;
        sharedRay.origin.y = pos.y;
        sharedRay.dir.x = dx / dist;
        sharedRay.dir.y = dy / dist;

        return this.rayHit(castDist) === null;
    }

    private addPlayerAvoidance() {
        const pos = this.player.physicsController.position;
        const rSq = this.avoidRadius * this.avoidRadius;
        for (const [id, other] of this.everyone) {
            if (id === this.id || !other) continue;
            const op = other.physicsController.position;
            const dSq = MathHelper.distanceSq(pos, op);
            if (dSq > rSq) continue;
            const closeness = 1 - Math.sqrt(dSq) / this.avoidRadius;
            this.steering.addDanger(
                { x: op.x - pos.x, y: op.y - pos.y },
                closeness,
            );
        }
    }

    private addWallAvoidance(dt: number) {
        this.wallTimer -= dt;
        if (this.wallTimer <= 0) {
            this.wallTimer = 0.1;
            const pos = this.player.physicsController.position;
            sharedRay.origin.x = pos.x;
            sharedRay.origin.y = pos.y;

            const span = Math.max(1, this.wallLookAhead - this.bodyRadius);
            let nx = 0;
            let ny = 0;
            let maxD = 0;

            for (let i = 0; i < this.steering.slots; i++) {
                const dir = this.steering.dirs[i];
                sharedRay.dir.x = dir.x;
                sharedRay.dir.y = dir.y;

                const t = this.castWall(this.wallLookAhead);
                const d =
                    t < 0
                        ? 0
                        : MathHelper.clamp(
                              1 - (t - this.bodyRadius) / span,
                              0,
                              1,
                          );
                this.wallDanger[i] = d;

                if (d > 0) {
                    nx -= dir.x * d;
                    ny -= dir.y * d;
                    if (d > maxD) maxD = d;
                }
            }

            const len = Math.sqrt(nx * nx + ny * ny);
            if (len > 1e-4) {
                this.wallN.x = nx / len;
                this.wallN.y = ny / len;
            } else {
                this.wallN.x = 0;
                this.wallN.y = 0;
            }
            this.wallNear = maxD;
        }

        for (let i = 0; i < this.steering.slots; i++) {
            if (this.wallDanger[i] > 0) {
                this.steering.addDangerSlot(i, this.wallDanger[i]);
            }
        }
    }

    // =====================================================
    //  Existing
    // =====================================================

    checkDistance(dt: number) {
        this.distanceCheckTime -= dt;
        if (this.distanceCheckTime > 0) return;

        const position = this.player.physicsController.position;
        for (const [id, player] of this.everyone) {
            if (id === this.id || !player) continue;
            const dist = MathHelper.distance(
                position,
                player.physicsController.position,
            );
            const index = this.closePlayers.indexOf(player);
            if (dist < this.chaseDistance) {
                if (index === -1) this.closePlayers.push(player);
            } else if (index !== -1) {
                this.closePlayers.splice(index, 1);
            }
        }
        this.distanceCheckTime = this.timeForDistanceCheck;
    }
}
