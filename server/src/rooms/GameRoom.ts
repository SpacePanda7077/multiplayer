import { Room, Client, CloseCode, StepContext } from "colyseus";
import { GameRoomState, players } from "./schema/GameRoomState.js";
import { Player } from "../components/Player/Player.js";
import RAPIER from "../rapier.js";
import { MoveInput } from "../components/shared/MoveInput.js";
import { ShootController } from "../components/shoot-Controller/Shoot-Controller.js";
import {
  WeaponCategory,
  Weapons,
} from "../components/shoot-Controller/Weapons.js";
import { Inventory, InventoryType } from "../components/shared/Inventory.js";
import { MapBuilder } from "../components/Map-Builder/Map-Builder.js";
import { AiController } from "../components/Player/Ai-Controller.js";
import { attachHitReactions } from "../components/Player/Hit-Reaction.js";

export class GameRoom extends Room<{ state: GameRoomState }> {
  maxClients = 2;
  state = new GameRoomState();
  waitTimer = 5;
  gameStarted = false;
  botsFilled = false;
  players: Map<string, Player> = new Map();
  bots: Map<string, AiController> = new Map();
  client_inputs = this.defineInput(MoveInput, { bufferMaxSize: 64 });
  messages = {};
  world: RAPIER.World;
  shootController: ShootController;

  onCreate(options: any) {
    /**
     * Called when a new room is created.
     */
    const waitTimer = this.clock.setInterval(async () => {
      this.waitTimer--;
      this.broadcast("time-till-start", this.waitTimer);
      if (this.waitTimer <= 3 && !this.botsFilled) {
        this.fillTheRoom();
        await this.lock();
      }
      if (this.waitTimer <= 0) {
        this.gameStarted = true;
        waitTimer.clear();
      }
    }, 1000);
    this.world = new RAPIER.World({ x: 0, y: 0 });
    new MapBuilder({ world: this.world });
    this.shootController = new ShootController({
      world: this.world,
      weapon: Weapons.list("shotguns")[0],
    });
    attachHitReactions(this.shootController, this.players, this.bots);

    this.setFixedTimestep((ctx) => this.step(ctx), 60);
  }

  step(ctx: StepContext) {
    if (!this.gameStarted) return;
    for (const [sid, p] of this.state.players) {
      const cmd = this.client_inputs.get(sid).next(); // one input per tick
      const player = this.players.get(sid);

      if (!player) continue;
      if (cmd) {
        //applyInput(p, cmd, ctx.dt); // SAME fn the client predicts with}
        player.update(ctx.dt, cmd);
        Object.assign(p, player.getState(cmd));
      }
      // ...advance world, then hit tests (see Lag Compensation).
    }
    for (const [id, ai] of this.bots) {
      ai.update(ctx.dt);
      const playerState = this.state.players.get(id);
      if (playerState) {
        Object.assign(playerState, ai.player.getState(ai.inputState));
      }
    }
    this.world.step();
  }

  onJoin(client: Client, options: any) {
    /**
     * Called when a client joins the room.
     */
    const id = client.sessionId;
    const inventory = this.getInventoryType({
      primary: { category: "rifles", weapon: 0 },
      secondary: { category: "shotguns", weapon: 0 },
    });

    const player = new Player({
      x: 400,
      y: 300,
      world: this.world,
      shootController: this.shootController,
      inventory,
    });
    this.players.set(id, player);
    const playerState = this.setPlayerState({ x: 400, y: 300, inventory });

    this.state.players.set(id, playerState);
    console.log(client.sessionId, "joined!");
  }

  onLeave(client: Client, code: CloseCode) {
    /**
     * Called when a client leaves the room.
     */
    console.log(client.sessionId, "left!", code);
  }

  onDispose() {
    /**
     * Called when the room is disposed.
     */
    console.log("room", this.roomId, "disposing...");
  }

  setPlayerState(data: { x: number; y: number; inventory: InventoryType }) {
    const playerState = new players();
    playerState.x = data.x;
    playerState.y = data.y;
    const primary_weapon_category = data.inventory.primary.category;
    const primary_weapon_index = data.inventory.primary.weapon;
    const secondary_weapon_category = data.inventory.secondary.category;
    const secondary_weapon_index = data.inventory.secondary.weapon;
    const primary_weapon = Weapons.list(primary_weapon_category)[
      primary_weapon_index
    ];
    const secondary_weapon = Weapons.list(secondary_weapon_category)[
      secondary_weapon_index
    ];

    playerState.inventory.primary.assign({
      category: primary_weapon_category,
      weapon: primary_weapon_index,
      ammo: primary_weapon.ammo,
      maxAmmo: primary_weapon.maxAmmo,
    });

    playerState.inventory.secondary.assign({
      category: secondary_weapon_category,
      weapon: secondary_weapon_index,
      ammo: secondary_weapon.ammo,
      maxAmmo: secondary_weapon.maxAmmo,
    });

    playerState.inventory.ammos.assign({
      heavy: data.inventory.ammos.heavy,
      light: data.inventory.ammos.light,
      shotgun: data.inventory.ammos.shotgun,
      sniper: data.inventory.ammos.sniper,
    });

    playerState.inventory.granades.assign({
      impact: data.inventory.granades.impact,
      time: data.inventory.granades.time,
      flash: data.inventory.granades.flash,
      gas: data.inventory.granades.gas,
      smoke: data.inventory.granades.smoke,
    });

    return playerState;
  }

  getInventoryType(data: {
    primary: { category: WeaponCategory; weapon: number };
    secondary: { category: WeaponCategory; weapon: number };
  }): InventoryType {
    return {
      primary: data.primary,
      secondary: data.secondary,
      ammos: {
        heavy: 300,
        light: 300,
        shotgun: 150,
        sniper: 150,
      },
      granades: {
        impact: 0,
        time: 0,
        flash: 0,
        gas: 0,
        smoke: 0,
      },
    };
  }

  fillTheRoom() {
    if (this.botsFilled) return;
    this.botsFilled = true;

    const remaining_clients = this.maxClients - this.clients.length;
    for (let i = 0; i < remaining_clients; i++) {
      const id = `ai_${i}`; // unique id per bot
      const x = 400 + (i + 1) * 80; // don't spawn on top of the human
      const y = 300;
      const inventory = this.getInventoryType({
        primary: { category: "rifles", weapon: 0 },
        secondary: { category: "shotguns", weapon: 0 },
      });

      const ai = new AiController({
        x,
        y,
        id,
        world: this.world,
        shootController: this.shootController,
        inventory,
        everyone: this.players,
      });
      this.bots.set(id, ai);
      this.players.set(id, ai.player);
      this.state.players.set(id, this.setPlayerState({ x, y, inventory }));
    }
  }
}
