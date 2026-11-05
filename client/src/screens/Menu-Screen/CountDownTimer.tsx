import { useEffect, useState } from "react";
import { useRoomManager } from "../../store/room-manager";
import { useSceneManager } from "../../store/scene-manager";

export default function CountDownTimer() {
    const gameRoom = useRoomManager((s) => s.gameRoom);
    const setGameRoom = useRoomManager((s) => s.setGameRoom);
    const time = useRoomManager((s) => s.time);
    const scene = useSceneManager((s) => s.scene);
    useEffect(() => {
        if (
            time !== null &&
            time <= 0 &&
            gameRoom &&
            scene?.scene.key === "Menu"
        ) {
            scene.scene.start("Game", { room: gameRoom });
        }
    }, [time, gameRoom, scene]);

    const cancel = () => {
        if (!gameRoom) {
            alert("Your Not In A Room");
            return;
        }
        gameRoom.leave();
        setGameRoom(null);
        alert("Your Left Game Room");
    };
    return (
        <>
            <div className="absolute left-1/2 top-1/2 bg-yellow-500 flex flex-col items-center justify-center -translate-1/2">
                <h1>waiting For Other Players</h1>
                // in the JSX
                <h1>{time ?? "..."}</h1>
                <button onClick={cancel}>Cancel</button>
            </div>
        </>
    );
}
