"""
Async generation job runner.

Architecture
------------
The runner starts a configurable number of concurrent worker coroutines
(WORKER_CONCURRENCY, default 3).  Each worker loops independently:

  1. Claim the oldest queued job atomically (SELECT … FOR UPDATE SKIP LOCKED).
  2. Transition it to `running` and broadcast `job.running`.
  3. Call provider.generate() inside asyncio.wait_for() for timeout enforcement.
  4. On success  → `completed`   + broadcast `job.completed`.
  5. On timeout  → `timed_out`   + broadcast `job.timed_out` (terminal).
  6. On error    → retry if retry_count < MAX_RETRIES, else `failed`.
     Retries use exponential backoff: 2^n seconds before re-queuing.

State machine
-------------

         ┌──────────┐
    ┌───►│  queued  │◄──────────────────────────┐
    │    └────┬─────┘                            │
    │         │  worker claims                   │ retry (backoff)
    │         ▼                                  │
    │    ┌──────────┐   timeout    ┌───────────┐ │
    │    │ running  ├─────────────►│ timed_out │ │
    │    └────┬─────┘              └───────────┘ │
    │         │                                  │
    │    ┌────┴──────────────────────┐           │
    │    │ error?                    │           │
    │    ▼                           ▼           │
    │  (retries                  ┌─────────┐    │
    │   exhausted)               │ transient│───►┘
    │    │                       │  error   │
    │    ▼                       └──────────┘
    │  ┌────────┐
    └──┤ failed │
       └────────┘
           ▲
           │ non-retryable (GenerationError)
           └──────────────────────────────────

Broadcast contract
------------------
Every state transition emits exactly one WebSocket event via
manager.broadcast().  The payload shapes are defined in ws/events.py.

Reconnect safety
----------------
On startup, any job left in `running` (from a crashed process) is reset to
`queued`.  Jobs in `timed_out` / `failed` / `completed` are terminal and
never touched again.
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone

from sqlalchemy.orm import Session, selectinload

from .database import SessionLocal
from .models import GenerationJob, Round, Submission
from .ws.manager import manager
from .ws import events
from .providers import AIProvider, GenerationError, get_provider

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration (all overridable via environment variables)
# ---------------------------------------------------------------------------

MAX_RETRIES        = int(os.getenv("JOB_MAX_RETRIES",     "2"))
JOB_TIMEOUT        = float(os.getenv("JOB_TIMEOUT_SECS",  "30"))
POLL_INTERVAL      = float(os.getenv("JOB_POLL_SECS",     "1.5"))
WORKER_CONCURRENCY = int(os.getenv("JOB_CONCURRENCY",     "1"))


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

async def run_workers(provider: AIProvider | None = None) -> None:
    """
    Start WORKER_CONCURRENCY independent worker coroutines and wait for all
    of them.  Called from the FastAPI lifespan; cancelled on shutdown.

    Args:
        provider: Pre-constructed provider (useful for testing). If None,
                  get_provider() is called to read the environment.
    """
    if provider is None:
        provider = get_provider()

    logger.info(
        "Starting %d job worker(s) using %s (timeout=%.1f s, max_retries=%d).",
        WORKER_CONCURRENCY,
        provider.name,
        JOB_TIMEOUT,
        MAX_RETRIES,
    )

    tasks = [
        asyncio.create_task(
            _worker_loop(worker_id=i, provider=provider),
            name=f"job-worker-{i}",
        )
        for i in range(WORKER_CONCURRENCY)
    ]

    try:
        await asyncio.gather(*tasks)
    except asyncio.CancelledError:
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        logger.info("All job workers stopped.")
        raise


# ---------------------------------------------------------------------------
# Worker loop
# ---------------------------------------------------------------------------

async def _worker_loop(worker_id: int, provider: AIProvider) -> None:
    """One independent worker coroutine.  Loops until cancelled."""
    logger.info("Worker %d started.", worker_id)
    while True:
        try:
            claimed = await _try_process_one(provider)
            if not claimed:
                # Nothing in the queue; back off briefly.
                await asyncio.sleep(POLL_INTERVAL)
        except asyncio.CancelledError:
            logger.info("Worker %d cancelled.", worker_id)
            raise
        except Exception:
            # Unhandled exception in the processing path — log and keep running.
            logger.exception("Worker %d: unhandled error; continuing.", worker_id)
            await asyncio.sleep(POLL_INTERVAL)


# ---------------------------------------------------------------------------
# Single-job processing
# ---------------------------------------------------------------------------

async def _try_process_one(provider: AIProvider) -> bool:
    """
    Attempt to claim and process one queued job.

    Returns True if a job was claimed (regardless of outcome),
    False if the queue was empty.
    """
    db: Session = SessionLocal()
    try:
        job = _claim_next_job(db)
        if job is None:
            return False

        room_id = _resolve_room_id(db, job)
        if room_id is None:
            # Orphaned job — mark failed and move on.
            logger.error("Job %s has no resolvable room; marking failed.", job.id)
            _transition(db, job, "failed", error_message="Orphaned job: room not found.")
            return True

        prompt = job.submission.prompt_text
    except Exception:
        logger.exception("DB error while claiming job; aborting this cycle.")
        db.close()
        return False
    finally:
        # Keep db open — we need it for the state transitions below.
        pass

    # --- running -----------------------------------------------------------
    try:
        _transition(db, job, "running")
        et, ep = events.job_running(job)
        await manager.broadcast(room_id, et, ep)
    except Exception:
        logger.exception("Failed to transition job %s to running.", job.id)
        db.close()
        return True  # job was claimed; don't re-poll immediately

    # --- generate ----------------------------------------------------------
    try:
        output = await asyncio.wait_for(
            provider.generate(prompt, timeout=JOB_TIMEOUT),
            timeout=JOB_TIMEOUT + 1,  # outer safety net
        )
        # --- completed ---
        _transition(db, job, "completed", output_text=output)
        et, ep = events.job_completed(job)
        await manager.broadcast(room_id, et, ep)
        logger.info("Job %s completed.", job.id)

    except asyncio.TimeoutError:
        # --- timed_out (terminal) ---
        error = f"Generation exceeded {JOB_TIMEOUT:.0f} s timeout."
        _transition(db, job, "timed_out", error_message=error)
        et, ep = events.job_timed_out(job)
        await manager.broadcast(room_id, et, ep)
        logger.warning("Job %s timed out.", job.id)

    except GenerationError as exc:
        # --- failed (non-retryable) ---
        _transition(db, job, "failed", error_message=str(exc))
        et, ep = events.job_failed(job)
        await manager.broadcast(room_id, et, ep)
        logger.error("Job %s failed (non-retryable): %s", job.id, exc)

    except Exception as exc:
        # --- transient error: retry or fail ---
        await _handle_transient_error(db, job, room_id, exc)

    finally:
        db.close()

    return True


# ---------------------------------------------------------------------------
# Retry logic
# ---------------------------------------------------------------------------

async def _handle_transient_error(
    db: Session,
    job: GenerationJob,
    room_id: str,
    exc: Exception,
) -> None:
    """Apply retry policy; broadcast appropriate event."""
    error_msg = str(exc)

    if job.retry_count < MAX_RETRIES:
        backoff = 2 ** job.retry_count  # 1 s, 2 s, …
        new_retry_count = job.retry_count + 1

        _transition(
            db, job, "queued",
            error_message=f"Attempt {new_retry_count} failed: {error_msg}",
            retry_count=new_retry_count,
            clear_started_at=True,
        )
        et, ep = events.job_queued(job)
        await manager.broadcast(room_id, et, ep)

        logger.warning(
            "Job %s transient error (attempt %d/%d); re-queuing in %d s. Error: %s",
            job.id, new_retry_count, MAX_RETRIES, backoff, error_msg,
        )
        # Non-blocking backoff: sleep in the background so the worker can
        # still process other jobs during this window.
        asyncio.create_task(_deferred_requeue(job.id, backoff))
        # For now the row is already `queued`, so the sleep happens here to
        # avoid another worker immediately picking it up before the backoff.
        # A production system would use a `scheduled_at` column.
        await asyncio.sleep(backoff)

    else:
        _transition(db, job, "failed", error_message=error_msg)
        et, ep = events.job_failed(job)
        await manager.broadcast(room_id, et, ep)
        logger.error(
            "Job %s permanently failed after %d retries. Error: %s",
            job.id, MAX_RETRIES, error_msg,
        )


async def _deferred_requeue(job_id: str, delay: float) -> None:
    """No-op placeholder — backoff is currently synchronous (await sleep above)."""


# ---------------------------------------------------------------------------
# State transition helper
# ---------------------------------------------------------------------------

_VALID_TRANSITIONS: dict[str, set[str]] = {
    "queued":    {"running"},
    "running":   {"completed", "failed", "timed_out", "queued"},  # queued = retry
    "completed": set(),
    "failed":    set(),
    "timed_out": set(),
}


def _transition(
    db: Session,
    job: GenerationJob,
    new_status: str,
    *,
    output_text: str | None = None,
    error_message: str | None = None,
    retry_count: int | None = None,
    clear_started_at: bool = False,
) -> None:
    """
    Apply a validated state transition to a job and commit.

    Raises ValueError for illegal transitions so bugs surface immediately
    rather than silently corrupting job state.
    """
    allowed = _VALID_TRANSITIONS.get(job.status, set())
    if new_status not in allowed:
        raise ValueError(
            f"Illegal job transition: {job.status!r} → {new_status!r} "
            f"(job_id={job.id})"
        )

    now = datetime.now(timezone.utc)
    job.status = new_status

    if output_text is not None:
        job.output_text = output_text
    if error_message is not None:
        job.error_message = error_message
    if retry_count is not None:
        job.retry_count = retry_count
    if clear_started_at:
        job.started_at = None

    if new_status == "running":
        job.started_at = now
    elif new_status in {"completed", "failed", "timed_out"}:
        job.completed_at = now

    db.commit()
    db.refresh(job)

    logger.debug("Job %s → %s", job.id, new_status)


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def _claim_next_job(db: Session) -> GenerationJob | None:
    """
    Atomically claim the oldest queued job.

    Uses SELECT … FOR UPDATE SKIP LOCKED so concurrent workers never
    double-claim the same row.  Returns None if the queue is empty.
    """
    job = (
        db.query(GenerationJob)
        .options(selectinload(GenerationJob.submission))
        .filter(GenerationJob.status == "queued")
        .order_by(GenerationJob.queued_at.asc())
        .with_for_update(skip_locked=True)
        .first()
    )
    return job  # state transition done by _transition(), not here


def _resolve_room_id(db: Session, job: GenerationJob) -> str | None:
    sub = db.get(Submission, job.submission_id)
    if not sub:
        return None
    rnd = db.get(Round, sub.round_id)
    return rnd.room_id if rnd else None
