import { MathHelper } from "../../utils/Math-Helper";

export type AiProfile = {
    skill: number; // 0 = rookie, 1 = pro
    reactionTime: number; // seconds before acting on something new
    perceptionDelay: number; // aim tracks where the target WAS this long ago
    aimErrorDeg: number; // base aim wobble in degrees
    aimTurnSpeed: number; // max aim rotation, rad/s
    aimSmoothing: number; // higher = snappier aim
    settleTime: number; // seconds to go from sloppy to settled aim on a new target
    movingTargetPenalty: number; // extra error multiplier vs fast targets
    awareness: number; // 0..1 chance per 0.1s check of noticing it's being aimed at
    dodgeChance: number; // 0..1 chance to dodge once it noticed and reacted
    dodgeCooldown: number; // seconds between dodges
    dodgeDuration: number; // seconds a dodge lasts
    shootWhileDodging: boolean;
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Multiply by a random factor within +-pct. */
const vary = (v: number, pct: number) =>
    v * (1 + (Math.random() * 2 - 1) * pct);

/** Build a bot personality. skill 0 = clumsy and slow, 1 = sharp and fast. Random if omitted. */
export function createProfile(skill: number = Math.random()): AiProfile {
    const s = MathHelper.clamp(skill, 0, 1);
    const reactionTime = vary(lerp(0.45, 0.18, s), 0.15);
    return {
        skill: s,
        reactionTime,
        perceptionDelay: reactionTime * 0.6,
        aimErrorDeg: vary(lerp(9, 2, s), 0.2),
        aimTurnSpeed: lerp(4, 13, s),
        aimSmoothing: lerp(6, 16, s),
        settleTime: lerp(0.7, 0.25, s),
        movingTargetPenalty: lerp(1.5, 0.6, s),
        awareness: lerp(0.6, 0.95, s),
        dodgeChance: lerp(0.5, 0.9, s),
        dodgeCooldown: vary(lerp(2.5, 1.2, s), 0.2),
        dodgeDuration: vary(0.45, 0.2),
        shootWhileDodging: s > 0.5,
    };
}
