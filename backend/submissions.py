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


def _room_id_for_submission(db: Session, submission_id: str) -> str | None:
    sub = db.get(Submission, submission_id)
    if not sub:
        return None
    rnd = db.get(Round, sub.round_id)
    return rnd.room_id if rnd else None


def _room_id_for_round(db: Session, round_id: str) -> str | None:
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
    rid = _room_id_for_round(db, round_id)

    if rid:
        et, ep = events.submission_created(sub)
        await manager.broadcast(rid, et, ep)

        if sub.generation_job:
            et2, ep2 = events.job_queued(sub.generation_job)
            await manager.broadcast(rid, et2, ep2)

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
    if rid := _room_id_for_submission(db, submission_id):
        et, ep = events.submission_scored(sub)
        await manager.broadcast(rid, et, ep)
    return sub


@router.patch("/submissions/{submission_id}/eliminate", response_model=SubmissionOut)
async def eliminate(
    submission_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Host eliminates the participant who made a submission."""
    sub = eliminate_participant(db, submission_id, user)
    if rid := _room_id_for_submission(db, submission_id):
        et, ep = events.participant_eliminated(sub.participant_id, sub.id)
        await manager.broadcast(rid, et, ep)
    return sub


@router.get("/jobs/{job_id}", response_model=GenerationJobOut)
def get_job_status(
    job_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Fallback REST endpoint to poll job status on reconnect."""
    return get_job(db, job_id)