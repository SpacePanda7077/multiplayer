export const CHAR_HEIGHT = 128;
export const GUN_BASE = { x: 0, y: 32 }; // gun pivot in visuals space (middle of the character)

// feet -> gun pivot at rest: visuals origin is HALF above the feet, gun is GUN_BASE below that
export const GUN_PIVOT_OFFSET = {
  x: GUN_BASE.x,
  y: -CHAR_HEIGHT / 2 + GUN_BASE.y,
}; // (0, -32)

export function gunPivot(feet: { x: number; y: number }) {
  return { x: feet.x + GUN_PIVOT_OFFSET.x, y: feet.y + GUN_PIVOT_OFFSET.y };
}
