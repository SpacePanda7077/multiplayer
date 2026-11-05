import { useEffect, useRef } from "react";
import { IRefPhaserGame, PhaserGame } from "./PhaserGame";
import { Client } from "@colyseus/sdk";

import "./App.css";
import MenuScreen from "./screens/Menu-Screen/Menu";
import { EventBus } from "./game/EventBus";
import { Scene } from "phaser";
import { useSceneManager } from "./store/scene-manager";

export const client = new Client("http://localhost:2567");
function App() {
    const phaserRef = useRef<IRefPhaserGame | null>(null);
    const setScene = useSceneManager((s) => s.setScene);
    const scene = useSceneManager((s) => s.scene);
    useEffect(() => {
        EventBus.on("current-scene-ready", (scene: Scene) => {
            setScene(scene);
        });
    }, []);
    return (
        <div id="app">
            <PhaserGame ref={phaserRef} />
            <div>{scene?.scene.key === "Menu" && <MenuScreen />}</div>
        </div>
    );
}

export default App;
