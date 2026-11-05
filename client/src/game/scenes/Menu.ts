import { Scene } from "phaser";
import { EventBus } from "../EventBus";
import { init } from "@dimforge/rapier2d-compat";
import { useRoomManager } from "../../store/room-manager";
import { Room, RoomAvailable } from "@colyseus/sdk";
import { client } from "../../App";

export class Menu extends Scene {
    room: Room<any, any>;
    constructor() {
        super("Menu");
    }

    preload() {
        this.load.setPath("assets");
    }

    create() {
        const { width, height } = this.scale;

        this.add
            .text(width / 2, height / 2, "Menu Scene")
            .setOrigin(0.5)
            .setScale(3);

        EventBus.emit("current-scene-ready", this);
    }
}
