import { useState, useEffect } from "react";

export default function AgentDownload() {
  const [detected, setDetected] = useState<boolean | null>(null);

  useEffect(() => {
    // Try to detect if the agent is installed by attempting a ping URI.
    // If no handler is registered, the browser ignores it silently (no reliable detection).
    // We show the banner by default and let the user dismiss it.
    const timer = setTimeout(() => setDetected(false), 2000);

    // Try sending a ping — if the agent handles it, we'll know
    try {
      const iframe = document.createElement("iframe");
      iframe.style.display = "none";
      iframe.src = "kamvdi://ping";
      document.body.appendChild(iframe);
      setTimeout(() => document.body.removeChild(iframe), 1000);
    } catch {
      // Ignore
    }

    return () => clearTimeout(timer);
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
