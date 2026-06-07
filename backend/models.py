import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uuid() -> str:
    return str(uuid.uuid4())


# ---------------------------------------------------------------------------
# User
# ---------------------------------------------------------------------------

class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String, nullable=False)
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    hosted_rooms: Mapped[list["Room"]] = relationship("Room", back_populates="host")
    participations: Mapped[list["Participant"]] = relationship(
        "Participant", back_populates="user"
    )


# ---------------------------------------------------------------------------
# Room
# ---------------------------------------------------------------------------

class Room(Base):
    __tablename__ = "rooms"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    host_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    code: Mapped[str] = mapped_column(String(12), unique=True, nullable=False, index=True)
    # waiting | active | scoring | finished
    status: Mapped[str] = mapped_column(String, default="waiting", nullable=False)
    current_round: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    host: Mapped["User"] = relationship("User", back_populates="hosted_rooms")
    participants: Mapped[list["Participant"]] = relationship(
        "Participant", back_populates="room", cascade="all, delete-orphan"
    )
    rounds: Mapped[list["Round"]] = relationship(
        "Round", back_populates="room", cascade="all, delete-orphan",
        order_by="Round.round_number",
    )


# ---------------------------------------------------------------------------
# Participant
# ---------------------------------------------------------------------------

class Participant(Base):
    __tablename__ = "participants"
    __table_args__ = (UniqueConstraint("room_id", "user_id"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    room_id: Mapped[str] = mapped_column(ForeignKey("rooms.id"), nullable=False)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    is_host: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_eliminated: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    room: Mapped["Room"] = relationship("Room", back_populates="participants")
    user: Mapped["User"] = relationship("User", back_populates="participations")
    submissions: Mapped[list["Submission"]] = relationship(
        "Submission", back_populates="participant"
    )


# ---------------------------------------------------------------------------
# Round
# ---------------------------------------------------------------------------

class Round(Base):
    __tablename__ = "rounds"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    room_id: Mapped[str] = mapped_column(ForeignKey("rooms.id"), nullable=False)
    round_number: Mapped[int] = mapped_column(Integer, nullable=False)
    challenge_text: Mapped[str] = mapped_column(Text, nullable=False)
    # pending | active | closed
    status: Mapped[str] = mapped_column(String, default="pending", nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    room: Mapped["Room"] = relationship("Room", back_populates="rounds")
    submissions: Mapped[list["Submission"]] = relationship(
        "Submission", back_populates="round", cascade="all, delete-orphan"
    )


# ---------------------------------------------------------------------------
# Submission
# ---------------------------------------------------------------------------

class Submission(Base):
    __tablename__ = "submissions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    round_id: Mapped[str] = mapped_column(ForeignKey("rounds.id"), nullable=False)
    participant_id: Mapped[str] = mapped_column(ForeignKey("participants.id"), nullable=False)
    prompt_text: Mapped[str] = mapped_column(Text, nullable=False)
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_eliminated: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    round: Mapped["Round"] = relationship("Round", back_populates="submissions")
    participant: Mapped["Participant"] = relationship(
        "Participant", back_populates="submissions"
    )
    generation_job: Mapped["GenerationJob | None"] = relationship(
        "GenerationJob", back_populates="submission", uselist=False
    )


# ---------------------------------------------------------------------------
# GenerationJob
# ---------------------------------------------------------------------------

class GenerationJob(Base):
    __tablename__ = "generation_jobs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    submission_id: Mapped[str] = mapped_column(
        ForeignKey("submissions.id"), unique=True, nullable=False
    )
    # queued | running | completed | failed
    status: Mapped[str] = mapped_column(String, default="queued", nullable=False)
    output_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    retry_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    queued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    submission: Mapped["Submission"] = relationship(
        "Submission", back_populates="generation_job"
    )


# ---------------------------------------------------------------------------
# RoomEvent  (append-only event log; useful for debugging / replay)
# ---------------------------------------------------------------------------

class RoomEvent(Base):
    __tablename__ = "room_events"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    room_id: Mapped[str] = mapped_column(ForeignKey("rooms.id"), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String, nullable=False)
    payload: Mapped[str] = mapped_column(Text, nullable=False)  # JSON string
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
