import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .database import engine
from .models import Base
from .routers import identity_router, room_router, round_router, submission_router
from .services import reset_stale_jobs
from .database import SessionLocal
from .workers import run_worker

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ─────────────────────────────────────────────────────────────
    Base.metadata.create_all(bind=engine)
    logger.info("Database tables created / verified.")

    db = SessionLocal()
    try:
        reset_count = reset_stale_jobs(db)
        if reset_count:
            logger.info("Reset %d stale jobs to 'queued'.", reset_count)
    finally:
        db.close()

    worker_task = asyncio.create_task(run_worker())
    logger.info("Job worker task started.")

    yield

    # ── Shutdown ─────────────────────────────────────────────────────────────
    worker_task.cancel()
    try:
        await worker_task
    except asyncio.CancelledError:
        pass
    logger.info("Job worker task stopped.")


app = FastAPI(
    title="PromptClash AI",
    version="1.0.0",
    description="Real-time AI creative battle rooms.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(identity_router)
app.include_router(room_router)
app.include_router(round_router)
app.include_router(submission_router)

frontend_dir = Path(__file__).resolve().parent.parent / "frontend"
if frontend_dir.exists():
    app.mount("/app", StaticFiles(directory=frontend_dir, html=True), name="frontend")


@app.get("/health", tags=["meta"])
def health():
    return {"status": "ok"}
