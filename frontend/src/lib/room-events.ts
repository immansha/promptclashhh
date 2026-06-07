import type {
  GenerationJobOut,
  RoomDetailOut,
  RoomWebSocketEvent,
  RoundDetailOut,
  RoundOut,
  SubmissionOut,
} from "@/lib/types";

export function applyRoomEvent(room: RoomDetailOut, event: RoomWebSocketEvent): RoomDetailOut {
  switch (event.type) {
    case "room.created":
      return { ...room, ...event.room };
    case "room.status_changed":
      return { ...room, status: event.status };
    case "room.participant_joined":
      return { ...room, participants: upsertById(room.participants, event.participant) };
    case "round.created":
    case "round.started":
    case "round.closed":
      return upsertRound(room, event.round);
    case "submission.created":
      return upsertSubmission(room, event.submission);
    case "job.queued":
      return patchSubmissionJob(room, event.job.submission_id, event.job);
    case "job.running":
      return patchSubmissionJob(room, event.submission_id, {
        id: event.job_id,
        submission_id: event.submission_id,
        status: "running",
        started_at: event.started_at,
      });
    case "job.completed":
      return patchSubmissionJob(room, event.submission_id, {
        id: event.job_id,
        submission_id: event.submission_id,
        status: "completed",
        output_text: event.output_text,
        completed_at: event.completed_at,
      });
    case "job.failed":
      return patchSubmissionJob(room, event.submission_id, {
        id: event.job_id,
        submission_id: event.submission_id,
        status: "failed",
        error_message: event.error_message,
        retry_count: event.retry_count,
      });
    case "job.timed_out":
      return patchSubmissionJob(room, event.submission_id, {
        id: event.job_id,
        submission_id: event.submission_id,
        status: "timed_out",
        error_message: event.error_message,
        completed_at: event.completed_at,
      });
    case "submission.scored":
      return patchSubmission(room, event.submission_id, { score: event.score });
    case "participant.eliminated":
      return {
        ...patchSubmission(room, event.submission_id, { is_eliminated: true }),
        participants: room.participants.map((participant) =>
          participant.id === event.participant_id ? { ...participant, is_eliminated: true } : participant,
        ),
      };
  }
}

export function upsertRound(room: RoomDetailOut, round: RoundOut | RoundDetailOut): RoomDetailOut {
  return {
    ...room,
    rounds: upsertById(room.rounds, {
      ...round,
      submissions: "submissions" in round ? round.submissions : room.rounds.find((item) => item.id === round.id)?.submissions ?? [],
    }),
  };
}

export function upsertSubmission(room: RoomDetailOut, submission: SubmissionOut): RoomDetailOut {
  return {
    ...room,
    rounds: room.rounds.map((round) =>
      round.id === submission.round_id ? { ...round, submissions: upsertById(round.submissions, submission) } : round,
    ),
  };
}

export function patchSubmission(room: RoomDetailOut, submissionId: string, patch: Partial<SubmissionOut>): RoomDetailOut {
  return {
    ...room,
    rounds: room.rounds.map((round) => ({
      ...round,
      submissions: round.submissions.map((submission) =>
        submission.id === submissionId ? { ...submission, ...patch } : submission,
      ),
    })),
  };
}

export function patchSubmissionJob(
  room: RoomDetailOut,
  submissionId: string,
  jobPatch: Partial<GenerationJobOut> & Pick<GenerationJobOut, "id" | "submission_id" | "status">,
): RoomDetailOut {
  return {
    ...room,
    rounds: room.rounds.map((round) => ({
      ...round,
      submissions: round.submissions.map((submission) =>
        submission.id === submissionId
          ? {
              ...submission,
              generation_job: {
                retry_count: 0,
                queued_at: "",
                ...(submission.generation_job ?? {}),
                ...jobPatch,
              },
            }
          : submission,
      ),
    })),
  };
}

function upsertById<TItem extends { id: string }>(items: TItem[], item: TItem): TItem[] {
  return items.some((current) => current.id === item.id)
    ? items.map((current) => (current.id === item.id ? { ...current, ...item } : current))
    : [...items, item];
}

export function buildRoomSocketUrl(apiBaseUrl: string, code: string, userId: string): string {
  const wsBaseUrl = apiBaseUrl.replace(/^http/, "ws").replace(/\/$/, "");
  return `${wsBaseUrl}/rooms/${encodeURIComponent(code)}/ws?user_id=${encodeURIComponent(userId)}`;
}

export function parseSocketEvent(raw: string): RoomWebSocketEvent | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRoomEvent(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isRoomEvent(value: unknown): value is RoomWebSocketEvent {
  if (typeof value !== "object" || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return (
    type === "room.created" ||
    type === "room.status_changed" ||
    type === "room.participant_joined" ||
    type === "round.created" ||
    type === "round.started" ||
    type === "round.closed" ||
    type === "submission.created" ||
    type === "job.queued" ||
    type === "job.running" ||
    type === "job.completed" ||
    type === "job.failed" ||
    type === "job.timed_out" ||
    type === "submission.scored" ||
    type === "participant.eliminated"
  );
}
