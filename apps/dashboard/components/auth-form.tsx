"use client";

import Link from "next/link";
import { startTransition, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { AuthSession } from "@safelens/contracts";
import { apiRequest, getApiBaseUrl } from "../lib/api";
import { useSession } from "./session-provider";

const FORM_COPY = {
  login: {
    title: "Welcome back",
    subtitle: "Sign in to manage your SafeLens workspace and generate pairing codes.",
    endpoint: "/auth/login",
    submitLabel: "Sign in",
    switchLabel: "Need an account?",
    switchHref: "/signup",
    switchAction: "Create one"
  },
  signup: {
    title: "Create your workspace",
    subtitle: "Set up a private SafeLens operator account and start enrolling devices.",
    endpoint: "/auth/register",
    submitLabel: "Create account",
    switchLabel: "Already have an account?",
    switchHref: "/login",
    switchAction: "Sign in"
  }
} as const;

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const { session, setSession, isBootstrapping } = useSession();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy = FORM_COPY[mode];

  useEffect(() => {
    if (!isBootstrapping && session) {
      router.replace("/dashboard");
    }
  }, [isBootstrapping, router, session]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsPending(true);

    try {
      const body =
        mode === "signup" ? { displayName, email, password } : { email, password };
      const session = await apiRequest<AuthSession>(copy.endpoint, {
        method: "POST",
        body
      });

      startTransition(() => {
        setSession(session);
        router.push("/dashboard");
      });
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "Authentication request failed."
      );
    } finally {
      setIsPending(false);
    }
  }

  function startGoogleAuth() {
    const returnTo = encodeURIComponent(
      `${window.location.origin}/auth/callback`
    );
    window.location.href = `${getApiBaseUrl()}/auth/google/start?returnTo=${returnTo}`;
  }

  return (
    <section
      className="glass-panel"
      style={{
        borderRadius: "32px",
        padding: 28,
        maxWidth: 640,
        margin: "0 auto",
        display: "grid",
        gap: 20
      }}
    >
      <div className="stack" style={{ gap: 8 }}>
        <span className="pill">{mode === "login" ? "Sign in" : "Sign up"}</span>
        <h1 style={{ margin: 0 }}>{copy.title}</h1>
        <p className="muted" style={{ margin: 0 }}>
          {copy.subtitle}
        </p>
        {isBootstrapping ? (
          <p className="muted" style={{ margin: 0 }}>
            Restoring your last SafeLens session...
          </p>
        ) : null}
      </div>

      <form className="stack" onSubmit={onSubmit}>
        {mode === "signup" ? (
          <label className="field">
            <span>Display name</span>
            <input
              required
              minLength={2}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="SafeLens Operator"
            />
          </label>
        ) : null}

        <label className="field">
          <span>Email</span>
          <input
            required
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="owner@example.com"
          />
        </label>

        <label className="field">
          <span>Password</span>
          <input
            required
            type="password"
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="At least 8 characters"
          />
        </label>

        {error ? (
          <div
            style={{
              padding: 14,
              borderRadius: 16,
              background: "rgba(197,79,45,0.12)",
              color: "var(--accent)"
            }}
          >
            {error}
          </div>
        ) : null}

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button className="button-primary" disabled={isPending} type="submit">
            {isPending ? "Working..." : copy.submitLabel}
          </button>
          <button
            className="button-secondary"
            onClick={startGoogleAuth}
            type="button"
          >
            Continue with Google
          </button>
        </div>
      </form>

      <p className="muted" style={{ margin: 0 }}>
        {copy.switchLabel}{" "}
        <Link href={copy.switchHref} style={{ color: "var(--accent)" }}>
          {copy.switchAction}
        </Link>
      </p>
    </section>
  );
}
