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


# ---------------------------------------------------------------------------
# REST endpoints
# ---------------------------------------------------------------------------

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
    Fetch full room state: participants + rounds.
    Primary rehydration endpoint — called on page load / reconnect.
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

    # Broadcast the join event so live clients update their participant lists.
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

# Custom close codes (4000–4999 are available for application use).
_WS_CLOSE_UNAUTHORIZED = 4403
_WS_CLOSE_NOT_FOUND    = 4404
_WS_CLOSE_ELIMINATED   = 4410


@router.websocket("/{code}/ws")
async def room_websocket(code: str, user_id: str, websocket: WebSocket):
    """
    Persistent WebSocket channel for a room.

    Connection URL:  ws://<host>/rooms/{code}/ws?user_id=<id>

    Auth
    ----
    user_id must exist in DB and the user must already be a participant
    (i.e. they called POST /rooms/{code}/join first).

    Message protocol (client → server)
    ------------------------------------
    { "type": "ping" }
      → server replies { "type": "pong", "seq": N, "ts": "..." }

    All other server→client messages follow the typed event schema in
    ws/events.py and carry { "type", "seq", "ts", ...payload }.

    Reconnect behaviour
    -------------------
    On reconnect the client should:
      1. Call GET /rooms/{code} to rehydrate all state.
      2. Re-open this WebSocket to resume receiving deltas.
    The seq field allows clients to detect gaps (missed events during downtime).

    Presence
    --------
    Connected user_ids are available via manager.get_presence(room_id).
    A participant_joined event is broadcast when the WS connects (if the
    user was not already present), and participant_left when they disconnect.
    """
    # ------------------------------------------------------------------
    # Auth + participant resolution (synchronous DB work before accept)
    # ------------------------------------------------------------------
    db: Session = SessionLocal()
    try:
        room = db.query(Room).filter(Room.code == code).first()
        if not room:
            await websocket.close(code=_WS_CLOSE_NOT_FOUND)
            return

        participant = (
            db.query(Participant)
            .filter(Participant.room_id == room.id, Participant.user_id == user_id)
            .first()
        )
        if not participant:
            await websocket.close(code=_WS_CLOSE_UNAUTHORIZED)
            return

        room_id       = room.id
        participant_id = participant.id
        is_eliminated  = participant.is_eliminated
    finally:
        db.close()

    # Eliminated participants may still observe but receive a status notice.
    # (Design choice: allow spectating, just block submissions server-side.)

    # ------------------------------------------------------------------
    # Accept and register connection
    # ------------------------------------------------------------------
    conn = await manager.connect(
        room_id=room_id,
        ws=websocket,
        user_id=user_id,
        participant_id=participant_id,
    )

    # Broadcast presence if this is the user's first connection in the room.
    already_present = sum(
        1 for uid in manager.get_presence(room_id) if uid == user_id
    )
    if already_present <= 1:  # only the connection we just added
        db2: Session = SessionLocal()
        try:
            p = db2.get(Participant, participant_id)
            if p:
                event_type, payload = events.participant_joined(p)
                await manager.broadcast(room_id, event_type, payload)
        finally:
            db2.close()

    # ------------------------------------------------------------------
    # Message loop
    # ------------------------------------------------------------------
    try:
        while True:
            try:
                data = await websocket.receive_json()
            except Exception:
                # Covers both WebSocketDisconnect and malformed JSON.
                break

            msg_type = data.get("type") if isinstance(data, dict) else None

            if msg_type == "ping":
                # Pong is sent directly (not via queue) to minimise latency.
                await websocket.send_json({"type": "pong"})

            # Future client→server messages (e.g. typing indicators) handled here.

    except WebSocketDisconnect:
        pass  # normal path
    finally:
        await manager.disconnect(conn)

        # Broadcast departure only if the user has no other open connections.
        remaining = [uid for uid in manager.get_presence(room_id) if uid == user_id]
        if not remaining:
            event_type, payload = events.participant_left(participant_id, room_id)
            await manager.broadcast(room_id, event_type, payload)

        logger.info("WS session ended: room=%s user=%s", code, user_id)