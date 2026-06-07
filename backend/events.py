"""
Typed event builders for every server→client WebSocket event.

Rules
-----
* Every public function returns a (event_type: str, payload: dict) tuple.
  The manager stamps seq + ts; builders must not include them.
* All datetime values are serialised to ISO-8601 strings by _dt().
* Payload keys are stable — the frontend can rely on their shape.
* No ORM objects escape this module; callers pass model instances and
  builders extract only the fields needed.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any


# ---------------------------------------------------------------------------
# Event type constants
# ---------------------------------------------------------------------------

# Room lifecycle
ROOM_CREATED            = "room.created"
ROOM_STATUS_CHANGED     = "room.status_changed"
ROOM_PARTICIPANT_JOINED = "room.participant_joined"
ROOM_PARTICIPANT_LEFT   = "room.participant_left"

# Round lifecycle
ROUND_CREATED   = "round.created"
ROUND_STARTED   = "round.started"
ROUND_CLOSED    = "round.closed"

# Submission lifecycle
SUBMISSION_CREATED = "submission.created"
SUBMISSION_SCORED  = "submission.scored"

# Participant status
PARTICIPANT_ELIMINATED = "participant.eliminated"

# Job lifecycle
JOB_QUEUED     = "job.queued"
JOB_RUNNING    = "job.running"
JOB_COMPLETED  = "job.completed"
JOB_FAILED     = "job.failed"
JOB_TIMED_OUT  = "job.timed_out"

# All event types as a set for validation / documentation
ALL_EVENT_TYPES: frozenset[str] = frozenset({
    ROOM_CREATED, ROOM_STATUS_CHANGED, ROOM_PARTICIPANT_JOINED, ROOM_PARTICIPANT_LEFT,
    ROUND_CREATED, ROUND_STARTED, ROUND_CLOSED,
    SUBMISSION_CREATED, SUBMISSION_SCORED,
    PARTICIPANT_ELIMINATED,
    JOB_QUEUED, JOB_RUNNING, JOB_COMPLETED, JOB_FAILED, JOB_TIMED_OUT,
})

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _dt(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _room_dict(room: Any) -> dict:
    return {
        "id":            room.id,
        "host_id":       room.host_id,
        "code":          room.code,
        "status":        room.status,
        "current_round": room.current_round,
        "created_at":    _dt(room.created_at),
    }


def _participant_dict(p: Any) -> dict:
    return {
        "id":            p.id,
        "room_id":       p.room_id,
        "user_id":       p.user_id,
        "is_host":       p.is_host,
        "is_eliminated": p.is_eliminated,
        "joined_at":     _dt(p.joined_at),
    }


def _round_dict(r: Any) -> dict:
    return {
        "id":             r.id,
        "room_id":        r.room_id,
        "round_number":   r.round_number,
        "challenge_text": r.challenge_text,
        "status":         r.status,
        "started_at":     _dt(r.started_at),
        "ended_at":       _dt(r.ended_at),
    }


def _submission_dict(s: Any) -> dict:
    return {
        "id":             s.id,
        "round_id":       s.round_id,
        "participant_id": s.participant_id,
        "prompt_text":    s.prompt_text,
        "score":          s.score,
        "is_eliminated":  s.is_eliminated,
        "submitted_at":   _dt(s.submitted_at),
    }


def _job_dict(j: Any) -> dict:
    return {
        "id":             j.id,
        "submission_id":  j.submission_id,
        "status":         j.status,
        "output_text":    j.output_text,
        "error_message":  j.error_message,
        "retry_count":    j.retry_count,
        "queued_at":      _dt(j.queued_at),
        "started_at":     _dt(j.started_at),
        "completed_at":   _dt(j.completed_at),
    }


# ---------------------------------------------------------------------------
# Public event builders  →  (event_type, payload)
# ---------------------------------------------------------------------------

def room_created(room: Any) -> tuple[str, dict]:
    return ROOM_CREATED, {"room": _room_dict(room)}


def room_status_changed(room: Any) -> tuple[str, dict]:
    return ROOM_STATUS_CHANGED, {
        "room_id": room.id,
        "status":  room.status,
    }


def participant_joined(participant: Any) -> tuple[str, dict]:
    return ROOM_PARTICIPANT_JOINED, {"participant": _participant_dict(participant)}


def participant_left(participant_id: str, room_id: str) -> tuple[str, dict]:
    return ROOM_PARTICIPANT_LEFT, {
        "participant_id": participant_id,
        "room_id":        room_id,
    }


def round_created(round_: Any) -> tuple[str, dict]:
    return ROUND_CREATED, {"round": _round_dict(round_)}


def round_started(round_: Any) -> tuple[str, dict]:
    return ROUND_STARTED, {"round": _round_dict(round_)}


def round_closed(round_: Any) -> tuple[str, dict]:
    return ROUND_CLOSED, {"round": _round_dict(round_)}


def submission_created(submission: Any) -> tuple[str, dict]:
    return SUBMISSION_CREATED, {"submission": _submission_dict(submission)}


def submission_scored(submission: Any) -> tuple[str, dict]:
    return SUBMISSION_SCORED, {
        "submission_id": submission.id,
        "participant_id": submission.participant_id,
        "score":         submission.score,
    }


def participant_eliminated(participant_id: str, submission_id: str) -> tuple[str, dict]:
    return PARTICIPANT_ELIMINATED, {
        "participant_id": participant_id,
        "submission_id":  submission_id,
    }


def job_queued(job: Any) -> tuple[str, dict]:
    return JOB_QUEUED, {"job": _job_dict(job)}


def job_running(job: Any) -> tuple[str, dict]:
    return JOB_RUNNING, {
        "job_id":        job.id,
        "submission_id": job.submission_id,
        "started_at":    _dt(job.started_at),
    }


def job_completed(job: Any) -> tuple[str, dict]:
    return JOB_COMPLETED, {
        "job_id":        job.id,
        "submission_id": job.submission_id,
        "output_text":   job.output_text,
        "completed_at":  _dt(job.completed_at),
    }


def job_failed(job: Any) -> tuple[str, dict]:
    return JOB_FAILED, {
        "job_id":          job.id,
        "submission_id":   job.submission_id,
        "error_message":   job.error_message,
        "retry_count":     job.retry_count,
        "is_terminal":     job.retry_count >= 2,  # matches MAX_RETRIES in job_runner
    }


def job_timed_out(job: Any) -> tuple[str, dict]:
    return JOB_TIMED_OUT, {
        "job_id":         job.id,
        "submission_id":  job.submission_id,
        "error_message":  job.error_message,
        "completed_at":   _dt(job.completed_at),
    }


# ---------------------------------------------------------------------------
# Compatibility shims — keep old call-sites working during migration
# ---------------------------------------------------------------------------

def participant_payload(p: Any) -> dict:
    """Legacy shim: returns raw payload dict (no event type)."""
    return {"participant": _participant_dict(p)}


def round_payload(r: Any) -> dict:
    return {"round": _round_dict(r)}


def submission_payload(s: Any) -> dict:
    return {"submission": _submission_dict(s)}


def job_payload(j: Any, output_text: str | None = None) -> dict:
    d = _job_dict(j)
    if output_text is not None:
        d["output_text"] = output_text
    return {
        "job_id":        j.id,
        "submission_id": j.submission_id,
        "status":        j.status,
        "output_text":   d["output_text"],
        "error_message": j.error_message,
        "retry_count":   j.retry_count,
    }