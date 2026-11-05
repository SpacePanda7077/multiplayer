import { Room, RoomAvailable } from "@colyseus/sdk";
import { create } from "zustand";
import { client } from "../App";

type rooms = {
    seatReserveCode: string | null;
    lobbyRoom: Room | null;
    gameRoom: Room | null;
    time: number | null;
    availableRooms: RoomAvailable[];
    setTime: (time: number) => void;
    setLobbyRoom: (room: Room | null) => void;
    setGameRoom: (room: Room | null) => void;
    setSeatReserveCode: (seatReserveCode: string | null) => void;
    joinLobby: () => Promise<Room>;
};

export const useRoomManager = create<rooms>((set, get) => ({
    seatReserveCode: null,
    lobbyRoom: null,
    gameRoom: null,
    availableRooms: [],
    time: null as number | null,
    setTime: (time: number | null) => set({ time }),
    setLobbyRoom: (room) => set({ lobbyRoom: room }),
    setGameRoom: (room) => set({ gameRoom: room }),
    setSeatReserveCode: (seatReserveCode) => set({ seatReserveCode }),

    joinLobby: async () => {
        const existing = get().lobbyRoom;
        if (existing) return existing;

        const lobby = await client.joinOrCreate("lobby");

        // Register immediately, before anything else can run
        lobby.onMessage("rooms", (rooms: RoomAvailable[]) => {
            set({ availableRooms: rooms });
            console.log(rooms);
        });

        lobby.onMessage("+", ([roomId, room]: [string, RoomAvailable]) => {
            const list = [...get().availableRooms];
            const i = list.findIndex((r) => r.roomId === roomId);
            if (i !== -1) list[i] = room;
            else list.push(room);
            set({ availableRooms: list });
            console.log(get().availableRooms);
        });

        lobby.onMessage("-", (roomId: string) => {
            set({
                availableRooms: get().availableRooms.filter(
                    (r) => r.roomId !== roomId,
                ),
            });
        });

        lobby.onLeave(() => set({ lobbyRoom: null, availableRooms: [] }));

        set({ lobbyRoom: lobby });
        return lobby;
    },
}));
