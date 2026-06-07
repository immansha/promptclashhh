from fastapi import HTTPException, status
from sqlalchemy.orm import Session, selectinload

from .models import GenerationJob, Participant, Room, Round, Submission, User
from .schemas import ScoreRequest, SubmissionCreate, SubmissionOut


def _get_room_or_404(db: Session, code: str) -> Room:
    room = db.query(Room).filter(Room.code == code).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found.")
    return room


def _get_round_or_404(db: Session, round_id: str) -> Round:
    rnd = db.get(Round, round_id)
    if not rnd:
        raise HTTPException(status_code=404, detail="Round not found.")
    return rnd


def _get_submission_or_404(db: Session, submission_id: str) -> Submission:
    sub = (
        db.query(Submission)
        .options(selectinload(Submission.generation_job))
        .filter(Submission.id == submission_id)
        .first()
    )
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found.")
    return sub


def _get_participant(db: Session, room_id: str, user_id: str) -> Participant | None:
    return (
        db.query(Participant)
        .filter(Participant.room_id == room_id, Participant.user_id == user_id)
        .first()
    )


def create_submission(
    db: Session, round_id: str, payload: SubmissionCreate, user: User
) -> SubmissionOut:
    """
    Participant submits a prompt for the active round.
    Hosts and eliminated participants cannot submit.
    Creates a GenerationJob immediately.
    """
    rnd = _get_round_or_404(db, round_id)

    if rnd.status != "active":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Submissions are only accepted for active rounds.",
        )

    participant = _get_participant(db, rnd.room_id, user.id)
    if not participant:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a participant in this room.",
        )
    if participant.is_host:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="The host cannot submit prompts.",
        )
    if participant.is_eliminated:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Eliminated participants cannot submit.",
        )

    # One submission per participant per round
    existing = (
        db.query(Submission)
        .filter(
            Submission.round_id == round_id,
            Submission.participant_id == participant.id,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You have already submitted for this round.",
        )

    submission = Submission(
        round_id=round_id,
        participant_id=participant.id,
        prompt_text=payload.prompt_text,
    )
    db.add(submission)
    db.flush()  # populate submission.id

    job = GenerationJob(submission_id=submission.id, status="queued")
    db.add(job)
    db.commit()
    db.refresh(submission)

    return _load_submission_out(db, submission.id)


def score_submission(
    db: Session, submission_id: str, payload: ScoreRequest, user: User
) -> SubmissionOut:
    """Host assigns a numeric score (0–10) to a submission."""
    if not (0 <= payload.score <= 10):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Score must be between 0 and 10.",
        )

    sub = _get_submission_or_404(db, submission_id)
    rnd = _get_round_or_404(db, sub.round_id)

    _require_host(db, rnd.room_id, user)

    sub.score = payload.score
    db.commit()
    db.refresh(sub)
    return _load_submission_out(db, sub.id)


def eliminate_participant(
    db: Session, submission_id: str, user: User
) -> SubmissionOut:
    """
    Host eliminates the participant who made a given submission.
    Sets is_eliminated on both the Submission and the Participant row.
    """
    sub = _get_submission_or_404(db, submission_id)
    rnd = _get_round_or_404(db, sub.round_id)

    _require_host(db, rnd.room_id, user)

    sub.is_eliminated = True

    participant = db.get(Participant, sub.participant_id)
    if participant:
        participant.is_eliminated = True

    db.commit()
    db.refresh(sub)
    return _load_submission_out(db, sub.id)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _require_host(db: Session, room_id: str, user: User) -> Participant:
    participant = _get_participant(db, room_id, user.id)
    if not participant or not participant.is_host:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the host can perform this action.",
        )
    return participant


def _load_submission_out(db: Session, submission_id: str) -> SubmissionOut:
    sub = (
        db.query(Submission)
        .options(selectinload(Submission.generation_job))
        .filter(Submission.id == submission_id)
        .first()
    )
    return SubmissionOut.model_validate(sub)
