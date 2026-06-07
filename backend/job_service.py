"""
Job service — query, inspect, and maintain GenerationJob rows.

State reference
---------------
  queued     — waiting to be picked up by a worker
  running    — claimed by a worker; generation in progress
  completed  — generation succeeded; output_text is populated
  failed     — all retries exhausted or non-retryable error
  timed_out  — generation exceeded the configured timeout; terminal
"""

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .models import GenerationJob
from .schemas import GenerationJobOut

# Terminal statuses — jobs in these states are never touched again.
TERMINAL_STATUSES = frozenset({"completed", "failed", "timed_out"})


def get_job(db: Session, job_id: str) -> GenerationJobOut:
    """Return a single job by ID, or 404."""
    job = db.get(GenerationJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    return GenerationJobOut.model_validate(job)


def get_jobs_for_submission(db: Session, submission_id: str) -> GenerationJobOut | None:
    """Return the job attached to a submission, or None."""
    job = (
        db.query(GenerationJob)
        .filter(GenerationJob.submission_id == submission_id)
        .first()
    )
    return GenerationJobOut.model_validate(job) if job else None


def reset_stale_jobs(db: Session) -> int:
    """
    On server startup, any job left in `running` was interrupted by a crash.
    Reset them to `queued` so a worker picks them up again.

    Jobs in `timed_out` or `failed` are terminal and are left untouched.

    Returns:
        Number of jobs reset.
    """
    stale = (
        db.query(GenerationJob)
        .filter(GenerationJob.status == "running")
        .all()
    )
    for job in stale:
        job.status = "queued"
        job.started_at = None
        # Preserve error_message if one was set before the crash.

    db.commit()

    if stale:
        import logging
        logging.getLogger(__name__).info(
            "Reset %d stale running job(s) to 'queued' on startup.", len(stale)
        )

    return len(stale)


def queue_stats(db: Session) -> dict[str, int]:
    """Return a count of jobs per status — useful for health/monitoring endpoints."""
    from sqlalchemy import func
    rows = (
        db.query(GenerationJob.status, func.count(GenerationJob.id))
        .group_by(GenerationJob.status)
        .all()
    )
    return {status: count for status, count in rows}
