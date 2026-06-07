import { create } from "zustand";
import { buildRoomSocketUrl, parseSocketEvent } from "@/lib/room-events";
import { useRoomStore } from "@/store/room-store";

export type SocketConnectionStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed" | "error";

type ConnectRoomSocketParams = {
  apiBaseUrl: string;
  roomCode: string;
  userId: string;
  onReconnect?: () => void;
};

type WebSocketStoreState = {
  status: SocketConnectionStatus;
  lastEventTimestamp: string | null;
  connectedRoomCode: string | null;
  connectRoomSocket: (params: ConnectRoomSocketParams) => void;
  disconnectRoomSocket: () => void;
};

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let shouldReconnect = false;
let reconnectHandler: (() => void) | null = null;
let activeConnectionKey: string | null = null;

const RECONNECT_DELAY_MS = 1800;

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function connectionKey(roomCode: string, userId: string, apiBaseUrl: string): string {
  return `${apiBaseUrl}::${roomCode}::${userId}`;
}

export const useWebSocketStore = create<WebSocketStoreState>()((set, get) => ({
  status: "idle",
  lastEventTimestamp: null,
  connectedRoomCode: null,

  connectRoomSocket: ({ apiBaseUrl, roomCode, userId, onReconnect }) => {
    const key = connectionKey(roomCode, userId, apiBaseUrl);

    if (socket && activeConnectionKey === key && socket.readyState === WebSocket.OPEN) {
      return;
    }

    if (socket && activeConnectionKey === key && socket.readyState === WebSocket.CONNECTING) {
      return;
    }

    reconnectHandler = onReconnect ?? null;
    shouldReconnect = true;
    activeConnectionKey = key;

    socket?.close();
    clearReconnectTimer();

    const currentStatus = get().status;
    set({
      status: currentStatus === "closed" || currentStatus === "error" ? "reconnecting" : "connecting",
      connectedRoomCode: roomCode,
    });

    const ws = new WebSocket(buildRoomSocketUrl(apiBaseUrl, roomCode, userId));
    socket = ws;

    ws.addEventListener("open", () => {
      set({ status: "open", connectedRoomCode: roomCode });
      useRoomStore.getState().pushActivity("socket.open", "live channel connected");
      ws.send(JSON.stringify({ type: "ping" }));
    });

    ws.addEventListener("message", (message) => {
      const event = parseSocketEvent(String(message.data));
      if (!event) return;

      set({ lastEventTimestamp: event.ts });
      useRoomStore.getState().applyRealtimeEvent(event);
    });

    ws.addEventListener("close", () => {
      set({ status: "closed" });
      useRoomStore.getState().pushActivity("socket.closed", "reconnect scheduled");

      if (!shouldReconnect || activeConnectionKey !== key) return;

      clearReconnectTimer();
      reconnectTimer = setTimeout(() => {
        reconnectHandler?.();
        get().connectRoomSocket({ apiBaseUrl, roomCode, userId, onReconnect: reconnectHandler ?? undefined });
      }, RECONNECT_DELAY_MS);
    });

    ws.addEventListener("error", () => {
      set({ status: "error" });
      useRoomStore.getState().pushActivity("socket.error", "connection problem");
    });
  },

  disconnectRoomSocket: () => {
    shouldReconnect = false;
    activeConnectionKey = null;
    reconnectHandler = null;
    clearReconnectTimer();
    socket?.close();
    socket = null;
    set({ status: "idle", connectedRoomCode: null });
  },
}));
