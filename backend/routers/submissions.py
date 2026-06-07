from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..dependencies import get_current_user
from ..models import Round, Submission, User
from ..schemas import GenerationJobOut, ScoreRequest, SubmissionCreate, SubmissionOut
from ..services import (
    create_submission,
    eliminate_participant,
    get_job,
    score_submission,
)
from ..ws.manager import manager
from ..ws import events

router = APIRouter(tags=["submissions"])


def _get_room_id_for_submission(db: Session, submission_id: str) -> str | None:
    sub = db.get(Submission, submission_id)
    if not sub:
        return None
    rnd = db.get(Round, sub.round_id)
    return rnd.room_id if rnd else None


def _get_room_id_for_round(db: Session, round_id: str) -> str | None:
    rnd = db.get(Round, round_id)
    return rnd.room_id if rnd else None


@router.post("/rounds/{round_id}/submissions", response_model=SubmissionOut, status_code=201)
async def submit(
    round_id: str,
    payload: SubmissionCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Participant submits a prompt for the active round.
    Creates a GenerationJob immediately and broadcasts both events.
    """
    sub = create_submission(db, round_id, payload, user)

    room_id = _get_room_id_for_round(db, round_id)
    if room_id:
        event_type, event_payload = events.submission_created(sub)
        await manager.broadcast(room_id, event_type, event_payload)
        if sub.generation_job:
            event_type, event_payload = events.job_queued(sub.generation_job)
            await manager.broadcast(room_id, event_type, event_payload)

    return sub


@router.patch("/submissions/{submission_id}/score", response_model=SubmissionOut)
async def score(
    submission_id: str,
    payload: ScoreRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Host assigns a score (0–10) to a submission."""
    sub = score_submission(db, submission_id, payload, user)

    room_id = _get_room_id_for_submission(db, submission_id)
    if room_id:
        event_type, event_payload = events.submission_scored(sub)
        await manager.broadcast(room_id, event_type, event_payload)

    return sub


@router.patch("/submissions/{submission_id}/eliminate", response_model=SubmissionOut)
async def eliminate(
    submission_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Host eliminates the participant who made a submission."""
    sub = eliminate_participant(db, submission_id, user)

    room_id = _get_room_id_for_submission(db, submission_id)
    if room_id:
        event_type, event_payload = events.participant_eliminated(sub.participant_id, sub.id)
        await manager.broadcast(room_id, event_type, event_payload)

    return sub


@router.get("/jobs/{job_id}", response_model=GenerationJobOut)
def get_job_status(
    job_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Fallback REST endpoint to poll job status.
    Clients should prefer WebSocket events; use this on reconnect.
    """
    return get_job(db, job_id)
