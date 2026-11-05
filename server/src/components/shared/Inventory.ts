import { WeaponConfig } from "../shoot-Controller/Weapons.js";

export type Inventory = {
  primary: WeaponConfig;
  secondary: WeaponConfig;
  ammos: {
    heavy: number;
    light: number;
    shotgun: number;
    sniper: number;
  };
  granades: {
    impact: number;
    time: number;
    flash: number;
    gas: number;
    smoke: number;
  };
};
type weapon = {
  category: "pistols" | "smgs" | "rifles" | "shotguns" | "snipers";
  weapon: number;
};

export type InventoryType = {
  primary: weapon;
  secondary: weapon;
  ammos: {
    heavy: number;
    light: number;
    shotgun: number;
    sniper: number;
  };
  granades: {
    impact: number;
    time: number;
    flash: number;
    gas: number;
    smoke: number;
  };
};
