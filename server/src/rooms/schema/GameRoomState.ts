import { schema, t, type SchemaType } from "@colyseus/schema";

const weapon = schema(
  {
    category: t.string(),
    weapon: t.number(),
    maxAmmo: t.number(),
    ammo: t.number(),
  },
  "weapon",
);
export const inventory = schema(
  {
    primary: weapon,
    secondary: weapon,
    ammos: schema({
      heavy: t.number().default(300),
      light: t.number().default(300),
      shotgun: t.number().default(150),
      sniper: t.number().default(150),
    }),
    granades: schema(
      {
        impact: t.number().default(0),
        time: t.number().default(0),
        flash: t.number().default(0),
        gas: t.number().default(0),
        smoke: t.number().default(0),
      },
      "granades",
    ),
  },
  "inventory",
);

export const players = schema(
  {
    x: t.float64().default(0),
    y: t.float64().default(0),
    vx: t.float64().default(0),
    vy: t.float64().default(0),
    targetX: t.float64().default(0),
    targetY: t.float64().default(0),
    shotsFired: t.number().default(0),
    isShooting: t.boolean().default(false),
    isDodging: t.boolean().default(false),
    cooldown: t.float64().default(0),
    wasShooting: t.boolean().default(false),
    inventory: inventory,
  },
  "Players",
);

export const GameRoomState = schema(
  {
    players: t.map(players),
  },
  "GameRoomState",
);
export type GameRoomState = SchemaType<typeof GameRoomState>;
