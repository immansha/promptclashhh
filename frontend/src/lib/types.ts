export type IdentityRequest = {
  name: string;
  email: string;
};

export type IdentityResponse = {
  user_id: string;
  name: string;
  email: string;
  created: boolean;
};

export type UserSummary = {
  id: string;
  name: string;
  email: string;
};

export type RoomStatus = "waiting" | "active" | "scoring" | "finished";

export type RoomOut = {
  id: string;
  host_id: string;
  code: string;
  status: RoomStatus | string;
  current_round: number;
  created_at: string;
};

export type ParticipantOut = {
  id: string;
  room_id: string;
  user_id: string;
  is_host: boolean;
  is_eliminated: boolean;
  joined_at: string;
  user?: UserSummary | null;
};

export type RoundStatus = "pending" | "active" | "closed";

export type RoundCreateRequest = {
  challenge_text: string;
};

export type GenerationJobOut = {
  id: string;
  submission_id: string;
  status: "queued" | "running" | "completed" | "failed" | "timed_out" | string;
  output_text?: string | null;
  error_message?: string | null;
  retry_count: number;
  queued_at: string;
  started_at?: string | null;
  completed_at?: string | null;
};

export type SubmissionOut = {
  id: string;
  round_id: string;
  participant_id: string;
  prompt_text: string;
  score?: number | null;
  is_eliminated: boolean;
  submitted_at: string;
  generation_job?: GenerationJobOut | null;
};

export type RoundOut = {
  id: string;
  room_id: string;
  round_number: number;
  challenge_text: string;
  status: RoundStatus | string;
  started_at?: string | null;
  ended_at?: string | null;
};

export type RoundDetailOut = RoundOut & {
  submissions: SubmissionOut[];
};

export type RoomDetailOut = RoomOut & {
  participants: ParticipantOut[];
  rounds: RoundDetailOut[];
};

export type WebSocketEventType =
  | "room.created"
  | "room.status_changed"
  | "room.participant_joined"
  | "room.participant_left"
  | "round.created"
  | "round.started"
  | "round.closed"
  | "submission.created"
  | "submission.scored"
  | "participant.eliminated"
  | "job.queued"
  | "job.running"
  | "job.completed"
  | "job.failed"
  | "job.timed_out";

export type RoomWebSocketEvent =
  | {
      type: "room.created";
      seq: number;
      ts: string;
      room: RoomOut;
    }
  | {
      type: "room.status_changed";
      seq: number;
      ts: string;
      room_id: string;
      status: RoomStatus | string;
    }
  | {
      type: "room.participant_joined";
      seq: number;
      ts: string;
      participant: ParticipantOut;
    }
  | {
      type: "round.started";
      seq: number;
      ts: string;
      round: RoundOut;
    }
  | {
      type: "round.created";
      seq: number;
      ts: string;
      round: RoundOut;
    }
  | {
      type: "round.closed";
      seq: number;
      ts: string;
      round: RoundOut;
    }
  | {
      type: "submission.created";
      seq: number;
      ts: string;
      submission: SubmissionOut;
    }
  | {
      type: "job.queued";
      seq: number;
      ts: string;
      job: GenerationJobOut;
    }
  | {
      type: "job.running";
      seq: number;
      ts: string;
      job_id: string;
      submission_id: string;
      started_at?: string | null;
    }
  | {
      type: "job.completed";
      seq: number;
      ts: string;
      job_id: string;
      submission_id: string;
      output_text?: string | null;
      completed_at?: string | null;
    }
  | {
      type: "job.failed";
      seq: number;
      ts: string;
      job_id: string;
      submission_id: string;
      error_message?: string | null;
      retry_count: number;
      is_terminal: boolean;
    }
  | {
      type: "job.timed_out";
      seq: number;
      ts: string;
      job_id: string;
      submission_id: string;
      error_message?: string | null;
      completed_at?: string | null;
    }
  | {
      type: "submission.scored";
      seq: number;
      ts: string;
      submission_id: string;
      participant_id: string;
      score: number;
    }
  | {
      type: "participant.eliminated";
      seq: number;
      ts: string;
      participant_id: string;
      submission_id: string;
    };
