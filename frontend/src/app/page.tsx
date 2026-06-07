"use client";

import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, Mail, Orbit, Shield, Sparkles, UserRound } from "lucide-react";
import { identify } from "@/lib/api";
import { useAuthStore, useIsAuthenticated } from "@/store/auth-store";

type FormState = {
  name: string;
  email: string;
};

const DEFAULT_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

export default function IdentityPage() {
  const router = useRouter();
  const identity = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const hasHydrated = useAuthStore((state) => state.hasHydrated);
  const isAuthenticated = useIsAuthenticated();
  const [form, setForm] = useState<FormState>({ name: "", email: "" });
  const [apiBaseUrl, setApiBaseUrl] = useState(DEFAULT_API_BASE_URL);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (hasHydrated && isAuthenticated) {
      router.replace("/dashboard");
    }
  }, [hasHydrated, isAuthenticated, router]);

  useEffect(() => {
    if (identity) {
      setForm({ name: identity.name, email: identity.email });
    }
  }, [identity]);

  const canSubmit = useMemo(() => {
    return form.name.trim().length > 0 && form.email.trim().length > 0 && !isSubmitting;
  }, [form.email, form.name, isSubmitting]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const response = await identify(
        {
          name: form.name.trim(),
          email: form.email.trim(),
        },
        apiBaseUrl,
      );
      setUser(response);
      router.push("/dashboard");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Identity request failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden px-5 py-8 text-white">
      <CyberBackground />
      <section className="relative mx-auto grid min-h-[calc(100vh-4rem)] w-full max-w-6xl items-center gap-10 lg:grid-cols-[1fr_440px]">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55 }}
          className="max-w-2xl"
        >
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 text-sm text-cyan-100 shadow-[0_0_32px_rgba(34,211,238,0.18)]">
            <Sparkles className="h-4 w-4" />
            Real-time AI creative battle
          </div>
          <h1 className="text-5xl font-black leading-tight tracking-tight sm:text-7xl">
            PromptClash <span className="text-cyan-300">AI</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-8 text-slate-300">
            Enter your player identity, launch a room, submit prompts, watch async AI jobs resolve live, and score the
            strongest generated ideas.
          </p>

          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            {[
              ["No auth tax", "Local identity only"],
              ["Live room sync", "WebSocket deltas"],
              ["Backend truth", "Refresh rehydrates"],
            ].map(([title, body], index) => (
              <motion.div
                key={title}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.12 + index * 0.08 }}
                className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 backdrop-blur"
              >
                <p className="font-semibold">{title}</p>
                <p className="mt-1 text-sm text-slate-400">{body}</p>
              </motion.div>
            ))}
          </div>
        </motion.div>

        <motion.section
          initial={{ opacity: 0, scale: 0.98, y: 18 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.08 }}
          className="rounded-3xl border border-cyan-300/20 bg-slate-950/75 p-6 shadow-[0_0_90px_rgba(34,211,238,0.18)] backdrop-blur-xl"
        >
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-normal text-cyan-300">Identity uplink</p>
              <h2 className="mt-1 text-2xl font-bold">Enter the arena</h2>
            </div>
            <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-3 text-cyan-200">
              <Shield className="h-6 w-6" />
            </div>
          </div>

          <form className="grid gap-4" onSubmit={handleSubmit}>
            <FieldIcon icon={<Orbit className="h-4 w-4" />}>
              <input
                className="h-12 w-full bg-transparent px-3 text-sm text-white outline-none placeholder:text-slate-500"
                value={apiBaseUrl}
                onChange={(event) => setApiBaseUrl(event.target.value)}
                placeholder="http://127.0.0.1:8000"
              />
            </FieldIcon>
            <FieldIcon icon={<UserRound className="h-4 w-4" />}>
              <input
                className="h-12 w-full bg-transparent px-3 text-sm text-white outline-none placeholder:text-slate-500"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Player name"
                autoComplete="name"
              />
            </FieldIcon>
            <FieldIcon icon={<Mail className="h-4 w-4" />}>
              <input
                className="h-12 w-full bg-transparent px-3 text-sm text-white outline-none placeholder:text-slate-500"
                value={form.email}
                onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                placeholder="you@example.com"
                type="email"
                autoComplete="email"
              />
            </FieldIcon>

            <motion.button
              whileHover={{ scale: canSubmit ? 1.02 : 1 }}
              whileTap={{ scale: canSubmit ? 0.98 : 1 }}
              disabled={!canSubmit}
              className="mt-2 flex h-12 items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 font-bold text-slate-950 shadow-[0_0_44px_rgba(34,211,238,0.34)] transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
              type="submit"
            >
              {isSubmitting ? "Saving identity..." : "Continue to lobby"}
              <ArrowRight className="h-4 w-4" />
            </motion.button>
          </form>

          {hasHydrated && identity ? (
            <p className="mt-4 rounded-xl border border-emerald-300/20 bg-emerald-300/10 px-3 py-2 text-sm text-emerald-100">
              Saved as {identity.name}. Submit to refresh backend identity or continue.
            </p>
          ) : null}
          {error ? <p className="mt-4 whitespace-pre-wrap rounded-xl border border-rose-300/20 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">{error}</p> : null}
        </motion.section>
      </section>
    </main>
  );
}

function FieldIcon({ children, icon }: { children: ReactNode; icon: ReactNode }) {
  return (
    <label className="flex items-center rounded-xl border border-white/10 bg-white/[0.06] text-slate-400 ring-cyan-300/20 transition focus-within:border-cyan-300/50 focus-within:ring-4">
      <span className="pl-3">{icon}</span>
      {children}
    </label>
  );
}

function CyberBackground() {
  return (
    <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
      <div className="arena-grid absolute inset-x-0 bottom-[-12rem] h-[42rem] rotate-180 opacity-80" />
      <div className="scanline absolute inset-x-0 top-0 h-1/2" />
      <div className="cursor-glow absolute left-1/3 top-10 h-[38rem] w-[38rem] -translate-x-1/2 rounded-full blur-3xl" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0,rgba(5,8,22,0.62)_54%,rgba(5,8,22,0.98)_100%)]" />
    </div>
  );
}
