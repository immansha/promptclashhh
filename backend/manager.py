"""
ConnectionManager — room-scoped WebSocket fan-out.

Design goals
------------
* Room-scoped channels: each WebSocket is registered under its room_id.
* Per-connection send queues: a dedicated asyncio.Queue per socket prevents
  one slow client from blocking broadcasts to others (head-of-line blocking).
* Sequence numbers: every event carries a monotonically increasing seq for
  the room so reconnecting clients can detect missed events.
* Presence metadata: the manager tracks user_id + participant_id per socket,
  enabling targeted sends and presence queries.
* Graceful disconnect: dead sockets are pruned during broadcast; they never
  raise inside the caller's hot path.
* Reconnect-safe: seq is scoped to the manager lifetime (process). On a cold
  restart clients call GET /rooms/{code} to rehydrate, then resume via WS.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone

from fastapi import WebSocket
from starlette.websockets import WebSocketState

logger = logging.getLogger(__name__)

# Maximum events buffered per connection before the queue is considered
# stalled and the connection is force-closed.
_SEND_QUEUE_MAX = 256

# Seconds to wait for a queued send to drain before declaring the socket dead.
_SEND_DRAIN_TIMEOUT = 5.0


@dataclass
class Connection:
    """Metadata + send queue for a single WebSocket."""

    ws: WebSocket
    user_id: str
    participant_id: str
    room_id: str
    connected_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    _queue: asyncio.Queue[str | None] = field(default_factory=lambda: asyncio.Queue(_SEND_QUEUE_MAX))
    _sender_task: asyncio.Task | None = field(default=None, init=False)

    # ------------------------------------------------------------------
    # Internal sender coroutine — drains _queue into the WebSocket.
    # Receiving None is the shutdown sentinel.
    # ------------------------------------------------------------------

    async def _run_sender(self) -> None:
        while True:
            try:
                message = await self._queue.get()
            except asyncio.CancelledError:
                break
            if message is None:  # shutdown sentinel
                break
            try:
                if self.ws.client_state == WebSocketState.CONNECTED:
                    await self.ws.send_text(message)
            except Exception as exc:
                logger.debug("Send failed on %s: %s", self.ws.client, exc)
                break  # sender exits; manager will prune on next broadcast

    def start(self) -> None:
        self._sender_task = asyncio.create_task(
            self._run_sender(), name=f"ws-sender-{self.user_id}"
        )

    async def enqueue(self, message: str) -> bool:
        """
        Non-blocking enqueue. Returns False if the queue is full (connection
        is stalled) so the manager can close and prune it.
        """
        try:
            self._queue.put_nowait(message)
            return True
        except asyncio.QueueFull:
            logger.warning(
                "Send queue full for user=%s room=%s — closing stalled connection.",
                self.user_id,
                self.room_id,
            )
            return False

    async def close(self) -> None:
        """Signal the sender to stop and close the WebSocket."""
        try:
            self._queue.put_nowait(None)  # sentinel
        except asyncio.QueueFull:
            pass
        if self._sender_task:
            self._sender_task.cancel()
            try:
                await asyncio.wait_for(self._sender_task, timeout=_SEND_DRAIN_TIMEOUT)
            except (asyncio.CancelledError, asyncio.TimeoutError):
                pass
        try:
            if self.ws.client_state == WebSocketState.CONNECTED:
                await self.ws.close()
        except Exception:
            pass


class ConnectionManager:
    """
    Central hub for room-scoped WebSocket connections.

    Public interface
    ----------------
    connect(room_id, ws, user_id, participant_id)   -> Connection
    disconnect(conn)
    broadcast(room_id, event_type, payload)          -> int  (recipients)
    send_to_user(room_id, user_id, event_type, payload)
    get_presence(room_id)                            -> list[str]  (user_ids)
    connection_count(room_id)                        -> int
    """

    def __init__(self) -> None:
        # room_id → list of Connection objects
        self._rooms: dict[str, list[Connection]] = defaultdict(list)
        # room_id → monotonic sequence counter
        self._seq: dict[str, int] = defaultdict(int)

    # ------------------------------------------------------------------
    # Connection lifecycle
    # ------------------------------------------------------------------

    async def connect(
        self,
        room_id: str,
        ws: WebSocket,
        user_id: str,
        participant_id: str,
    ) -> Connection:
        await ws.accept()
        conn = Connection(
            ws=ws,
            user_id=user_id,
            participant_id=participant_id,
            room_id=room_id,
        )
        conn.start()
        self._rooms[room_id].append(conn)
        logger.info(
            "WS connected: room=%s user=%s total=%d",
            room_id,
            user_id,
            len(self._rooms[room_id]),
        )
        return conn

    async def disconnect(self, conn: Connection) -> None:
        room_id = conn.room_id
        await conn.close()
        connections = self._rooms.get(room_id, [])
        try:
            connections.remove(conn)
        except ValueError:
            pass
        if not connections:
            self._rooms.pop(room_id, None)
        logger.info(
            "WS disconnected: room=%s user=%s remaining=%d",
            room_id,
            conn.user_id,
            len(self._rooms.get(room_id, [])),
        )

    # ------------------------------------------------------------------
    # Broadcasting
    # ------------------------------------------------------------------

    def _next_seq(self, room_id: str) -> int:
        self._seq[room_id] += 1
        return self._seq[room_id]

    def _build_message(self, room_id: str, event_type: str, payload: dict) -> str:
        envelope = {
            "type": event_type,
            "seq": self._next_seq(room_id),
            "ts": datetime.now(timezone.utc).isoformat(),
            **payload,
        }
        return json.dumps(envelope, default=str)

    async def broadcast(self, room_id: str, event_type: str, payload: dict) -> int:
        """
        Broadcast an event to every connection in the room.

        Returns the number of connections successfully enqueued.
        Stalled connections (full queue) are closed and pruned inline.
        """
        connections = self._rooms.get(room_id)
        if not connections:
            return 0

        message = self._build_message(room_id, event_type, payload)
        stalled: list[Connection] = []

        for conn in list(connections):
            ok = await conn.enqueue(message)
            if not ok:
                stalled.append(conn)

        for conn in stalled:
            await self.disconnect(conn)

        recipients = len(connections) - len(stalled)
        logger.debug("Broadcast %s → room=%s recipients=%d", event_type, room_id, recipients)
        return recipients

    async def send_to_user(
        self, room_id: str, user_id: str, event_type: str, payload: dict
    ) -> bool:
        """
        Send an event to a specific user's connection(s) within a room.
        Returns True if at least one connection was reached.
        """
        connections = self._rooms.get(room_id, [])
        message = self._build_message(room_id, event_type, payload)
        sent = False

        for conn in list(connections):
            if conn.user_id == user_id:
                ok = await conn.enqueue(message)
                if ok:
                    sent = True
                else:
                    await self.disconnect(conn)

        return sent

    # ------------------------------------------------------------------
    # Presence & diagnostics
    # ------------------------------------------------------------------

    def get_presence(self, room_id: str) -> list[str]:
        """Return the list of user_ids currently connected to a room."""
        return [c.user_id for c in self._rooms.get(room_id, [])]

    def connection_count(self, room_id: str) -> int:
        return len(self._rooms.get(room_id, []))

    def all_room_ids(self) -> list[str]:
        return list(self._rooms.keys())


# Singleton used throughout the application.
manager = ConnectionManager()