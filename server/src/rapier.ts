// src/rapier.ts
import RAPIER from "@dimforge/rapier2d-compat";

await RAPIER.init(); // runs once, the first time anything imports this file

export default RAPIER;
