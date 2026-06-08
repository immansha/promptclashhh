# PromptClash AI

PromptClash AI is a small real-time creative battle loop: a host creates a room, participants join, the host starts a round, participants submit prompts, a background AI job generates outputs, and the host scores or eliminates submissions while the room stays synchronized over WebSockets.
https://github.com/immansha/promptclashhh/blob/main/tbnail.png

## What This Project Does

The playable loop is intentionally narrow and matches the implementation in this repo:

1. Identity is captured through `POST /identity` and persisted in browser storage on the frontend.
2. The host creates a room through `POST /rooms`. The host is automatically added as the first participant.
3. Other players join the room through `POST /rooms/{code}/join`.
4. The host creates a round with a challenge prompt through `POST /rooms/{code}/rounds`.
5. The host starts that round with `PATCH /rooms/{code}/rounds/{round_id}/start`.
6. Participants submit prompts with `POST /rounds/{round_id}/submissions`.
7. The submission request returns immediately after the submission and queued job are saved; the async worker finishes generation later.
8. The worker transitions the job through `queued -> running -> completed` or `queued -> running -> failed`, with `timed_out` as a terminal state.
9. The host scores submissions with `PATCH /submissions/{submission_id}/score` and can eliminate the participant with `PATCH /submissions/{submission_id}/eliminate`.
10. Refresh and reconnect are supported by `GET /rooms/{code}` plus WebSocket deltas, so the room can be rehydrated after reload.

The result is a reviewable vertical slice of a multiplayer AI battle room, not a generalized game platform.

## Demo Flow

Use two browser contexts so the host and participant have separate identities.

Browser A: host

1. Open the frontend at `http://localhost:3000`.
2. Enter a name and email on the identity page.
3. Go to the dashboard and create a room.
4. Optionally enter a challenge prompt on the dashboard so round one is created immediately.
5. Open the room page and, if needed, create or start the pending round.
6. Keep the room page open so you can watch the participant list, round state, submission list, job status, and scoring controls update live.

Browser B: participant in an incognito/private window

1. Open the frontend at `http://localhost:3000`.
2. Enter a different name and email.
3. Join the host's room using the room code shown in Browser A.
4. Wait for the host to start the round.
5. Submit a prompt.
6. Watch the generation job move from `queued` to `running` and then to `completed` or `failed`.
7. Refresh the page and confirm the room still rehydrates from the backend snapshot.

After that, switch back to Browser A and score the submission or eliminate the participant to complete the loop.

## Tech Stack

Frontend:

- Next.js 15
- TypeScript
- Tailwind CSS
- Zustand
- Framer Motion
- Lucide React

Backend:

- FastAPI
- SQLAlchemy
- SQLite
- WebSockets
- asyncio background jobs

## Architecture Overview

Frontend:

- The app uses Next.js routes for identity, lobby, and room views.
- State is split across Zustand stores for auth, room state, and WebSocket connection state.
- The room view hydrates from the backend snapshot first, then applies WebSocket events as deltas.
- The socket client reconnects automatically and re-fetches the room on reconnect.

Backend:

- FastAPI exposes identity, room, round, submission, and job endpoints.
- Mutating endpoints resolve the caller from the `X-User-Id` header.
- A room-scoped WebSocket manager fans out typed events to all connected clients in a room.
- A background asyncio worker runs in-process inside the FastAPI lifespan and processes generation jobs.

Database:

- SQLAlchemy models persist the room snapshot, submission state, job state, and event log in SQLite.
- SQLite is configured for local development with WAL mode and a connection pool that is larger than the default SQLite setup.

WebSocket flow:

- The backend emits typed envelopes shaped like `{ type, seq, ts, ...payload }`.
- The frontend reducer patches the current room snapshot in response to those events.
- When a client reconnects, it can detect that it missed events using the room sequence number and then rehydrate via `GET /rooms/{code}`.

Async worker:

- The worker claims queued jobs, marks them running, calls the configured AI provider, and commits the terminal state back to the database.
- The default provider is `MockAIProvider`; `AnthropicProvider` is also available if configured.

## Entity Model / Database Schema

User

- Stores the local identity record keyed by email.
- Exists so every request can be tied back to a consistent user id.

Room

- Stores the room code, host, lifecycle status, and the current round number.
- Exists as the top-level container for a battle session.

Participant

- Links a user to a room and tracks `is_host` and `is_eliminated`.
- Exists so the same user can be treated differently across different rooms.

Round

- Stores the challenge prompt, round number, state, and timestamps.
- Exists because the room advances through explicit round boundaries.

Submission

- Stores the participant prompt, score, elimination flag, and the owning round.
- Exists because submissions are the core judged artifact in the battle loop.

GenerationJob

- Stores async job state for a submission, including status, output, retries, and timestamps.
- Exists so generation can finish after the HTTP submission response returns.

RoomEvent

- Stores an append-only room event log.
- Exists for debugging and replay-style inspection; the current frontend does not read it directly.

## Realtime Event Model

The backend emits these actual WebSocket event names:

- `room.status_changed`
- `room.participant_joined`
- `room.participant_left`
- `round.created`
- `round.started`
- `round.closed`
- `submission.created`
- `submission.scored`
- `participant.eliminated`
- `job.queued`
- `job.running`
- `job.completed`
- `job.failed`
- `job.timed_out`

Notes:

- `room.created` is defined in the event helpers, but the current routers do not emit it.
- The frontend room reducer currently handles the room, round, submission, and job events above.
- The live room view updates by applying these WebSocket deltas on top of the snapshot returned from `GET /rooms/{code}`.

## Generation Job Lifecycle

Generation jobs follow a simple state machine:

- `queued` when the submission is saved and the job is created.
- `running` when a worker claims the job.
- `completed` when the provider returns output successfully.
- `failed` when the provider raises a non-retryable error or retries are exhausted.
- `timed_out` when the provider exceeds the configured timeout.

The submission endpoint returns before generation completes. That is deliberate: the request writes the submission and job rows first, then the background worker resolves generation asynchronously.

Transient errors are retried with exponential backoff in the worker. In the current code, the default retry budget is two attempts and the default timeout is 30 seconds.

## Permission Model

Backend-enforced rules:

- The host can create rounds.
- The host can start and close rounds.
- The host can score submissions.
- The host can eliminate participants.
- Participants can submit prompts only while the round is active.
- The host cannot submit prompts.
- Eliminated participants cannot submit prompts.

The backend resolves the caller from the `X-User-Id` header on mutating endpoints, so these checks are enforced server-side rather than in the UI alone.

## Battle / Judging Mechanism

Judging is manual. The host assigns a numeric score to each submission in the backend and UI, and then can eliminate the participant associated with that submission.

The implementation accepts scores in the range 0-10, not 1-10. I am calling that out explicitly because the code, not the assignment prompt, is the source of truth here.

Why this choice:

- It keeps the judging path easy to understand and easy to demo.
- It avoids introducing a second AI-to-AI arbitration layer before the core loop is proven.

Weakness:

- Manual scoring is subjective and can drift between hosts.

Production improvement:

- Add an AI-assisted rubric to suggest scores, then keep human override as the final decision.

## Persistence Strategy

What survives refresh:

- User identity survives because the frontend persists it in local storage.
- Room state survives because the backend stores it in SQLite and rehydrates the room snapshot from the database.
- Participants survive because they are stored in the database.
- Rounds survive because they are stored in the database.
- Submissions survive because they are stored in the database.
- Job status survives because `GenerationJob` rows are persisted.
- Scores and eliminations survive because they are stored on the submission and participant records.

What does not fully survive refresh:

- The client-side activity feed is in memory and is rebuilt from live events; it is not itself persisted as a separate UI store.
- The backend does keep a `RoomEvent` table, but the current frontend does not replay it on page load.

## Failure Handling

The implementation has explicit failure paths:

- Failed generation is represented by `job.failed` with an error message.
- Timeout is represented by `job.timed_out`.
- Invalid prompt state is rejected by the submission service with 4xx responses when the round is not active, the user is the host, the participant is eliminated, or the participant already submitted.
- The frontend shows socket connection state with an explicit indicator and reconnects automatically after disconnects.
- The socket client retries after a short delay if the connection drops.
- The API client surfaces backend errors and network failures as readable messages in the UI.

## Tradeoffs

- Mock identity instead of JWT: this keeps the assignment focused on room flow, not on auth infrastructure.
- SQLite: simplest local persistence story for a demo; not the right choice for multi-process production concurrency.
- In-process asyncio worker: easy to understand and ships with the app, but it is not distributed and it shares process resources with the API server.
- Mock AI provider: the default provider makes the loop runnable without external credentials.
- One-round vertical slice: the code proves the room-to-submission-to-scoring loop without trying to cover every battle mode.

## Local Setup

Backend setup:

```powershell
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
cd ..
uvicorn backend.main:app --reload --port 8000
```

The code lives in the `backend` package, so `backend.main:app` is the correct application path and needs to be run from the repo root.

Frontend setup:

```powershell
cd frontend
npm install
npm run dev
```

App URLs:

- Frontend: http://localhost:3000
- Backend: http://127.0.0.1:8000
- API docs: http://127.0.0.1:8000/docs

## Environment Variables

See `.env.example` for the current local overrides used by the codebase. The main variables are:

- `NEXT_PUBLIC_API_BASE_URL` for the frontend API target.
- `PROVIDER` for the backend AI provider selection.
- `JOB_CONCURRENCY`, `JOB_TIMEOUT_SECS`, `JOB_MAX_RETRIES`, and `JOB_POLL_SECS` for the job worker.
- `ANTHROPIC_API_KEY`, `AI_MODEL`, and `AI_MAX_TOKENS` if you switch from the mock provider to Anthropic.

## Known Limitations

- Mock identity is not secure authentication.
- The in-process worker is not distributed.
- SQLite is appropriate for local and demo use, not for a multi-user production deployment.
- The code currently covers a single room / single round vertical slice rather than a full tournament system.
- Manual judging can be biased.
- The default AI provider is mocked unless you configure a real provider.

## What I Would Improve With More Time

- JWT or OAuth-based authentication.
- Redis, Celery, or RQ for background jobs.
- PostgreSQL for durable multi-user storage.
- AI-assisted judging with a human override.
- Reconnect recovery that can reconcile missed deltas automatically.
- Automated tests for routers, services, worker transitions, and frontend state sync.
- Deployment support for a real hosting target.
- A moderation and safety layer for prompts and model outputs.

## Submission Evidence

Screenshots or screen recordings should show the full host + participant flow:

- identity creation
- room creation and join
- round start
- prompt submission
- async generation progress
- scoring and elimination
- refresh/reconnect persistence

That is the smallest evidence set that demonstrates the assignment loop end to end.
