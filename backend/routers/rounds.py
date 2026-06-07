from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..dependencies import get_current_user
from ..models import Room, User
from ..schemas import RoundCreate, RoundOut
from ..services import close_round, create_round, start_round
from ..ws.manager import manager
from ..ws import events

router = APIRouter(prefix="/rooms", tags=["rounds"])


def _get_room_id(db: Session, code: str) -> str | None:
    room = db.query(Room).filter(Room.code == code).first()
    return room.id if room else None


def _get_room(db: Session, code: str) -> Room | None:
    return db.query(Room).filter(Room.code == code).first()


@router.post("/{code}/rounds", response_model=RoundOut, status_code=201)
async def create(
    code: str,
    payload: RoundCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Host creates a new round with a challenge text."""
    rnd = create_round(db, code, payload, user)
    room_id = _get_room_id(db, code)
    if room_id:
        event_type, payload = events.round_created(rnd)
        await manager.broadcast(room_id, event_type, payload)
    return rnd


@router.patch("/{code}/rounds/{round_id}/start", response_model=RoundOut)
async def start(
    code: str,
    round_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Host opens submissions for the round."""
    rnd = start_round(db, code, round_id, user)
    room_id = _get_room_id(db, code)
    if room_id:
        event_type, payload = events.round_started(rnd)
        await manager.broadcast(room_id, event_type, payload)
        room = _get_room(db, code)
        if room:
            event_type, payload = events.room_status_changed(room)
            await manager.broadcast(room_id, event_type, payload)
    return rnd


@router.patch("/{code}/rounds/{round_id}/close", response_model=RoundOut)
async def close(
    code: str,
    round_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Host closes submissions and moves the room into scoring state."""
    rnd = close_round(db, code, round_id, user)
    room_id = _get_room_id(db, code)
    if room_id:
        event_type, payload = events.round_closed(rnd)
        await manager.broadcast(room_id, event_type, payload)
        room = _get_room(db, code)
        if room:
            event_type, payload = events.room_status_changed(room)
            await manager.broadcast(room_id, event_type, payload)
    return rnd
