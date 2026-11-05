import type { RigidBody } from "@dimforge/rapier2d-compat";
import type { ShootController } from "../shoot-Controller/Shoot-Controller";
import type { AiController } from "./Ai-Controller";
import type { Player } from "./Player";

function bodyOf(p: Player): RigidBody | undefined {
    // adjust if your PlayerPhysicsController names the body differently
    const pc = p.physicsController as any;
    return pc.body ?? pc.rigidBody;
}

const sameBody = (a?: RigidBody | null, b?: RigidBody | null) =>
    !!a && !!b && a.handle === b.handle;

/**
 * Attach once to the shared ShootController. Makes bots react when they are hit,
 * whoever fired. Chains onto any existing onHit.
 */
export function attachHitReactions(
    shootController: ShootController,
    everyone: Map<string, Player>,
    bots: Map<string, AiController>,
) {
    const previous = shootController.onHit;

    shootController.onHit = (shot) => {
        previous?.(shot);
        if (!shot.body) return;

        // victim: which bot owns the body that was hit
        let victim: AiController | undefined;
        for (const bot of bots.values()) {
            if (sameBody(bodyOf(bot.player), shot.body)) {
                victim = bot;
                break;
            }
        }
        if (!victim) return; // hit a wall or a non-bot player

        // shooter: whoever's body this shot was excluded from
        let shooter: Player | null = null;
        for (const p of everyone.values()) {
            if (sameBody(bodyOf(p), shot.shooterBody)) {
                shooter = p;
                break;
            }
        }
        if (shooter === victim.player) return; // friendly self-hit, ignore

        // shooter unknown: the bot still reacts to the spot the shot came from
        victim.onHit(shooter, shot.origin);
    };
}
