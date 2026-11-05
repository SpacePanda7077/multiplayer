import { Scene } from "phaser";
import { EventBus } from "../EventBus";
import { init } from "@dimforge/rapier2d-compat";
import { useRoomManager } from "../../store/room-manager";

export class Boot extends Scene {
    constructor() {
        super("Boot");
    }

    preload() {
        this.load.setPath("assets");
        this.load.image("shoot_light", "light/shoot_light.png");
        this.load.image("body", "chickens/body/gray-duck.png");
        this.load.image("face", "chickens/face/gray-chicken-face.png");
    }

    create() {
        this.initializeRapier();
        EventBus.emit("current-scene-ready", this);
    }
    async initializeRapier() {
        await init().then(async () => {
            await useRoomManager.getState().joinLobby();
            this.scene.start("Menu");
        });
    }
}
