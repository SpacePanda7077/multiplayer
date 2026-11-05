import type { World } from "@dimforge/rapier2d-compat"; // swap for your rapier2d/rapier2d-compat import
import { Display, GameObjects, Scene } from "phaser";

interface DebugRay {
    from: { x: number; y: number };
    to: { x: number; y: number };
    hit: boolean;
    hitPoint?: { x: number; y: number };
}

/**
 * Draws Rapier's debug collision shapes on top of a Phaser scene.
 * ...
 */
export class RapierDebugDrawer {
    private scene: Scene;
    private world: World;
    private graphics: GameObjects.Graphics;

    public pixelsPerMeter: number;
    public lineWidth: number;

    /** Colors for ray drawing — tweak to taste */
    public rayHitColor = 0xff0000; // red when it hits something
    public rayMissColor = 0x00ff00; // green when it doesn't
    public rayHitPointRadius = 3;

    private queuedRays: DebugRay[] = [];

    constructor(
        scene: Phaser.Scene,
        world: World,
        options: {
            pixelsPerMeter?: number;
            lineWidth?: number;
            depth?: number;
        } = {},
    ) {
        this.scene = scene;
        this.world = world;
        this.pixelsPerMeter = options.pixelsPerMeter ?? 1;
        this.lineWidth = options.lineWidth ?? 1;

        this.graphics = scene.add.graphics();
        this.graphics.setDepth(options.depth ?? 1000);
    }

    /**
     * Queue a ray/cast to be drawn this frame. Call this from wherever you
     * perform the raycast/shapecast (e.g. Physics_Controller.castDirection),
     * BEFORE calling update() for the frame.
     *
     * from/to are in physics world units (same space as your rigid bodies),
     * not screen pixels — pixelsPerMeter conversion happens in update().
     */
    addRay(
        from: { x: number; y: number },
        to: { x: number; y: number },
        hit: boolean,
        hitPoint?: { x: number; y: number },
    ): void {
        this.queuedRays.push({ from, to, hit, hitPoint });
    }

    /** Call once per frame after physics has stepped. */
    update(): void {
        const g = this.graphics;
        g.clear();

        this.drawColliders(g);
        this.drawQueuedRays(g);

        // rays are per-frame — clear the queue so stale ones don't persist
        this.queuedRays.length = 0;
    }

    private drawColliders(g: GameObjects.Graphics): void {
        const { vertices, colors } = this.world.debugRender();
        const ppm = this.pixelsPerMeter;

        for (let i = 0; i < vertices.length; i += 4) {
            const x1 = vertices[i] * ppm;
            const y1 = vertices[i + 1] * ppm;
            const x2 = vertices[i + 2] * ppm;
            const y2 = vertices[i + 3] * ppm;

            const colorIndex = i * 2;
            const r = colors[colorIndex] ?? 1;
            const gCol = colors[colorIndex + 1] ?? 1;
            const b = colors[colorIndex + 2] ?? 1;
            const a = colors[colorIndex + 3] ?? 1;

            const color = Display.Color.GetColor32(
                Math.floor(r * 255),
                Math.floor(gCol * 255),
                Math.floor(b * 255),
                Math.floor(a * 255),
            );

            g.lineStyle(this.lineWidth, color & 0xffffff, a);
            g.beginPath();
            g.moveTo(x1, y1);
            g.lineTo(x2, y2);
            g.strokePath();
        }
    }

    private drawQueuedRays(g: GameObjects.Graphics): void {
        const ppm = this.pixelsPerMeter;

        for (const ray of this.queuedRays) {
            const x1 = ray.from.x * ppm;
            const y1 = ray.from.y * ppm;
            const x2 = ray.to.x * ppm;
            const y2 = ray.to.y * ppm;

            const color = ray.hit ? this.rayHitColor : this.rayMissColor;

            g.lineStyle(this.lineWidth, color, 1);
            g.beginPath();
            g.moveTo(x1, y1);
            g.lineTo(x2, y2);
            g.strokePath();

            if (ray.hit && ray.hitPoint) {
                g.fillStyle(this.rayHitColor, 1);
                g.fillCircle(
                    ray.hitPoint.x * ppm,
                    ray.hitPoint.y * ppm,
                    this.rayHitPointRadius,
                );
            }
        }
    }

    setVisible(visible: boolean): void {
        this.graphics.setVisible(visible);
    }

    setDepth(depth: number): void {
        this.graphics.setDepth(depth);
    }

    destroy(): void {
        this.graphics.destroy();
    }
}
