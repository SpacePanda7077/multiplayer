import { Scene } from "phaser";
import { create } from "zustand";

type sceneManager = {
    scene: Scene | null;
    setScene: (scene: Scene | null) => void;
};

export const useSceneManager = create<sceneManager>((set) => ({
    scene: null,
    setScene: (scene) => set({ scene }),
}));
