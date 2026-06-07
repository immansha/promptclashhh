import { getRoom, joinRoom } from "@/lib/api";
import type { RoomDetailOut } from "@/lib/types";

export async function fetchRoomSnapshot(
  code: string,
  userId: string,
  apiBaseUrl: string,
): Promise<{ snapshot: RoomDetailOut; autoJoined: boolean }> {
  let snapshot = await getRoom(code, userId, apiBaseUrl);
  const isParticipant = snapshot.participants.some((participant) => participant.user_id === userId);

  if (!isParticipant) {
    snapshot = await joinRoom(code, userId, apiBaseUrl);
    return { snapshot, autoJoined: true };
  }

  return { snapshot, autoJoined: false };
}
