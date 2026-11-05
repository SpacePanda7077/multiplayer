// shared/MoveInput.ts
import { schema, t, type SchemaType } from "@colyseus/schema";

export const MoveInput = schema({
  moveX: t.number(),
  moveY: t.number(),
  targetX: t.number(),
  targetY: t.number(),
  isShooting: t.boolean(),
  dodge: t.boolean(),
});
export type MoveInput = SchemaType<typeof MoveInput>;
