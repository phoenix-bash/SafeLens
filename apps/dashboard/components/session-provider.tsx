"use client";

import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useRef,
  useState
} from "react";

import { AuthSession } from "@safelens/contracts";
import { apiRequest } from "../lib/api";

interface SessionContextValue {
  session: AuthSession | null;
  setSession: (session: AuthSession | null) => void;
  clearSession: () => Promise<void>;
  isBootstrapping: boolean;
  bootstrapError: string | null;
}

const SessionContext = createContext<SessionContextValue | null>(null);
const STORAGE_KEY = "safelens.session";

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<AuthSession | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const refreshTimeoutRef = useRef<number | null>(null);

  const persistSession = (nextSession: AuthSession | null) => {
    setSessionState(nextSession);

    if (nextSession) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSession));
      return;
    }

    window.localStorage.removeItem(STORAGE_KEY);
  };

  async function refreshSession(refreshToken: string) {
    const nextSession = await apiRequest<AuthSession>("/auth/refresh", {
      method: "POST",
      body: { refreshToken },
      timeoutMs: 8_000
    });
    persistSession(nextSession);
    setBootstrapError(null);
    return nextSession;
  }

  useEffect(() => {
    let active = true;

    async function bootstrapSession() {
      const saved = window.localStorage.getItem(STORAGE_KEY);

      if (!saved) {
        if (active) {
          setBootstrapError(null);
          setIsBootstrapping(false);
        }
        return;
      }

      try {
        const parsed = JSON.parse(saved) as AuthSession;
        await refreshSession(parsed.refreshToken);
      } catch (error) {
        window.localStorage.removeItem(STORAGE_KEY);
        if (active) {
          setSessionState(null);
          setBootstrapError(
            error instanceof Error
              ? error.message
              : "Could not restore the saved SafeLens session."
          );
        }
      } finally {
        if (active) {
          setIsBootstrapping(false);
        }
      }
    }

    bootstrapSession();

    return () => {
      active = false;
    };
  }, []);

  const setSession = (nextSession: AuthSession | null) => {
    persistSession(nextSession);
  };

  useEffect(() => {
    if (refreshTimeoutRef.current) {
      window.clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = null;
    }

    if (!session) {
      return;
    }

    const refreshAt = new Date(session.expiresAt).getTime() - Date.now() - 60_000;
    const delay = Math.max(5_000, refreshAt);

    refreshTimeoutRef.current = window.setTimeout(() => {
      refreshSession(session.refreshToken).catch(() => {
        persistSession(null);
      });
    }, delay);

    return () => {
      if (refreshTimeoutRef.current) {
        window.clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
    };
  }, [session]);

  useEffect(() => {
    if (!session) {
      return;
    }

    const currentSession = session;

    async function refreshOnFocus() {
      const expiresSoon =
        new Date(currentSession.expiresAt).getTime() - Date.now() <= 2 * 60_000;

      if (!expiresSoon) {
        return;
      }

      try {
        await refreshSession(currentSession.refreshToken);
      } catch {
        persistSession(null);
      }
    }

    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnFocus);

    return () => {
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnFocus);
    };
  }, [session]);

  async function clearSession() {
    const refreshToken = session?.refreshToken;

    try {
      if (refreshToken) {
        await apiRequest<{ success: boolean }>("/auth/logout", {
          method: "POST",
          body: { refreshToken }
        });
      }
    } catch {
      // Clear the local session even if the network request fails.
    }

    persistSession(null);
  }

  return (
    <SessionContext.Provider
      value={{
        session,
        setSession,
        clearSession,
        isBootstrapping,
        bootstrapError
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const value = useContext(SessionContext);

  if (!value) {
    throw new Error("useSession must be used inside SessionProvider.");
  }

  return value;
}
