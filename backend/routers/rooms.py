import logging

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from ..database import get_db, SessionLocal
from ..dependencies import get_current_user
from ..models import Participant, Room, User
from ..schemas import RoomDetailOut, RoomOut
from ..services import create_room, get_room_detail, join_room
from ..ws.manager import manager
from ..ws import events

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/rooms", tags=["rooms"])


@router.post("", response_model=RoomOut, status_code=201)
def create(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Create a room. Caller becomes the host."""
    return create_room(db, user)


@router.get("/{code}", response_model=RoomDetailOut)
def get_room(
    code: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Fetch full room state: participants, rounds.
    Used by the frontend to rehydrate state after a page refresh.
    """
    return get_room_detail(db, code)


@router.post("/{code}/join", response_model=RoomDetailOut)
async def join(
    code: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Join a room as a participant. Idempotent."""
    detail = join_room(db, code, user)

    # Broadcast the join event so live clients update their participant lists
    room = db.query(Room).filter(Room.code == code).first()
    if room:
        participant = (
            db.query(Participant)
            .filter(Participant.room_id == room.id, Participant.user_id == user.id)
            .first()
        )
        if participant:
            event_type, payload = events.participant_joined(participant)
            await manager.broadcast(room.id, event_type, payload)

    return detail


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------

@router.websocket("/{code}/ws")
async def room_websocket(code: str, user_id: str, websocket: WebSocket):
    """
    Persistent WebSocket connection for a room.
    Query param: ?user_id=<id>

    On connect, verifies the user exists and is a participant.
    Closes with 4403 if not authorised.
    """
    db: Session = SessionLocal()
    try:
        room = db.query(Room).filter(Room.code == code).first()
        if not room:
            await websocket.close(code=4404)
            return

        participant = (
            db.query(Participant)
            .filter(Participant.room_id == room.id, Participant.user_id == user_id)
            .first()
        )
        if not participant:
            await websocket.close(code=4403)
            return

        room_id = room.id
        participant_id = participant.id
    finally:
        db.close()

    conn = await manager.connect(
        room_id=room_id,
        ws=websocket,
        user_id=user_id,
        participant_id=participant_id,
    )
    try:
        while True:
            data = await websocket.receive_json()
            if data.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        await manager.disconnect(conn)
        logger.info("WS disconnected: room=%s user=%s", code, user_id)
