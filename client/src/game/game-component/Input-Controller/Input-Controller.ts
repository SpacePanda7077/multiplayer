import { Input, Scene } from "phaser";
import { Get_NO_INPUT, PlayerInputState } from "./PlayerInputs";

export class InputController {
    scene: Scene;
    target: Phaser.GameObjects.Rectangle;
    mouse = {
        x: 0,
        y: 0,
    };
    targetPosition = {
        x: 0,
        y: 0,
    };

    private inputState: PlayerInputState = Get_NO_INPUT();
    moves: {
        left: Input.Keyboard.Key | undefined;
        right: Input.Keyboard.Key | undefined;
        up: Input.Keyboard.Key | undefined;
        down: Input.Keyboard.Key | undefined;
        jump: Input.Keyboard.Key | undefined;
    };
    pointer: Input.Pointer;
    constructor(scene: Scene) {
        this.scene = scene;
        this.target = scene.add.rectangle(0, 0, 10, 10, 0xfff000);
        this.scene.input.on("pointermove", (p: Input.Pointer) => {
            this.mouse.x = p.x;
            this.mouse.y = p.y;
        });
        this.moves = {
            left: scene.input.keyboard?.addKey(Input.Keyboard.KeyCodes.A),
            right: scene.input.keyboard?.addKey(Input.Keyboard.KeyCodes.D),
            up: scene.input.keyboard?.addKey(Input.Keyboard.KeyCodes.W),
            down: scene.input.keyboard?.addKey(Input.Keyboard.KeyCodes.S),
            jump: scene.input.keyboard?.addKey(Input.Keyboard.KeyCodes.SPACE),
        };
        this.pointer = scene.input.activePointer;
    }

    update() {
        this.updateInputstate();
    }
    updateMouseWithCam() {
        const cam = this.scene.cameras.main;
        const view = cam.worldView;
        this.target.x = view.x + this.mouse.x / cam.zoom;
        this.target.y = view.y + this.mouse.y / cam.zoom;
    }

    getInputState() {
        return {
            moveX: this.inputState.moveX,
            moveY: this.inputState.moveY,
            targetX: this.target.x,
            targetY: this.target.y,
            isShooting: this.inputState.isShooting,
            dodge: this.inputState.dodge,
        };
    }

    private updateInputstate() {
        this.inputState = Get_NO_INPUT();
        if (this.moves.left?.isDown) {
            this.inputState.moveX = -1;
        } else if (this.moves.right?.isDown) {
            this.inputState.moveX = 1;
        } else {
            this.inputState.moveX = 0;
        }

        if (this.moves.up?.isDown) {
            this.inputState.moveY = -1;
        } else if (this.moves.down?.isDown) {
            this.inputState.moveY = 1;
        } else {
            this.inputState.moveY = 0;
        }

        if (Input.Keyboard.JustDown(this.moves.jump!)) {
            this.inputState.dodge = true;
        }
        if (this.pointer.isDown) {
            this.inputState.isShooting = true;
        }
        // console.log(this.inputState.dodge);
        this.updateMouseWithCam();
    }
}
