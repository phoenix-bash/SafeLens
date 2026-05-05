"use client";

import Link from "next/link";

import { DashboardShell } from "../../components/dashboard-shell";
import { useSession } from "../../components/session-provider";

export default function DashboardPage() {
  const { session, isBootstrapping, bootstrapError } = useSession();

  if (isBootstrapping) {
    return (
      <main className="page-shell" style={{ padding: "64px 0" }}>
        <section
          className="glass-panel"
          style={{ borderRadius: "32px", padding: 28, maxWidth: 720 }}
        >
          <h1 style={{ marginTop: 0 }}>Restoring session</h1>
          <p className="muted">Checking your SafeLens workspace session...</p>
        </section>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="page-shell" style={{ padding: "64px 0" }}>
        <section
          className="glass-panel"
          style={{ borderRadius: "32px", padding: 28, maxWidth: 720 }}
        >
          <h1 style={{ marginTop: 0 }}>Sign in required</h1>
          <p className="muted">
            Create an account or sign in to generate pairing codes and manage
            connected devices.
          </p>
          {bootstrapError ? (
            <p className="muted" style={{ color: "var(--accent)" }}>
              Last restore attempt failed: {bootstrapError}
            </p>
          ) : null}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link className="button-primary" href="/login">
              Sign in
            </Link>
            <Link className="button-secondary" href="/signup">
              Create account
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return <DashboardShell />;
}
