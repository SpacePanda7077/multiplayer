import { Room } from "@colyseus/sdk";
import { client } from "../../App";
import { useRoomManager } from "../../store/room-manager";

import CountDownTimer from "./CountDownTimer";

export default function MenuScreen() {
    const setGameRoom = useRoomManager((s) => s.setGameRoom);
    const gameRoom = useRoomManager((s) => s.gameRoom);
    const availableRooms = useRoomManager((s) => s.availableRooms);

    const joinAndSetup = (room: Room) => {
        console.log("set");
        room.onMessage("time-till-start", (t: number) => {
            useRoomManager.getState().setTime(t); // add `time` + `setTime` to your store
            console.log(t);
        });
        setGameRoom(room);
    };

    const EnterGame = async () => {
        let room;
        const open = availableRooms.filter((r: any) => !r.locked);
        if (open.length <= 0) {
            room = await client.joinOrCreate("game_room");
        } else {
            const best = [...open].sort((a, b) => b.clients - a.clients)[0];
            room = await client.joinById(best.roomId);
        }
        joinAndSetup(room);
    };

    return (
        <>
            <div className="absolute left-0 top-0 w-full h-full flex items-center justify-center">
                <button onClick={EnterGame} className="bg-green-500 py-3 px-8">
                    Start
                </button>
                {gameRoom && <CountDownTimer />}
            </div>
        </>
    );
}
