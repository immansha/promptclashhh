from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from .models import Participant, Room, Round, User
from .schemas import RoundCreate, RoundOut


def _require_host(db: Session, room: Room, user: User) -> Participant:
    participant = (
        db.query(Participant)
        .filter(Participant.room_id == room.id, Participant.user_id == user.id)
        .first()
    )
    if not participant or not participant.is_host:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the host can perform this action.",
        )
    return participant


def _get_room_or_404(db: Session, code: str) -> Room:
    room = db.query(Room).filter(Room.code == code).first()
    if not room:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found.")
    return room


def _get_round_or_404(db: Session, round_id: str, room: Room) -> Round:
    rnd = db.query(Round).filter(Round.id == round_id, Round.room_id == room.id).first()
    if not rnd:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Round not found.")
    return rnd


def create_round(db: Session, code: str, payload: RoundCreate, user: User) -> RoundOut:
    """Host creates a new round with a challenge prompt."""
    room = _get_room_or_404(db, code)
    _require_host(db, room, user)

    if room.status == "finished":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot add rounds to a finished room.",
        )

    round_number = room.current_round + 1
    rnd = Round(
        room_id=room.id,
        round_number=round_number,
        challenge_text=payload.challenge_text,
        status="pending",
    )
    room.current_round = round_number
    db.add(rnd)
    db.commit()
    db.refresh(rnd)
    return RoundOut.model_validate(rnd)


def start_round(db: Session, code: str, round_id: str, user: User) -> RoundOut:
    """Host opens submissions for a round."""
    room = _get_room_or_404(db, code)
    _require_host(db, room, user)
    rnd = _get_round_or_404(db, round_id, room)

    if rnd.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Round is already '{rnd.status}'; can only start a pending round.",
        )

    rnd.status = "active"
    rnd.started_at = datetime.now(timezone.utc)
    room.status = "active"
    db.commit()
    db.refresh(rnd)
    return RoundOut.model_validate(rnd)


def close_round(db: Session, code: str, round_id: str, user: User) -> RoundOut:
    """Host closes submissions and moves the room into scoring state."""
    room = _get_room_or_404(db, code)
    _require_host(db, room, user)
    rnd = _get_round_or_404(db, round_id, room)

    if rnd.status != "active":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Can only close an active round.",
        )

    rnd.status = "closed"
    rnd.ended_at = datetime.now(timezone.utc)
    room.status = "scoring"
    db.commit()
    db.refresh(rnd)
    return RoundOut.model_validate(rnd)
