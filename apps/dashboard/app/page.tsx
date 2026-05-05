import Link from "next/link";

export default function HomePage() {
  return (
    <main className="page-shell" style={{ padding: "32px 0 48px" }}>
      <section
        className="hero-grid"
        style={{
          alignItems: "stretch",
          minHeight: "calc(100vh - 80px)"
        }}
      >
        <div
          className="glass-panel"
          style={{
            padding: 32,
            borderRadius: "32px",
            display: "grid",
            gap: 24
          }}
        >
          <span className="pill">SafeLens V1 Foundation</span>
          <div className="stack" style={{ gap: 12 }}>
            <h1 style={{ margin: 0, fontSize: "clamp(2.8rem, 7vw, 5rem)" }}>
              Device trust, pairing, and control in one clean operator surface.
            </h1>
            <p className="muted" style={{ fontSize: "1.1rem", maxWidth: 720 }}>
              The first SafeLens milestone gives every account a private workspace,
              generates six-letter pairing codes, tracks managed Android devices,
              and keeps feature modules isolated so camera, mirroring, location,
              notifications, and call logs can evolve independently.
            </p>
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link className="button-primary" href="/signup">
              Create account
            </Link>
            <Link className="button-secondary" href="/login">
              Sign in
            </Link>
            <Link className="button-secondary" href="/dashboard">
              Open dashboard
            </Link>
          </div>
        </div>

        <div className="stack">
          <div
            className="glass-panel"
            style={{ borderRadius: "32px", padding: 28, display: "grid", gap: 16 }}
          >
            <div className="pill">Core flow</div>
            <div className="card-grid">
              {[
                "Email auth + Google SSO",
                "Workspace-owned devices",
                "Live pairing updates",
                "Persistent trusted sessions"
              ].map((item) => (
                <article
                  key={item}
                  style={{
                    padding: 18,
                    borderRadius: 22,
                    background: "rgba(255,255,255,0.72)",
                    border: "1px solid var(--line)"
                  }}
                >
                  {item}
                </article>
              ))}
            </div>
          </div>

          <div
            className="glass-panel"
            style={{ borderRadius: "32px", padding: 28, display: "grid", gap: 16 }}
          >
            <div className="pill">Feature lanes</div>
            <div className="card-grid">
              {[
                "Camera Control",
                "Screen Mirroring",
                "Location",
                "Notifications",
                "Call Logs"
              ].map((feature) => (
                <article
                  key={feature}
                  style={{
                    padding: 18,
                    borderRadius: 22,
                    background: "rgba(255,255,255,0.72)",
                    border: "1px solid var(--line)"
                  }}
                >
                  <div className="status-planned">Feature shell ready</div>
                  <h3>{feature}</h3>
                  <p className="muted" style={{ marginBottom: 0 }}>
                    Isolated module boundary reserved for follow-up implementation.
                  </p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

