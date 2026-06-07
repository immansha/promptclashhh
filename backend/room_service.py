import random
import string

from fastapi import HTTPException, status
from sqlalchemy.orm import Session, selectinload

from .models import Participant, Room, Round, Submission, User
from .schemas import RoomDetailOut, RoomOut


def _generate_code(length: int = 8) -> str:
    chars = string.ascii_uppercase + string.digits
    return "CLASH-" + "".join(random.choices(chars, k=length - 6))


def create_room(db: Session, host: User) -> RoomOut:
    """Create a new room and add the host as the first participant."""
    code = _generate_code()
    # Ensure uniqueness (extremely unlikely collision, but guard it)
    while db.query(Room).filter(Room.code == code).first():
        code = _generate_code()

    room = Room(host_id=host.id, code=code)
    db.add(room)
    db.flush()  # populate room.id before creating participant

    host_participant = Participant(
        room_id=room.id,
        user_id=host.id,
        is_host=True,
    )
    db.add(host_participant)
    db.commit()
    db.refresh(room)
    return RoomOut.model_validate(room)


def join_room(db: Session, code: str, user: User) -> RoomDetailOut:
    """
    Join an existing room. Idempotent — returns the existing participant row
    if the user has already joined. Hosts cannot re-join as participants.
    """
    room = _get_room_or_404(db, code)

    if room.status == "finished":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Room has already finished.",
        )

    existing = (
        db.query(Participant)
        .filter(Participant.room_id == room.id, Participant.user_id == user.id)
        .first()
    )
    if not existing:
        participant = Participant(room_id=room.id, user_id=user.id, is_host=False)
        db.add(participant)
        db.commit()

    return get_room_detail(db, code)


def get_room_detail(db: Session, code: str) -> RoomDetailOut:
    """
    Return full room state with participants and rounds (for REST rehydration).
    """
    room = (
        db.query(Room)
        .options(
            selectinload(Room.participants).selectinload(Participant.user),
            selectinload(Room.rounds)
            .selectinload(Round.submissions)
            .selectinload(Submission.generation_job),
        )
        .filter(Room.code == code)
        .first()
    )
    if not room:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found.")
    return RoomDetailOut.model_validate(room)


def _get_room_or_404(db: Session, code: str) -> Room:
    room = db.query(Room).filter(Room.code == code).first()
    if not room:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found.")
    return room
