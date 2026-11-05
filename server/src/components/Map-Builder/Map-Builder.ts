import { ColliderDesc, RigidBodyDesc, World } from "@dimforge/rapier2d-compat";

type Config = {
  world: World;
};

export class MapBuilder {
  world: World;
  constructor(config: Config) {
    this.world = config.world;
    this.createMap();
  }

  createMap() {
    const positions = [
      { x: 200, y: 100, w: 70, h: 70 },
      { x: 700, y: 600, w: 70, h: 100 },
      { x: 1200, y: 800, w: 120, h: 70 },
      { x: 200, y: 800, w: 120, h: 70 },
      { x: 1200, y: 200, w: 120, h: 70 },
    ];

    for (const pos of positions) {
      const rigidBodyDesc = RigidBodyDesc.fixed().setTranslation(pos.x, pos.y);
      const rigidBody = this.world.createRigidBody(rigidBodyDesc);
      const colliderDesc = ColliderDesc.cuboid(pos.w / 2, pos.h / 2);
      this.world.createCollider(colliderDesc, rigidBody);
    }
  }
}
