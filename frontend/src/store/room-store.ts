import { create } from "zustand";
import { applyRoomEvent, patchSubmission, upsertRound, upsertSubmission } from "@/lib/room-events";
import type {
  ParticipantOut,
  RoomDetailOut,
  RoomWebSocketEvent,
  RoundDetailOut,
  RoundOut,
  SubmissionOut,
} from "@/lib/types";

export type RoomRole = "host" | "participant" | "spectator";

export type ActivityEvent = {
  id: number;
  type: string;
  detail: string;
  message: string;
  timestamp: string;
};

type RoomStoreState = {
  room: RoomDetailOut | null;
  currentUserId: string | null;
  participants: ParticipantOut[];
  rounds: RoundDetailOut[];
  role: RoomRole | null;
  events: ActivityEvent[];
  apiBaseUrl: string;
  isLoading: boolean;
  loadError: string | null;
  setApiBaseUrl: (apiBaseUrl: string) => void;
  setRoomState: (room: RoomDetailOut, userId: string) => void;
  applyRealtimeEvent: (event: RoomWebSocketEvent) => void;
  upsertRoundInRoom: (round: RoundOut | RoundDetailOut) => void;
  upsertSubmissionInRoom: (submission: SubmissionOut) => void;
  patchSubmissionInRoom: (submissionId: string, patch: Partial<SubmissionOut>) => void;
  markParticipantEliminated: (participantId: string, submission: SubmissionOut) => void;
  pushActivity: (type: string, detail: string) => void;
  setLoading: (isLoading: boolean) => void;
  setLoadError: (loadError: string | null) => void;
  resetRoom: () => void;
};

const DEFAULT_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

const initialState = {
  room: null,
  currentUserId: null,
  participants: [],
  rounds: [],
  role: null,
  events: [],
  apiBaseUrl: DEFAULT_API_BASE_URL,
  isLoading: false,
  loadError: null,
};

function resolveRole(room: RoomDetailOut, userId: string): RoomRole | null {
  const participant = room.participants.find((entry) => entry.user_id === userId);
  if (!participant) return null;
  if (participant.is_host) return "host";
  if (participant.is_eliminated) return "spectator";
  return "participant";
}

function syncRoomSnapshot(
  room: RoomDetailOut,
  userId: string,
): Pick<RoomStoreState, "room" | "currentUserId" | "participants" | "rounds" | "role"> {
  return {
    room,
    currentUserId: userId,
    participants: room.participants,
    rounds: room.rounds,
    role: resolveRole(room, userId),
  };
}

let nextActivityId = 0;

export const useRoomStore = create<RoomStoreState>()((set, get) => ({
  ...initialState,

  setApiBaseUrl: (apiBaseUrl) => set({ apiBaseUrl }),

  setRoomState: (room, userId) => {
    set({ ...syncRoomSnapshot(room, userId), loadError: null });
  },

  applyRealtimeEvent: (event) => {
    const { room, currentUserId } = get();
    if (!room || !currentUserId) return;

    const nextRoom = applyRoomEvent(room, event);
    set(syncRoomSnapshot(nextRoom, currentUserId));
    get().pushActivity(event.type, `seq ${event.seq}`);
  },

  upsertRoundInRoom: (round) => {
    const { room, currentUserId } = get();
    if (!room || !currentUserId) return;
    set(syncRoomSnapshot(upsertRound(room, round), currentUserId));
  },

  upsertSubmissionInRoom: (submission) => {
    const { room, currentUserId } = get();
    if (!room || !currentUserId) return;
    set(syncRoomSnapshot(upsertSubmission(room, submission), currentUserId));
  },

  patchSubmissionInRoom: (submissionId, patch) => {
    const { room, currentUserId } = get();
    if (!room || !currentUserId) return;
    const nextRoom = patchSubmission(room, submissionId, patch);
    set(syncRoomSnapshot(nextRoom, currentUserId));
  },

  markParticipantEliminated: (participantId, submission) => {
    const { room, currentUserId } = get();
    if (!room || !currentUserId) return;
    const patched = patchSubmission(room, submission.id, { ...submission, is_eliminated: true });
    const nextRoom: RoomDetailOut = {
      ...patched,
      participants: patched.participants.map((participant) =>
        participant.id === participantId ? { ...participant, is_eliminated: true } : participant,
      ),
    };
    set(syncRoomSnapshot(nextRoom, currentUserId));
  },

  pushActivity: (type, detail) => {
    nextActivityId += 1;
    const timestamp = new Date().toISOString();
    const message = `${new Date().toLocaleTimeString()} - ${type} - ${detail}`;
    set((state) => ({
      events: [{ id: nextActivityId, type, detail, message, timestamp }, ...state.events].slice(0, 18),
    }));
  },

  setLoading: (isLoading) => set({ isLoading }),
  setLoadError: (loadError) => set({ loadError }),

  resetRoom: () => {
    nextActivityId = 0;
    set({ ...initialState, apiBaseUrl: get().apiBaseUrl });
  },
}));

export function selectSortedRounds(rounds: RoundDetailOut[]): RoundDetailOut[] {
  return [...rounds].sort((left, right) => right.round_number - left.round_number);
}

export function selectCurrentRound(rounds: RoundDetailOut[]): RoundDetailOut | null {
  const sorted = selectSortedRounds(rounds);
  return (
    sorted.find((round) => round.status === "active") ??
    sorted.find((round) => round.status === "pending") ??
    sorted[0] ??
    null
  );
}

export function selectSubmissions(rounds: RoundDetailOut[]): Array<{ round: RoundDetailOut; submission: SubmissionOut }> {
  return selectSortedRounds(rounds).flatMap((round) =>
    round.submissions.map((submission) => ({ round, submission })),
  );
}
