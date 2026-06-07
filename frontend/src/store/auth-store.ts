import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { IdentityResponse } from "@/lib/types";

type AuthState = {
  user: IdentityResponse | null;
  hasHydrated: boolean;
  setUser: (user: IdentityResponse) => void;
  clearUser: () => void;
  /** @deprecated use setUser */
  setIdentity: (user: IdentityResponse) => void;
  /** @deprecated use clearUser */
  clearIdentity: () => void;
  setHasHydrated: (hasHydrated: boolean) => void;
  isAuthenticated: () => boolean;
};

type PersistedAuthState = {
  user?: IdentityResponse | null;
  identity?: IdentityResponse | null;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      hasHydrated: false,
      setUser: (user) => set({ user }),
      clearUser: () => set({ user: null }),
      setIdentity: (user) => set({ user }),
      clearIdentity: () => set({ user: null }),
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
      isAuthenticated: () => get().user !== null,
    }),
    {
      name: "promptclash.identity",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ user: state.user }),
      version: 1,
      migrate: (persisted) => {
        if (!persisted || typeof persisted !== "object") {
          return { user: null };
        }
        const record = persisted as Record<string, unknown>;
        const inner = (record.state ?? record) as PersistedAuthState;
        return { user: inner.user ?? inner.identity ?? null };
      },
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);

export function useAuthIdentity() {
  return useAuthStore((state) => state.user);
}

export function useIsAuthenticated() {
  return useAuthStore((state) => state.user !== null);
}
