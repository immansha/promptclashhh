"use client";

import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Bot,
  Copy,
  Crown,
  Gauge,
  RadioTower,
  RefreshCw,
  ShieldAlert,
  Swords,
  Trophy,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  createRound,
  eliminateParticipant,
  scoreSubmission,
  startRound,
  submitPrompt,
} from "@/lib/api";
import type {
  GenerationJobOut,
  ParticipantOut,
  RoundDetailOut,
  SubmissionOut,
} from "@/lib/types";
import { useRoomSession } from "@/hooks/use-room-session";
import { useIsAuthenticated } from "@/store/auth-store";
import {
  selectCurrentRound,
  selectSortedRounds,
  selectSubmissions,
} from "@/store/room-store";
import type { SocketConnectionStatus } from "@/store/websocket-store";

type BusyAction = "refresh" | "create-round" | "start-round" | "submit" | `score-${string}` | `eliminate-${string}` | null;

export default function RoomPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const isAuthenticated = useIsAuthenticated();

  const code = useMemo(() => decodeURIComponent(params.code).toUpperCase(), [params.code]);

  const {
    user,
    hasHydrated,
    room,
    participants,
    rounds,
    role,
    events,
    apiBaseUrl,
    isLoading,
    loadError,
    socketStatus,
    setApiBaseUrl,
    loadRoom,
    upsertRoundInRoom,
    upsertSubmissionInRoom,
    patchSubmissionInRoom,
    markParticipantEliminated,
    pushActivity,
  } = useRoomSession(code);

  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [actionError, setActionError] = useState("");
  const [success, setSuccess] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [promptText, setPromptText] = useState("");
  const [newRoundChallenge, setNewRoundChallenge] = useState("");
  const [scores, setScores] = useState<Record<string, string>>({});

  const isHost = role === "host";
  const isEliminated = role === "spectator";

  const sortedRounds = useMemo(() => selectSortedRounds(rounds), [rounds]);
  const currentRound = useMemo(() => selectCurrentRound(rounds), [rounds]);
  const pendingRound = sortedRounds.find((round) => round.status === "pending") ?? null;
  const activeRound = sortedRounds.find((round) => round.status === "active") ?? null;
  const submissions = useMemo(() => selectSubmissions(rounds), [rounds]);

  const currentParticipant = useMemo(
    () => participants.find((participant) => participant.user_id === user?.user_id) ?? null,
    [participants, user?.user_id],
  );

  const scoreboardRows = useMemo(() => {
    return participants
      .map((participant) => {
        const participantSubmissions = submissions
          .map(({ submission }) => submission)
          .filter((submission) => submission.participant_id === participant.id);
        const score = participantSubmissions.reduce((total, submission) => total + (submission.score ?? 0), 0);
        return { participant, score, submissions: participantSubmissions.length };
      })
      .sort((left, right) => right.score - left.score || right.submissions - left.submissions);
  }, [participants, submissions]);

  const participantById = useMemo(
    () => new Map(participants.map((participant) => [participant.id, participant])),
    [participants],
  );

  const alreadySubmitted = Boolean(
    activeRound?.submissions.some((submission) => submission.participant_id === currentParticipant?.id),
  );

  const canSubmit = Boolean(activeRound && currentParticipant && !isHost && !isEliminated && !alreadySubmitted);
  const error = actionError || loadError || "";

  useEffect(() => {
    if (hasHydrated && !isAuthenticated) {
      router.replace("/");
    }
  }, [hasHydrated, isAuthenticated, router]);

  async function handleCreateRound(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !room || !isHost || !newRoundChallenge.trim()) return;

    setBusyAction("create-round");
    setActionError("");
    setSuccess("");

    try {
      const round = await createRound(
        room.code,
        { challenge_text: newRoundChallenge.trim() },
        user.user_id,
        apiBaseUrl,
      );
      upsertRoundInRoom({ ...round, submissions: [] });
      setNewRoundChallenge("");
      setSuccess(`Round ${round.round_number} created. Start it when ready.`);
      pushActivity("round.create.requested", `round ${round.round_number}`);
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : "Could not create round.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleStartRound() {
    if (!user || !room || !pendingRound) return;
    setBusyAction("start-round");
    setActionError("");
    setSuccess("");

    try {
      const round = await startRound(room.code, pendingRound.id, user.user_id, apiBaseUrl);
      upsertRoundInRoom(round);
      setSuccess(`Round ${round.round_number} started.`);
      pushActivity("round.start.requested", `round ${round.round_number}`);
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : "Could not start round.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSubmitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !activeRound || !canSubmit) return;

    setBusyAction("submit");
    setActionError("");
    setSuccess("");

    try {
      const submission = await submitPrompt(activeRound.id, promptText.trim(), user.user_id, apiBaseUrl);
      upsertSubmissionInRoom(submission);
      setPromptText("");
      setSuccess("Prompt submitted. Generation job queued.");
      pushActivity("submission.requested", "prompt sent to backend");
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : "Could not submit prompt.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleScoreSubmission(submissionId: string) {
    if (!user) return;
    const value = Number(scores[submissionId]);
    if (!Number.isFinite(value)) {
      setActionError("Score must be a number between 0 and 10.");
      return;
    }

    setBusyAction(`score-${submissionId}`);
    setActionError("");
    setSuccess("");

    try {
      const submission = await scoreSubmission(submissionId, value, user.user_id, apiBaseUrl);
      patchSubmissionInRoom(submission.id, submission);
      setSuccess("Score saved.");
      pushActivity("score.requested", `${value}/10`);
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : "Could not score submission.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleEliminateSubmission(submissionId: string) {
    if (!user) return;
    setBusyAction(`eliminate-${submissionId}`);
    setActionError("");
    setSuccess("");

    try {
      const submission = await eliminateParticipant(submissionId, user.user_id, apiBaseUrl);
      markParticipantEliminated(submission.participant_id, submission);
      pushActivity("elimination.requested", submission.participant_id);
      setSuccess("Participant eliminated.");
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : "Could not eliminate participant.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRefresh() {
    setBusyAction("refresh");
    await loadRoom("manual refresh");
    setBusyAction(null);
  }

  async function copyRoomLink() {
    const link = `${window.location.origin}/room/${room?.code ?? code}`;
    await navigator.clipboard.writeText(link);
    setCopyStatus("Copied");
    window.setTimeout(() => setCopyStatus(""), 1400);
  }

  if (!hasHydrated || !isAuthenticated || !user) {
    return (
      <main className="relative grid min-h-screen place-items-center overflow-hidden px-5 text-white">
        <BattleRoomBackground />
        <p className="relative rounded-xl border border-cyan-300/20 bg-white/10 px-4 py-3 text-sm text-cyan-100 backdrop-blur">
          Preparing room workspace...
        </p>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden px-5 py-6 text-white sm:px-8">
      <BattleRoomBackground />
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
        className="relative mx-auto grid w-full max-w-7xl gap-5"
      >
        <header className="rounded-3xl border border-cyan-300/20 bg-slate-950/75 p-5 shadow-[0_0_90px_rgba(34,211,238,0.14)] backdrop-blur-xl">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
            <div>
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-normal text-cyan-300">
                <RadioTower className="h-4 w-4" />
                PromptClash AI battle room
              </p>
              <h1 className="mt-2 flex flex-wrap items-center gap-3 text-3xl font-black tracking-tight">
                <span className="rounded-2xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-2 text-cyan-100 shadow-[0_0_40px_rgba(34,211,238,0.18)]">
                  {room?.code ?? code}
                </span>
                <LiveBadge socketStatus={socketStatus} />
                <RoleBadge isEliminated={isEliminated} isHost={isHost} />
              </h1>
              <p className="mt-3 text-sm text-slate-400">
                Backend snapshot on load and refresh. WebSocket events keep this workspace live.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-[260px_auto_auto_auto]">
              <input
                className="h-10 rounded-xl border border-white/10 bg-white/[0.06] px-3 text-sm text-white outline-none ring-cyan-300/20 transition placeholder:text-slate-500 focus:border-cyan-300/50 focus:ring-4"
                value={apiBaseUrl}
                onChange={(event) => setApiBaseUrl(event.target.value)}
                aria-label="API base URL"
              />
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="flex h-10 items-center justify-center gap-2 rounded-xl border border-fuchsia-300/20 bg-fuchsia-300/10 px-4 text-sm font-semibold text-fuchsia-100 transition hover:bg-fuchsia-300/15"
                onClick={copyRoomLink}
                type="button"
              >
                <Copy className="h-4 w-4" />
                {copyStatus || "Copy link"}
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="flex h-10 items-center justify-center gap-2 rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-4 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-300/15 disabled:opacity-60"
                disabled={busyAction === "refresh" || isLoading}
                onClick={() => void handleRefresh()}
                type="button"
              >
                <RefreshCw className="h-4 w-4" />
                {busyAction === "refresh" || isLoading ? "Refreshing..." : "Refresh"}
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="h-10 rounded-xl bg-cyan-300 px-4 text-sm font-black text-slate-950 shadow-[0_0_34px_rgba(34,211,238,0.25)] transition hover:bg-cyan-200"
                onClick={() => router.push("/dashboard")}
                type="button"
              >
                Dashboard
              </motion.button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-4">
            <Metric icon={<Gauge className="h-4 w-4" />} label="Room status" value={room?.status ?? "loading"} />
            <Metric icon={socketStatus === "open" ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />} label="Socket" value={socketStatus} tone={socketStatus === "open" ? "green" : "amber"} />
            <Metric icon={<Users className="h-4 w-4" />} label="Participants" value={String(participants.length)} />
            <Metric icon={<Crown className="h-4 w-4" />} label="Role" value={isHost ? "Host" : isEliminated ? "Spectator" : "Participant"} />
          </div>
        </header>

        {error ? <p className="whitespace-pre-wrap rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</p> : null}
        {success ? <p className="rounded-2xl border border-emerald-300/20 bg-emerald-300/10 px-4 py-3 text-sm text-emerald-100">{success}</p> : null}

        <section className="grid gap-5 xl:grid-cols-[290px_minmax(0,1fr)_360px]">
          <aside className="grid content-start gap-5">
            <Panel title="Participants" eyebrow="Roster">
              <div className="grid gap-2">
                {participants.length > 0 ? (
                  participants.map((participant) => (
                    <ParticipantRow currentUserId={user.user_id} key={participant.id} participant={participant} />
                  ))
                ) : (
                  <EmptyText>No participants loaded.</EmptyText>
                )}
              </div>
            </Panel>

            <Panel title="Current Round" eyebrow="Workflow">
              {currentRound ? (
                <div className="grid gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">Round {currentRound.round_number}</p>
                    <p className="mt-2 rounded-2xl border border-white/10 bg-black/25 px-3 py-2 text-sm leading-6 text-slate-200">{currentRound.challenge_text}</p>
                  </div>
                  <StatusBadge value={currentRound.status} />
                  {isHost ? (
                    <button
                      className="h-10 rounded-xl bg-cyan-300 px-4 text-sm font-bold text-slate-950 shadow-[0_0_34px_rgba(34,211,238,0.22)] transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={!pendingRound || busyAction === "start-round"}
                      onClick={handleStartRound}
                      type="button"
                    >
                      {busyAction === "start-round" ? "Starting..." : "Start round"}
                    </button>
                  ) : null}
                </div>
              ) : (
                <div className="grid gap-3">
                  <EmptyText>No round exists yet.</EmptyText>
                  {isHost ? (
                    <form className="grid gap-3" onSubmit={handleCreateRound}>
                      <textarea
                        className="min-h-28 rounded-2xl border border-cyan-300/15 bg-black/35 px-3 py-2 text-sm text-cyan-50 outline-none ring-cyan-300/20 transition placeholder:text-slate-500 focus:border-cyan-300/50 focus:ring-4"
                        onChange={(event) => setNewRoundChallenge(event.target.value)}
                        placeholder="Define the challenge for round one..."
                        value={newRoundChallenge}
                      />
                      <button
                        className="h-10 rounded-xl bg-cyan-300 px-4 text-sm font-bold text-slate-950 shadow-[0_0_34px_rgba(34,211,238,0.22)] transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={!newRoundChallenge.trim() || busyAction === "create-round"}
                        type="submit"
                      >
                        {busyAction === "create-round" ? "Creating round..." : "Create round"}
                      </button>
                    </form>
                  ) : (
                    <EmptyText>Waiting for the host to create a round.</EmptyText>
                  )}
                </div>
              )}
            </Panel>

            <Panel title="Scoreboard" eyebrow="Esports Panel">
              {scoreboardRows.length > 0 ? (
                <div className="grid gap-2">
                  {scoreboardRows.map((row, index) => (
                    <ScoreboardRow index={index} key={row.participant.id} row={row} />
                  ))}
                </div>
              ) : (
                <EmptyText>Scores appear after host review.</EmptyText>
              )}
            </Panel>
          </aside>

          <section className="grid content-start gap-5">
            <Panel title="Submission Review" eyebrow="Generated Outputs">
              {submissions.length > 0 ? (
                <div className="grid gap-4">
                  {submissions.map(({ round, submission }) => (
                    <SubmissionReview
                      busyAction={busyAction}
                      isHost={isHost}
                      key={submission.id}
                      onEliminate={handleEliminateSubmission}
                      onScore={handleScoreSubmission}
                      participant={participantById.get(submission.participant_id)}
                      round={round}
                      scoreValue={scores[submission.id] ?? ""}
                      setScoreValue={(value) => setScores((current) => ({ ...current, [submission.id]: value }))}
                      submission={submission}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No submissions yet"
                  body="Submissions will appear here after participants submit prompts for an active round."
                />
              )}
            </Panel>
          </section>

          <aside className="grid content-start gap-5">
            <Panel title="Submit Prompt" eyebrow="Participant Action">
              {isHost ? (
                <EmptyText>Hosts review submissions and cannot submit prompts.</EmptyText>
              ) : isEliminated ? (
                <EmptyText>Eliminated participants cannot submit.</EmptyText>
              ) : !activeRound ? (
                <EmptyText>Waiting for the host to start a round.</EmptyText>
              ) : alreadySubmitted ? (
                <EmptyText>You already submitted for this round.</EmptyText>
              ) : (
                <form className="grid gap-3" onSubmit={handleSubmitPrompt}>
                  <textarea
                    className="min-h-36 rounded-2xl border border-cyan-300/15 bg-black/35 px-3 py-2 font-mono text-sm text-cyan-50 outline-none ring-cyan-300/20 transition placeholder:text-slate-500 focus:border-cyan-300/50 focus:ring-4"
                    onChange={(event) => setPromptText(event.target.value)}
                    placeholder="Write the prompt you want the AI to execute..."
                    value={promptText}
                  />
                  <button
                    className="h-10 rounded-xl bg-cyan-300 px-4 text-sm font-bold text-slate-950 shadow-[0_0_34px_rgba(34,211,238,0.22)] transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={!canSubmit || promptText.trim().length === 0 || busyAction === "submit"}
                    type="submit"
                  >
                    {busyAction === "submit" ? "Submitting..." : "Submit prompt"}
                  </button>
                </form>
              )}
            </Panel>

            <Panel title="Event Timeline" eyebrow="Realtime">
              <div className="grid gap-2">
                {events.length > 0 ? (
                  events.map((event) => (
                    <motion.div
                      initial={{ opacity: 0, x: 12 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-xs text-slate-300"
                      key={event.id}
                    >
                      {event.message}
                    </motion.div>
                  ))
                ) : (
                  <EmptyText>No live events yet.</EmptyText>
                )}
              </div>
            </Panel>
          </aside>
        </section>
      </motion.section>
    </main>
  );
}

function Panel({ children, eyebrow, title }: { children: ReactNode; eyebrow: string; title: string }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      className="rounded-3xl border border-white/10 bg-slate-950/72 p-5 shadow-[0_0_70px_rgba(15,23,42,0.45)] backdrop-blur-xl transition duration-200 hover:border-cyan-300/25"
    >
      <p className="text-xs font-semibold uppercase tracking-normal text-cyan-300">{eyebrow}</p>
      <h2 className="mt-1 text-lg font-semibold">{title}</h2>
      <div className="mt-4">{children}</div>
    </motion.section>
  );
}

function Metric({ icon, label, tone, value }: { icon: ReactNode; label: string; tone?: "green" | "amber"; value: string }) {
  const color = tone === "green" ? "text-emerald-100 bg-emerald-300/10 border-emerald-300/20" : tone === "amber" ? "text-amber-100 bg-amber-300/10 border-amber-300/20" : "text-cyan-100 bg-white/[0.06] border-white/10";
  return (
    <div className={`rounded-lg border px-3 py-2 ${color}`}>
      <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-normal opacity-80">{icon}{label}</p>
      <p className="mt-1 text-sm font-bold">{value}</p>
    </div>
  );
}

function ParticipantRow({ currentUserId, participant }: { currentUserId: string; participant: ParticipantOut }) {
  const name = participant.user?.name ?? participant.user_id;
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <p className="truncate text-sm font-medium">{name}</p>
        <StatusBadge value={participant.is_host ? "host" : participant.is_eliminated ? "eliminated" : "active"} />
      </div>
      <p className="mt-1 text-xs text-slate-400">{participant.user_id === currentUserId ? "You" : participant.user?.email ?? participant.user_id}</p>
    </div>
  );
}

function ScoreboardRow({
  index,
  row,
}: {
  index: number;
  row: { participant: ParticipantOut; score: number; submissions: number };
}) {
  const name = row.participant.user?.name ?? row.participant.user_id;
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-8 w-8 place-items-center rounded-lg border border-amber-300/20 bg-amber-300/10 text-xs font-black text-amber-100">
          {index === 0 ? <Trophy className="h-4 w-4" /> : index + 1}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{name}</p>
          <p className="text-xs text-slate-400">{row.submissions} submission{row.submissions === 1 ? "" : "s"}</p>
        </div>
      </div>
      <div className="text-right">
        <p className="text-lg font-black text-cyan-100">{row.score}</p>
        <p className="text-xs text-slate-500">pts</p>
      </div>
    </div>
  );
}

function SubmissionReview({
  busyAction,
  isHost,
  onEliminate,
  onScore,
  participant,
  round,
  scoreValue,
  setScoreValue,
  submission,
}: {
  busyAction: BusyAction;
  isHost: boolean;
  onEliminate: (submissionId: string) => void;
  onScore: (submissionId: string) => void;
  participant?: ParticipantOut;
  round: RoundDetailOut;
  scoreValue: string;
  setScoreValue: (value: string) => void;
  submission: SubmissionOut;
}) {
  const job = submission.generation_job;
  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-3xl border border-cyan-300/15 bg-white/[0.06] p-4 shadow-[0_0_50px_rgba(34,211,238,0.08)]"
    >
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
        <div>
          <p className="text-xs font-semibold uppercase tracking-normal text-slate-500">Round {round.round_number}</p>
          <h3 className="mt-1 text-base font-semibold">{participant?.user?.name ?? participant?.user_id ?? "Unknown participant"}</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge value={job?.status ?? "not queued"} />
          <StatusBadge value={submission.score === null || submission.score === undefined ? "unscored" : `${submission.score}/10`} />
          {submission.is_eliminated ? <StatusBadge value="eliminated" /> : null}
        </div>
      </div>

      <p className="mt-4 rounded-2xl border border-white/10 bg-black/25 px-3 py-2 text-sm leading-6 text-slate-200">{submission.prompt_text}</p>

      <JobLifecycle job={job} />

      {job?.output_text ? (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-4 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-3 py-2">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-normal text-cyan-200"><Bot className="h-4 w-4" /> Generated Output</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-100">{job.output_text}</p>
        </motion.div>
      ) : null}

      {job?.error_message ? (
        <motion.div animate={{ x: [0, -3, 3, 0] }} className="mt-4 rounded-2xl border border-rose-300/20 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">{job.error_message}</motion.div>
      ) : null}

      {isHost ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-[110px_auto_auto]">
          <input
            className="h-10 rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none ring-cyan-300/20 transition focus:ring-4"
            max={10}
            min={0}
            onChange={(event) => setScoreValue(event.target.value)}
            placeholder="0-10"
            type="number"
            value={scoreValue}
          />
          <button
            className="h-10 rounded-xl bg-cyan-300 px-4 text-sm font-bold text-slate-950 transition hover:bg-cyan-200 disabled:opacity-60"
            disabled={busyAction === `score-${submission.id}`}
            onClick={() => onScore(submission.id)}
            type="button"
          >
            {busyAction === `score-${submission.id}` ? "Saving..." : "Score"}
          </button>
          <button
            className="h-10 rounded-xl border border-rose-300/20 bg-rose-400/10 px-4 text-sm font-bold text-rose-100 transition hover:bg-rose-400/15 disabled:opacity-60"
            disabled={busyAction === `eliminate-${submission.id}` || submission.is_eliminated}
            onClick={() => onEliminate(submission.id)}
            type="button"
          >
            {busyAction === `eliminate-${submission.id}` ? "Eliminating..." : "Eliminate"}
          </button>
        </div>
      ) : null}
    </motion.article>
  );
}

function JobLifecycle({ job }: { job?: GenerationJobOut | null }) {
  const steps = ["queued", "running", "completed", "failed/timed_out"];
  const status = job?.status ?? "not queued";
  return (
    <div className="mt-4 grid gap-2 sm:grid-cols-4">
      {steps.map((step) => {
        const active =
          status === step ||
          (step === "failed/timed_out" && (status === "failed" || status === "timed_out")) ||
          (step === "completed" && status === "completed");
        return (
          <div
            className={`rounded-xl border px-3 py-2 text-xs font-bold ${
              active ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-100 shadow-[0_0_28px_rgba(34,211,238,0.12)]" : "border-white/10 bg-white/[0.04] text-slate-500"
            }`}
            key={step}
          >
            {step}
          </div>
        );
      })}
    </div>
  );
}

function StatusBadge({ value }: { value: string }) {
  const normalized = value.toLowerCase();
  const pulse = normalized === "queued" || normalized === "running" || normalized === "pending" || normalized === "active";
  const shake = normalized === "failed" || normalized === "timed_out" || normalized === "eliminated";
  const completed = normalized === "completed";

  const tone = shake
    ? "border-rose-300/30 bg-rose-400/10 text-rose-100"
    : completed
      ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-100"
      : pulse
        ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-100 status-pulse"
        : "border-cyan-300/20 bg-cyan-300/10 text-cyan-100";

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${tone} ${shake ? "status-shake" : ""}`}>
      {value}
    </span>
  );
}

function EmptyText({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-6 text-slate-400">{children}</p>;
}

function EmptyState({ body, title }: { body: string; title: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-cyan-300/20 bg-white/[0.04] px-4 py-8 text-center">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-400">{body}</p>
    </div>
  );
}

function LiveBadge({ socketStatus }: { socketStatus: SocketConnectionStatus }) {
  const isLive = socketStatus === "open";
  const label = isLive ? "LIVE" : socketStatus === "reconnecting" ? "RECONNECTING" : socketStatus === "connecting" ? "CONNECTING" : "OFFLINE";
  const tone = isLive
    ? "border-emerald-300/40 bg-emerald-400/15 text-emerald-100 live-badge"
    : socketStatus === "reconnecting" || socketStatus === "connecting"
      ? "border-amber-300/30 bg-amber-300/10 text-amber-100 status-pulse"
      : "border-rose-300/30 bg-rose-400/10 text-rose-100";

  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-black uppercase tracking-widest ${tone}`}>
      <span className={`h-2 w-2 rounded-full ${isLive ? "bg-emerald-300" : socketStatus === "reconnecting" || socketStatus === "connecting" ? "bg-amber-300" : "bg-rose-300"}`} />
      {label}
    </span>
  );
}

function RoleBadge({ isEliminated, isHost }: { isEliminated: boolean; isHost: boolean }) {
  const label = isHost ? "Host" : isEliminated ? "Spectating" : "Participant";
  const Icon = isHost ? Crown : isEliminated ? ShieldAlert : Swords;
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-fuchsia-300/20 bg-fuchsia-300/10 px-3 py-1 text-sm font-bold text-fuchsia-100">
      <Icon className="h-4 w-4" />
      {label}
    </span>
  );
}

function BattleRoomBackground() {
  return (
    <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
      <div className="arena-grid absolute inset-x-0 bottom-[-12rem] h-[42rem] opacity-70" />
      <div className="scanline absolute inset-x-0 top-0 h-1/2" />
      <div className="cursor-glow absolute left-2/3 top-[-4rem] h-[38rem] w-[38rem] -translate-x-1/2 rounded-full blur-3xl" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0,rgba(5,8,22,0.52)_48%,rgba(5,8,22,0.98)_100%)]" />
    </div>
  );
}
