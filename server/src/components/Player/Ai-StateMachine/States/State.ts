import { AiController } from "../../Ai-Controller";

export class State {
    player: AiController;

    constructor(player: AiController) {
        this.player = player;
    }

    onEnter(): void {}

    onUpdate(dt: number): void {}

    onExit(): void {}
}
