from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, EmailStr


# ---------------------------------------------------------------------------
# Shared config
# ---------------------------------------------------------------------------

class _ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# User / Identity
# ---------------------------------------------------------------------------

class IdentityRequest(BaseModel):
    name: str
    email: EmailStr


class UserOut(_ORM):
    id: str
    name: str
    email: str
    created_at: datetime


class UserSummaryOut(_ORM):
    id: str
    name: str
    email: str


class IdentityResponse(BaseModel):
    user_id: str
    name: str
    email: str
    created: bool  # True if newly created, False if existing


# ---------------------------------------------------------------------------
# Room
# ---------------------------------------------------------------------------

class RoomCreate(BaseModel):
    # host user_id comes from the X-User-Id header, not body
    pass


class RoomOut(_ORM):
    id: str
    host_id: str
    code: str
    status: str
    current_round: int
    created_at: datetime


class RoomDetailOut(RoomOut):
    participants: list[ParticipantOut] = []
    rounds: list[RoundDetailOut] = []


# ---------------------------------------------------------------------------
# Participant
# ---------------------------------------------------------------------------

class ParticipantOut(_ORM):
    id: str
    room_id: str
    user_id: str
    is_host: bool
    is_eliminated: bool
    joined_at: datetime
    user: Optional[UserSummaryOut] = None


# ---------------------------------------------------------------------------
# Round
# ---------------------------------------------------------------------------

class RoundCreate(BaseModel):
    challenge_text: str


class RoundOut(_ORM):
    id: str
    room_id: str
    round_number: int
    challenge_text: str
    status: str
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None


class RoundDetailOut(RoundOut):
    submissions: list[SubmissionOut] = []


# ---------------------------------------------------------------------------
# Submission
# ---------------------------------------------------------------------------

class SubmissionCreate(BaseModel):
    prompt_text: str


class ScoreRequest(BaseModel):
    score: int  # 0–10


class SubmissionOut(_ORM):
    id: str
    round_id: str
    participant_id: str
    prompt_text: str
    score: Optional[int] = None
    is_eliminated: bool
    submitted_at: datetime
    generation_job: Optional[GenerationJobOut] = None


# ---------------------------------------------------------------------------
# GenerationJob
# ---------------------------------------------------------------------------

class GenerationJobOut(_ORM):
    id: str
    submission_id: str
    status: str
    output_text: Optional[str] = None
    error_message: Optional[str] = None
    retry_count: int
    queued_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


# ---------------------------------------------------------------------------
# Forward references resolved
# ---------------------------------------------------------------------------

RoomDetailOut.model_rebuild()
RoundDetailOut.model_rebuild()
SubmissionOut.model_rebuild()
