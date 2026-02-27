import { useState, useEffect } from "react";

const AGENT_HEALTH_URL = "http://127.0.0.1:17715/health";

export default function AgentDownload() {
  const [detected, setDetected] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    const checkAgent = async () => {
      try {
        const resp = await fetch(AGENT_HEALTH_URL, {
          signal: AbortSignal.timeout(2000),
        });
        if (!cancelled && resp.ok) {
          setDetected(true);
        }
      } catch {
        if (!cancelled) setDetected(false);
      }
    };

    checkAgent();

    // Re-check every 10 seconds in case the agent starts later
    const interval = setInterval(checkAgent, 10000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (detected !== false) return null;

  return (
    <div
      style={{
        background: "rgba(59,130,246,0.1)",
        border: "1px solid var(--primary)",
        borderRadius: "var(--radius)",
        padding: "16px 24px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 24,
      }}
    >
      <div>
        <strong>KamVDI Agent not detected</strong>
        <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 4 }}>
          Install the agent to connect to your desktops via RDP.
        </p>
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        <a href="/downloads/KamVDI-Setup.exe" className="btn-primary" style={{ padding: "8px 16px", borderRadius: "var(--radius)", color: "white", fontWeight: 600, fontSize: 13 }}>
          Windows
        </a>
        <a href="/downloads/KamVDI.dmg" className="btn-ghost" style={{ padding: "8px 16px", borderRadius: "var(--radius)", fontSize: 13 }}>
          macOS
        </a>
      </div>
    </div>
  );
}
