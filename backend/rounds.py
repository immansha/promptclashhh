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


def _room_id(db: Session, code: str) -> str | None:
    room = db.query(Room).filter(Room.code == code).first()
    return room.id if room else None


@router.post("/{code}/rounds", response_model=RoundOut, status_code=201)
async def create(
    code: str,
    payload: RoundCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Host creates a new round with a challenge text."""
    rnd = create_round(db, code, payload, user)
    if rid := _room_id(db, code):
        event_type, event_payload = events.round_created(rnd)
        await manager.broadcast(rid, event_type, event_payload)
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
    if rid := _room_id(db, code):
        et, ep = events.round_started(rnd)
        await manager.broadcast(rid, et, ep)
        # Also emit room status change so clients don't need to infer it.
        from ..models import Room as RoomModel
        room = db.query(RoomModel).filter(RoomModel.code == code).first()
        if room:
            et2, ep2 = events.room_status_changed(room)
            await manager.broadcast(rid, et2, ep2)
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
    if rid := _room_id(db, code):
        et, ep = events.round_closed(rnd)
        await manager.broadcast(rid, et, ep)
        from ..models import Room as RoomModel
        room = db.query(RoomModel).filter(RoomModel.code == code).first()
        if room:
            et2, ep2 = events.room_status_changed(room)
            await manager.broadcast(rid, et2, ep2)
    return rnd