"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, Copy, DoorOpen, Ghost, Plus, RadioTower, Swords, Terminal, UserRound, Zap } from "lucide-react";
import { createRoom, createRound, joinRoom } from "@/lib/api";
import { useAuthStore, useIsAuthenticated } from "@/store/auth-store";

const DEFAULT_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
const RECENT_ROOMS_KEY = "promptclash.recentRooms";

type RecentRoom = {
  code: string;
  role: "host" | "participant";
  joinedAt: string;
  status?: string;
};

export default function DashboardPage() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const hasHydrated = useAuthStore((state) => state.hasHydrated);
  const clearUser = useAuthStore((state) => state.clearUser);
  const isAuthenticated = useIsAuthenticated();
  const [roomCode, setRoomCode] = useState("");
  const [challengeText, setChallengeText] = useState("");
  const [apiBaseUrl, setApiBaseUrl] = useState(DEFAULT_API_BASE_URL);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [lastRoomLink, setLastRoomLink] = useState("");
  const [recentRooms, setRecentRooms] = useState<RecentRoom[]>([]);

  const canJoin = useMemo(() => Boolean(user?.user_id) && roomCode.trim().length > 0 && !isJoining, [user?.user_id, isJoining, roomCode]);

  useEffect(() => {
    if (hasHydrated && !isAuthenticated) router.replace("/");
  }, [hasHydrated, isAuthenticated, router]);

  useEffect(() => {
    setRecentRooms(readRecentRooms());
  }, []);

  function rememberRoom(entry: RecentRoom) {
    const next = [entry, ...readRecentRooms().filter((room) => room.code !== entry.code)].slice(0, 6);
    localStorage.setItem(RECENT_ROOMS_KEY, JSON.stringify(next));
    setRecentRooms(next);
  }

  async function enterRoom(rawCode: string) {
    if (!user) return;
    const normalized = normalizeRoomCode(rawCode);
    if (!normalized) {
      setError("Enter a valid room code like CLASH-P8.");
      return;
    }

    setError("");
    setStatus("");
    setIsJoining(true);

    try {
      const room = await joinRoom(normalized, user.user_id, apiBaseUrl);
      const link = `${window.location.origin}/room/${room.code}`;
      setLastRoomLink(link);
      const joinedAsHost = room.participants.some((p) => p.user_id === user.user_id && p.is_host);
      rememberRoom({
        code: room.code,
        role: joinedAsHost ? "host" : "participant",
        joinedAt: new Date().toISOString(),
        status: room.status,
      });
      setStatus(`Joined ${room.code}. Opening...`);
      router.push(`/room/${room.code}`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not join room.");
    } finally {
      setIsJoining(false);
    }
  }

  async function handleCreateRoom() {
    if (!user) return;
    setError("");
    setStatus("");
    setIsCreating(true);

    try {
      const room = await createRoom(user.user_id, apiBaseUrl);
      if (challengeText.trim()) {
        await createRound(room.code, { challenge_text: challengeText.trim() }, user.user_id, apiBaseUrl);
      }
      const link = `${window.location.origin}/room/${room.code}`;
      setLastRoomLink(link);
      rememberRoom({ code: room.code, role: "host", joinedAt: new Date().toISOString(), status: room.status });
      setStatus(challengeText.trim() ? `Room ${room.code} armed with challenge. Opening...` : `Room ${room.code} created. Opening...`);
      router.push(`/room/${room.code}`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not create room.");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleJoinRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await enterRoom(roomCode);
  }

  async function handleEnterRecentRoom(code: string) {
    setRoomCode(code);
    await enterRoom(code);
  }

  async function copyLink() {
    if (!lastRoomLink) return;
    await navigator.clipboard.writeText(lastRoomLink);
    setStatus("Room link copied.");
  }

  if (!hasHydrated || !isAuthenticated || !user) {
    return (
      <main className="relative grid min-h-screen place-items-center overflow-hidden px-5 text-white">
        <BattleBackground />
        <p className="relative rounded-xl border border-cyan-300/20 bg-white/10 px-4 py-3 text-sm text-cyan-100 backdrop-blur">Loading lobby access...</p>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden px-5 py-8 text-white sm:px-8">
      <BattleBackground />
      <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="relative mx-auto grid w-full max-w-7xl gap-6">
        <header className="flex flex-col justify-between gap-4 rounded-3xl border border-cyan-300/20 bg-slate-950/70 p-6 shadow-[0_0_90px_rgba(34,211,238,0.16)] backdrop-blur-xl lg:flex-row lg:items-center">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-normal text-cyan-300"><RadioTower className="h-4 w-4" /> Battle control</p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">Command Lobby</h1>
            <p className="mt-2 text-sm text-slate-300">Create a challenge room, share the code, and launch the live AI workflow.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-cyan-300/10 p-3 text-cyan-200"><UserRound className="h-5 w-5" /></div>
              <div>
                <p className="font-semibold">{user.name}</p>
                <p className="text-sm text-slate-400">{user.email}</p>
              </div>
            </div>
            <button className="mt-3 text-xs text-slate-400 hover:text-cyan-200" onClick={() => { clearUser(); router.push("/"); }} type="button">Switch identity</button>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <motion.div whileHover={{ y: -3 }} className="rounded-3xl border border-cyan-300/20 bg-slate-950/75 p-6 shadow-[0_0_80px_rgba(34,211,238,0.14)] backdrop-blur-xl">
            <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-normal text-cyan-300"><Swords className="h-4 w-4" /> Create room</p>
            <h2 className="mt-2 text-2xl font-bold">Host a creative clash</h2>
            <textarea
              className="mt-5 min-h-36 w-full rounded-2xl border border-cyan-300/15 bg-black/30 px-4 py-3 text-sm text-cyan-50 outline-none ring-cyan-300/20 transition placeholder:text-slate-500 focus:border-cyan-300/50 focus:ring-4"
              value={challengeText}
              onChange={(event) => setChallengeText(event.target.value)}
              placeholder="Enter the creative challenge prompt for round one..."
            />
            <motion.button
              whileHover={{ scale: 1.015 }}
              whileTap={{ scale: 0.985 }}
              disabled={isCreating}
              onClick={handleCreateRoom}
              className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-cyan-300 px-4 font-black text-slate-950 shadow-[0_0_44px_rgba(34,211,238,0.38)] transition hover:bg-cyan-200 disabled:opacity-50"
              type="button"
            >
              <Plus className="h-5 w-5" />
              {isCreating ? "Creating room..." : "Create room and enter"}
            </motion.button>
          </motion.div>

          <motion.div whileHover={{ y: -3 }} className="rounded-3xl border border-fuchsia-300/20 bg-slate-950/75 p-6 shadow-[0_0_80px_rgba(217,70,239,0.12)] backdrop-blur-xl">
            <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-normal text-fuchsia-300"><DoorOpen className="h-4 w-4" /> Join room</p>
            <h2 className="mt-2 text-2xl font-bold">Enter by room code</h2>
            <form className="mt-5 grid gap-4" onSubmit={handleJoinRoom}>
              <input
                className="h-14 rounded-2xl border border-fuchsia-300/15 bg-black/30 px-4 text-lg font-bold uppercase tracking-wide text-white outline-none ring-fuchsia-300/20 transition placeholder:text-slate-600 focus:border-fuchsia-300/50 focus:ring-4"
                value={roomCode}
                onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
                placeholder="CLASH-P8"
                autoCapitalize="characters"
                spellCheck={false}
              />
              <p className="text-xs text-slate-500">Use the exact code from the host (example: CLASH-P8).</p>
              <button
                disabled={!canJoin}
                className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-fuchsia-300 px-4 font-black text-slate-950 shadow-[0_0_44px_rgba(217,70,239,0.32)] transition hover:bg-fuchsia-200 disabled:opacity-50"
                type="submit"
              >
                <Terminal className="h-5 w-5" />
                {isJoining ? "Joining..." : "Join battle room"}
              </button>
            </form>
          </motion.div>
        </section>

        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-3xl border border-amber-300/20 bg-slate-950/75 p-6 shadow-[0_0_80px_rgba(251,191,36,0.1)] backdrop-blur-xl"
        >
          <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-normal text-amber-300">
            <Zap className="h-4 w-4" /> Recent &amp; active rooms
          </p>
          <h2 className="mt-2 text-2xl font-bold">Your battle history</h2>

          {recentRooms.length > 0 ? (
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {recentRooms.map((entry) => (
                <motion.button
                  key={entry.code}
                  whileHover={{ y: -2, scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  className="group rounded-2xl border border-amber-300/15 bg-white/[0.05] p-4 text-left shadow-[0_0_40px_rgba(251,191,36,0.08)] transition hover:border-amber-300/35 hover:bg-amber-300/[0.07]"
                  onClick={() => void handleEnterRecentRoom(entry.code)}
                  disabled={isJoining}
                  type="button"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-lg font-black text-amber-100">{entry.code}</span>
                    <ArrowRight className="h-4 w-4 text-amber-300/60 transition group-hover:translate-x-0.5 group-hover:text-amber-200" />
                  </div>
                  <p className="mt-2 text-xs uppercase tracking-wide text-slate-400">
                    {entry.role === "host" ? "Host" : "Participant"}
                    {entry.status ? ` · ${entry.status}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{new Date(entry.joinedAt).toLocaleString()}</p>
                </motion.button>
              ))}
            </div>
          ) : (
            <div className="mt-5 rounded-2xl border border-dashed border-amber-300/25 bg-white/[0.03] px-6 py-10 text-center">
              <Ghost className="mx-auto h-10 w-10 text-amber-300/50" />
              <h3 className="mt-4 text-lg font-semibold text-amber-100">No active rooms yet</h3>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-400">
                Create a battle room or join one with a code above. Your recent rooms will appear here for quick re-entry.
              </p>
            </div>
          )}
        </motion.section>

        <section className="grid gap-4 lg:grid-cols-[1fr_auto]">
          <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-4 backdrop-blur">
            <label className="text-xs font-semibold uppercase tracking-normal text-slate-400">API base URL</label>
            <input className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none" value={apiBaseUrl} onChange={(event) => setApiBaseUrl(event.target.value)} />
          </div>
          <button disabled={!lastRoomLink} onClick={copyLink} className="flex h-full min-h-16 items-center justify-center gap-2 rounded-2xl border border-amber-300/20 bg-amber-300/10 px-6 font-semibold text-amber-100 disabled:opacity-40" type="button">
            <Copy className="h-4 w-4" />
            Copy last room link
          </button>
        </section>

        {status ? <p className="rounded-2xl border border-emerald-300/20 bg-emerald-300/10 px-4 py-3 text-sm text-emerald-100">{status}</p> : null}
        {error ? <p className="whitespace-pre-wrap rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</p> : null}
      </motion.section>
    </main>
  );
}

function normalizeRoomCode(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function readRecentRooms(): RecentRoom[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_ROOMS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecentRoom);
  } catch {
    return [];
  }
}

function isRecentRoom(value: unknown): value is RecentRoom {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Partial<RecentRoom>;
  return typeof item.code === "string" && (item.role === "host" || item.role === "participant") && typeof item.joinedAt === "string";
}

function BattleBackground() {
  return (
    <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
      <div className="arena-grid absolute inset-x-0 bottom-[-10rem] h-[42rem] opacity-80" />
      <div className="scanline absolute inset-x-0 top-0 h-1/2" />
      <div className="cursor-glow absolute left-1/2 top-0 h-[38rem] w-[38rem] -translate-x-1/2 rounded-full blur-3xl" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0,rgba(5,8,22,0.58)_50%,rgba(5,8,22,0.98)_100%)]" />
    </div>
  );
}
