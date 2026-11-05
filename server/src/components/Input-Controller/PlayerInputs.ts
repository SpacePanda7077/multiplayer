export type PlayerInputState = {
    moveX: number;
    moveY: number;
    targetX: number;
    targetY: number;
    isShooting: boolean;
    dodge: boolean;
};

export const Get_NO_INPUT = () => {
    return {
        moveX: 0,
        moveY: 0,
        targetX: 0,
        targetY: 0,
        isShooting: false,
        dodge: false,
    };
};
