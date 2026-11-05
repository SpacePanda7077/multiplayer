// Shared by the client AND the server. No Phaser imports here.

export type WeaponVisuals = {
  tracerColor: number;
  tracerWidth: number;
  /** Length of the moving streak in world units. */
  tracerLength: number;
  /** Tracer travel speed in world units / second. */
  tracerSpeed: number;
  muzzleFlashColor: number;
  /** Muzzle flash size multiplier. */
  muzzleFlashScale: number;
  impactColor: number;
  /** Sparks spawned per impact. */
  impactSparks: number;
  /** Camera shake intensity per shot (0 = none). */
  shake: number;
};

export type WeaponConfig = {
  /** Unique across ALL categories. */
  id: string;
  name: string;
  damage: number;
  /** Max ray distance in world units. */
  range: number;
  /** Shots per second. */
  fireRate: number;
  /** Random cone in radians applied to every ray (0 = perfectly accurate). */
  spread: number;
  /** Rays per trigger pull. Pistol/rifle = 1, shotgun = many. */
  pellets: number;
  /** Hold to keep firing (true) or one shot per click (false). */
  automatic: boolean;
  /** Distance from the gun pivot to the barrel tip, in world units. */
  muzzleOffset: number;
  /** Multiplier for player push-back, gun kick and neck snap per shot (1 = normal). */
  recoil: number;
  /** Time in seconds before the gun can fire after being equipped. */
  maxAmmo: number;
  ammo: number;
  ammoType: "heavy" | "light" | "shotgun" | "sniper";
  reloadTime: number;
  equipTime: number;

  visuals: WeaponVisuals;
};

export const DEFAULT_VISUALS: WeaponVisuals = {
  tracerColor: 0xffe28a,
  tracerWidth: 2,
  tracerLength: 90,
  tracerSpeed: 4500,
  muzzleFlashColor: 0xfff3b0,
  muzzleFlashScale: 1,
  impactColor: 0xffb347,
  impactSparks: 6,
  shake: 0.0015,
};

type WeaponInput = Partial<Omit<WeaponConfig, "visuals">> & {
  id: string;
  visuals?: Partial<WeaponVisuals>;
};

/** Fill in defaults so a weapon only has to describe what makes it different. */
export function defineWeapon(input: WeaponInput): WeaponConfig {
  return {
    name: input.id,
    damage: 10,
    range: 900,
    fireRate: 4,
    spread: 0,
    pellets: 1,
    automatic: false,
    muzzleOffset: 80,
    recoil: 1,
    maxAmmo: 30,
    ammo: 30,
    ammoType: "heavy",
    reloadTime: 1.5,
    equipTime: 0.2,
    ...input,
    visuals: { ...DEFAULT_VISUALS, ...input.visuals },
  };
}

// ---------------------------------------------------------------------------
// The catalog: weapons grouped by category.
// Add a weapon by adding it to a list, add a category by adding a new key.
//
// NETWORK NOTE: a weapon's network index is its position when the lists are
// flattened in this order. Append new weapons at the END of the file / lists
// and never reorder, or old clients and the server will disagree on indices.
// ---------------------------------------------------------------------------

const WEAPON_CATALOG = {
  pistols: [
    defineWeapon({
      id: "pistol",
      name: "Pistol",
      damage: 12,
      fireRate: 4,
      spread: 0.03,
      range: 700,
      automatic: false,
      muzzleOffset: 80,
      ammoType: "light",
      recoil: 1,
    }),
    defineWeapon({
      id: "revolver",
      name: "Revolver",
      damage: 30,
      fireRate: 1.6,
      spread: 0.015,
      range: 800,
      automatic: false,
      muzzleOffset: 85,
      recoil: 1.8,
      ammoType: "light",
      equipTime: 0.3,
      visuals: { tracerColor: 0xffc27a, shake: 0.003 },
    }),
  ],

  smgs: [
    defineWeapon({
      id: "smg",
      name: "SMG",
      damage: 5,
      fireRate: 14,
      spread: 0.2,
      range: 600,
      automatic: true,
      muzzleOffset: 70,
      recoil: 0.4,
      ammoType: "light",
      equipTime: 0.15,
      visuals: { tracerLength: 60, impactSparks: 3, shake: 0.001 },
    }),
  ],

  rifles: [
    defineWeapon({
      id: "rifle",
      name: "Assault Rifle",
      damage: 8,
      fireRate: 10,
      spread: 0.06,
      range: 1000,
      automatic: true,
      muzzleOffset: 100,
      recoil: 0.6,
      ammoType: "heavy",
      visuals: { shake: 0.002, tracerWidth: 3 },
    }),
  ],

  shotguns: [
    defineWeapon({
      id: "shotgun",
      name: "Shotgun",
      damage: 6, // per pellet
      fireRate: 1.2,
      pellets: 7,
      spread: 0.35,
      range: 420,
      automatic: false,
      muzzleOffset: 90,
      recoil: 2,
      ammoType: "shotgun",
      equipTime: 0.4,
      visuals: {
        tracerLength: 50,
        muzzleFlashScale: 1.6,
        impactSparks: 3,
        shake: 0.005,
      },
    }),
  ],

  snipers: [
    defineWeapon({
      id: "sniper",
      name: "Sniper",
      damage: 70,
      fireRate: 0.8,
      spread: 0,
      range: 2000,
      automatic: false,
      muzzleOffset: 130,
      recoil: 2.5,
      ammoType: "sniper",
      equipTime: 0.6,
      visuals: {
        tracerColor: 0x8be9ff,
        tracerWidth: 3,
        tracerLength: 220,
        tracerSpeed: 9000,
        impactColor: 0x8be9ff,
        shake: 0.006,
      },
    }),
  ],
} satisfies Record<string, WeaponConfig[]>;

export type WeaponCategory = keyof typeof WEAPON_CATALOG;

// ---------------------------------------------------------------------------
// The registry: lookups by id, network index and category.
// ---------------------------------------------------------------------------

export class WeaponRegistry<C extends string> {
  private readonly flat: WeaponConfig[] = [];
  private readonly indexById = new Map<string, number>();
  private readonly categoryById = new Map<string, C>();
  private readonly byCategory = new Map<C, readonly WeaponConfig[]>();

  constructor(catalog: Record<C, readonly WeaponConfig[]>) {
    for (const category of Object.keys(catalog) as C[]) {
      const list = catalog[category];
      this.byCategory.set(category, list);

      for (const weapon of list) {
        if (this.indexById.has(weapon.id)) {
          throw new Error(`Duplicate weapon id: ${weapon.id}`);
        }
        this.indexById.set(weapon.id, this.flat.length);
        this.categoryById.set(weapon.id, category);
        this.flat.push(weapon);
      }
    }
    if (this.flat.length === 0) throw new Error("Weapon catalog is empty");
  }

  /** Number of weapons across all categories. */
  get count() {
    return this.flat.length;
  }

  /** The default weapon (first one in the catalog). */
  get first(): WeaponConfig {
    return this.flat[0];
  }

  categories(): C[] {
    return [...this.byCategory.keys()];
  }

  /** Every weapon in one category, e.g. Weapons.list("pistols"). */
  list(category: C): readonly WeaponConfig[] {
    return this.byCategory.get(category) ?? [];
  }

  /** Every weapon, in network index order. */
  all(): readonly WeaponConfig[] {
    return this.flat;
  }

  find(id: string): WeaponConfig | undefined {
    const index = this.indexById.get(id);
    return index === undefined ? undefined : this.flat[index];
  }

  /** Like find(), but throws, so typos in ids fail loudly. */
  get(id: string): WeaponConfig {
    const weapon = this.find(id);
    if (!weapon) throw new Error(`Unknown weapon id: ${id}`);
    return weapon;
  }

  /** Network index -> weapon. Returns undefined for invalid indices (never trust the client). */
  byIndex(index: number): WeaponConfig | undefined {
    return Number.isInteger(index) ? this.flat[index] : undefined;
  }

  /** Weapon id -> network index (-1 when unknown). */
  indexOf(id: string): number {
    return this.indexById.get(id) ?? -1;
  }

  categoryOf(id: string): C | undefined {
    return this.categoryById.get(id);
  }

  /**
   * Hotkey helper: returns the network index of the first weapon in `category`,
   * or the next one in that category when the current weapon is already in it.
   * Pressing the same key repeatedly cycles through the category.
   */
  cycle(category: C, currentIndex: number): number {
    const list = this.list(category);
    if (list.length === 0) return currentIndex;

    const current = this.byIndex(currentIndex);
    if (current && this.categoryById.get(current.id) === category) {
      const pos = list.findIndex((w) => w.id === current.id);
      return this.indexOf(list[(pos + 1) % list.length].id);
    }
    return this.indexOf(list[0].id);
  }
}

export const Weapons = new WeaponRegistry<WeaponCategory>(WEAPON_CATALOG);
