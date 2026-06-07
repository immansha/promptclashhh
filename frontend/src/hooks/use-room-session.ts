import { useCallback, useEffect } from "react";
import { fetchRoomSnapshot } from "@/lib/room-service";
import { useAuthStore } from "@/store/auth-store";
import { useRoomStore } from "@/store/room-store";
import { useWebSocketStore } from "@/store/websocket-store";

export function useRoomSession(roomCode: string) {
  const user = useAuthStore((state) => state.user);
  const hasHydrated = useAuthStore((state) => state.hasHydrated);

  const room = useRoomStore((state) => state.room);
  const participants = useRoomStore((state) => state.participants);
  const rounds = useRoomStore((state) => state.rounds);
  const role = useRoomStore((state) => state.role);
  const events = useRoomStore((state) => state.events);
  const apiBaseUrl = useRoomStore((state) => state.apiBaseUrl);
  const isLoading = useRoomStore((state) => state.isLoading);
  const loadError = useRoomStore((state) => state.loadError);

  const setApiBaseUrl = useRoomStore((state) => state.setApiBaseUrl);
  const setRoomState = useRoomStore((state) => state.setRoomState);
  const pushActivity = useRoomStore((state) => state.pushActivity);
  const resetRoom = useRoomStore((state) => state.resetRoom);
  const setLoading = useRoomStore((state) => state.setLoading);
  const setLoadError = useRoomStore((state) => state.setLoadError);
  const upsertRoundInRoom = useRoomStore((state) => state.upsertRoundInRoom);
  const upsertSubmissionInRoom = useRoomStore((state) => state.upsertSubmissionInRoom);
  const patchSubmissionInRoom = useRoomStore((state) => state.patchSubmissionInRoom);
  const markParticipantEliminated = useRoomStore((state) => state.markParticipantEliminated);

  const socketStatus = useWebSocketStore((state) => state.status);
  const lastEventTimestamp = useWebSocketStore((state) => state.lastEventTimestamp);
  const connectRoomSocket = useWebSocketStore((state) => state.connectRoomSocket);
  const disconnectRoomSocket = useWebSocketStore((state) => state.disconnectRoomSocket);

  const loadRoom = useCallback(
    async (reason: string) => {
      if (!user?.user_id) return;

      setLoading(true);
      setLoadError(null);

      try {
        const { snapshot, autoJoined } = await fetchRoomSnapshot(roomCode, user.user_id, apiBaseUrl);
        setRoomState(snapshot, user.user_id);
        if (autoJoined) {
          pushActivity("room.joined", "auto-joined as participant");
        }
        pushActivity("snapshot.loaded", reason);
        return snapshot;
      } catch (requestError) {
        const message = requestError instanceof Error ? requestError.message : "Could not fetch room state.";
        setLoadError(message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [apiBaseUrl, pushActivity, roomCode, setLoadError, setLoading, setRoomState, user],
  );

  useEffect(() => {
    if (!hasHydrated || !user?.user_id) return;
    void loadRoom("page load");
  }, [hasHydrated, loadRoom, user?.user_id]);

  useEffect(() => {
    if (!user?.user_id || !room?.code) return;

    connectRoomSocket({
      apiBaseUrl,
      roomCode: room.code,
      userId: user.user_id,
      onReconnect: () => {
        void loadRoom("socket reconnect");
      },
    });

    return () => {
      disconnectRoomSocket();
    };
  }, [apiBaseUrl, connectRoomSocket, disconnectRoomSocket, loadRoom, room?.code, user?.user_id]);

  useEffect(() => {
    return () => {
      resetRoom();
    };
  }, [resetRoom]);

  return {
    user,
    hasHydrated,
    room,
    participants,
    rounds,
    role,
    events,
    apiBaseUrl,
    isLoading,
    loadError,
    socketStatus,
    lastEventTimestamp,
    setApiBaseUrl,
    loadRoom,
    resetRoom,
    upsertRoundInRoom,
    upsertSubmissionInRoom,
    patchSubmissionInRoom,
    markParticipantEliminated,
    pushActivity,
  };
}
