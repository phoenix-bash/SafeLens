"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { AuthSession } from "@safelens/contracts";
import { useSession } from "../../../components/session-provider";

function decodeSessionHash(): AuthSession | null {
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const params = new URLSearchParams(hash);
  const encoded = params.get("session");

  if (!encoded) {
    return null;
  }

  try {
    const raw = decodeURIComponent(encoded).replace(/-/g, "+").replace(/_/g, "/");
    const padded = raw + "=".repeat((4 - (raw.length % 4 || 4)) % 4);
    const binary = window.atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as AuthSession;
  } catch {
    return null;
  }
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const { setSession } = useSession();
  const [message, setMessage] = useState("Completing Google sign-in...");

  useEffect(() => {
    const session = decodeSessionHash();

    if (!session) {
      setMessage("The Google login callback did not include a SafeLens session.");
      return;
    }

    setSession(session);
    window.history.replaceState(null, "", "/auth/callback");
    router.replace("/dashboard");
  }, [router, setSession]);

  return (
    <main className="page-shell" style={{ padding: "64px 0" }}>
      <section
        className="glass-panel"
        style={{ borderRadius: "32px", padding: 28, maxWidth: 720 }}
      >
        <h1 style={{ marginTop: 0 }}>Google Sign-In</h1>
        <p className="muted">{message}</p>
      </section>
    </main>
  );
}
