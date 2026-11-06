import { Scene } from "phaser";
import { EventBus } from "../EventBus";
import { RapierDebugDrawer } from "../game-component/utils/Rapier-Debug";
import { World } from "@dimforge/rapier2d-compat";
import { Player } from "../game-component/Player/Player";
import { InputController } from "../game-component/Input-Controller/Input-Controller";
import { Predict, type Room } from "@colyseus/sdk";
import { useRoomManager } from "../../store/room-manager";
import { MoveInput } from "../game-component/shared/MoveInput";
import { PlayerInputState } from "../game-component/Input-Controller/PlayerInputs";
import { ServerPlayer } from "../game-component/Player/ServerPlayer";
import { ShootController } from "../game-component/shoot-Controller/Shoot-Controller";

import { MapBuilder } from "../game-component/Map-Builder/Map-Builder";
import { AiController } from "../game-component/Player/Ai-Controller";
import { client } from "../../App";

export class Game extends Scene {
    world: World;
    debug: RapierDebugDrawer;
    player: Player;
    inputController: InputController;
    room: Room<any, any>;
    predict: Predict<any>;
    history: Map<number, { x: number; y: number; vx: number; vy: number }> =
        new Map();
    lastAck = 0;
    serverInput: import("@colyseus/sdk").InputHandle<
        {
            moveX: number;
            moveY: number;
            targetX: number;
            targetY: number;
            isShooting: boolean;
            dodge: boolean;
        } & {} & import("@colyseus/schema").Schema<any> &
            import("@colyseus/schema").Schema<unknown>
    >;
    serverPlayer: ServerPlayer;
    shootController: ShootController;
    serverShootController: ShootController;

    frontendPlayers: Map<string, Player> = new Map();
    bots: Map<string, AiController> = new Map();
    me: import("@colyseus/sdk").Reconciler<
        any,
        import("@colyseus/schema").Data<
            {
                moveX: number;
                moveY: number;
                targetX: number;
                targetY: number;
                isShooting: boolean;
                dodge: boolean;
            } & import("@colyseus/schema").Schema<any> &
                import("@colyseus/schema").Schema<unknown>
        >
    >;
    //ai: AiController;
    constructor() {
        super("Game");
    }
    init(data: { room: Room }) {
        console.log(data);
        this.room = data.room;
    }
    preload() {
        this.load.setPath("assets");
    }

    create() {
        this.predict = Predict.get(this.room, { mode: "lerp", delay: 100 });
        // Remote players: render 100ms in the past, interpolated between snapshots.
        this.predict.attachAll("players", { mode: "lerp", fields: ["x", "y"] });
        this.world = new World({ x: 0, y: 0 });
        new MapBuilder({ world: this.world });
        this.debug = new RapierDebugDrawer(this, this.world, {
            depth: 10000000,
        });
        this.shootController = new ShootController(this, {
            world: this.world,

            // debugRay: true, // draws the raw ray in red
        });
        this.serverShootController = new ShootController(this, {
            world: this.world,
        });
        this.inputController = new InputController(this);
        this.serverInput = this.room.input({ type: MoveInput });

        const self = this.room.state.players.get(this.room.sessionId);
        this.player = new Player(this, {
            x: self.x,
            y: self.y,
            world: this.world,
            shootController: this.shootController,
            inventory: self.inventory,
        });

        // this.ai = new AiController(this, {
        //     x: self.x,
        //     y: self.y,
        //     id: "ai_player",
        //     world: this.world,
        //     shootController: this.shootController,
        //     inventory: self.inventory,
        //     everyone: this.frontendPlayers,
        // });
        // this.bots.set(this.ai.id, this.ai);
        this.frontendPlayers.set(this.room.sessionId, this.player);
        // this.frontendPlayers.set(this.ai.id, this.ai.player);
        // attachHitReactions(
        //     this.shootController,
        //     this.frontendPlayers,
        //     this.bots,
        // );

        // human player (so bots react to your shots)

        this.serverPlayer = new ServerPlayer(this, {
            x: 400,
            y: 300,
            world: this.world,
            shootController: this.serverShootController,
            player: this.player,
        });
        console.log(self);
        this.cameras.main.startFollow(this.player.body, false, 0.05, 0.05);
        this.me = this.predict.reconciler(self, {
            input: this.serverInput,
            step: (ctx, s, cmd) => {
                this.serverPlayer.setState(s); // rewind
                this.serverPlayer.update(ctx.dt, cmd); // replay
                Object.assign(s, this.serverPlayer.getState()); // ← recon is now applied
                this.resetPlayerIfDesynced(s);
            },
            smoothMs: 65,
        });

        for (const [id, p] of this.room.state.players) {
            if (id === this.room.sessionId) continue;
            console.log("creating player", id, p);
            const player = new Player(this, {
                x: p.x,
                y: p.y,
                world: this.world,
                shootController: this.shootController,
                inventory: p.inventory,
            });
            this.frontendPlayers.set(id, player);
        }

        EventBus.emit("current-scene-ready", this);
    }

    update(time: number, delta: number): void {
        this.inputController.update();

        const n = this.predict.tick();

        const dt = this.serverInput.stepSeconds || 0.03333333;

        for (let i = 0; i < n; i++) {
            const input = this.inputController.getInputState();
            this.sendServerInput(input);

            this.player.update(dt, input);
            const position = this.player.physicsController.position;
            const v = this.player.physicsController.velocity;
            this.history.set(this.serverInput.sentCount, {
                x: position.x,
                y: position.y,
                vx: v.x,
                vy: v.y,
            });

            // this.ai.update(this.serverInput.stepSeconds || 0.03333333);
            this.world.step();
        }
        for (const [id, p] of this.room.state.players) {
            // console.log("creating player", id);
            if (id === this.room.sessionId) continue;
            const player = this.frontendPlayers.get(id);
            if (player) {
                const x = this.predict.value(p, "x");
                const y = this.predict.value(p, "y");
                const vx = this.predict.value(p, "vx");
                const vy = this.predict.value(p, "vy");
                const targetX = this.predict.value(p, "targetX");
                const targetY = this.predict.value(p, "targetY");
                const shotsFired = this.predict.value(p, "shotsFired");
                const isShooting = this.predict.value(p, "isShooting");
                const isDodging = this.predict.value(p, "isDodging");

                player.setState(
                    {
                        x,
                        y,
                        vx,
                        vy,
                        targetX,
                        targetY,
                        shotsFired,
                        isShooting: Boolean(isShooting),
                        isDodging: Boolean(isDodging),
                    },
                    dt,
                );
            }
        }

        this.debug.update();
    }

    sendServerInput(input: PlayerInputState) {
        this.serverInput.data.moveX = input.moveX;
        this.serverInput.data.moveY = input.moveY;
        this.serverInput.data.targetX = input.targetX;
        this.serverInput.data.targetY = input.targetY;
        this.serverInput.data.isShooting = input.isShooting;
        this.serverInput.data.dodge = input.dodge;
        this.serverInput.send();
    }

    resetPlayerIfDesynced(s: any) {
        const ack = this.serverInput.lastProcessed;
        const dt = this.serverInput.stepSeconds || 0.03333333;

        if (ack !== this.lastAck) {
            this.lastAck = ack;
            const mine = this.history.get(ack);
            const self = s;

            if (mine && self) {
                // raw server position after input `ack` vs where we were after that same input
                const err = Math.hypot(self.x - mine.x, self.y - mine.y);
                const e = (k: number) => {
                    const h = this.history.get(ack + k);
                    return h
                        ? Math.hypot(self.x - h.x, self.y - h.y).toFixed(1)
                        : "-";
                };

                console.log(err);

                if (err > 20) {
                    console.log(err, mine, self);
                    this.player.setState(s, dt);
                    // the old records belong to the trajectory we just threw away
                    this.history.clear();
                } else {
                    for (const seq of this.history.keys()) {
                        if (seq <= ack) this.history.delete(seq);
                    }
                }

                //console.log(this.history);
            }
        }
    }
}
