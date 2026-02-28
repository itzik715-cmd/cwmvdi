import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useSession } from "../hooks/useSession";
import { desktopsApi } from "../services/api";
import type { User } from "../types";

interface Props {
  user: User;
}

export default function Connecting({ user }: Props) {
  const { desktopId } = useParams<{ desktopId: string }>();
  const navigate = useNavigate();
  const { connect, error, result } = useSession();
  const [phase, setPhase] = useState<"starting" | "auth" | "connected" | "error">("starting");
  const [guacClientUrl, setGuacClientUrl] = useState<string | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!desktopId) return;

    const run = async () => {
      try {
        setPhase("starting");
        const data = await connect(desktopId);
        if (!data?.guacamole_token) {
          setPhase("error");
          return;
        }

        // Exchange encrypted JSON token for Guacamole auth token
        setPhase("auth");
        const formData = new URLSearchParams();
        formData.append("data", data.guacamole_token);

        const tokenResp = await fetch(`${data.guacamole_url}/api/tokens`, {
          method: "POST",
          body: formData,
        });

        if (!tokenResp.ok) {
          throw new Error("Guacamole authentication failed");
        }

        const tokenData = await tokenResp.json();
        const authToken = tokenData.authToken;

        // Build the connection client identifier
        // Guacamole format: BASE64(connectionName + \0 + c + \0 + json)
        const connectionName = `kamvdi-${desktopId}`;
        const clientId = btoa(`${connectionName}\0c\0json`);

        const url = `${data.guacamole_url}/#/client/${encodeURIComponent(clientId)}?token=${encodeURIComponent(authToken)}`;
        setGuacClientUrl(url);
        setPhase("connected");

        // Start heartbeat
        heartbeatRef.current = setInterval(() => {
          desktopsApi.heartbeat(data.session_id).catch(() => {});
        }, 60_000);
      } catch {
        setPhase("error");
      }
    };

    run();

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, [desktopId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDisconnect = async () => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    if (desktopId) {
      await desktopsApi.disconnect(desktopId).catch(() => {});
    }
    navigate("/");
  };

  if (phase === "starting" || phase === "auth") {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 24,
        }}
      >
        <div className="spinner" />
        <h2 style={{ fontSize: 20 }}>
          {phase === "starting" ? "Starting your desktop..." : "Connecting to remote session..."}
        </h2>
        <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
          This may take up to 3 minutes if your desktop was off.
        </p>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 24,
        }}
      >
        <h2 style={{ fontSize: 20 }}>Connection failed</h2>
        <p className="error-msg" style={{ fontSize: 15, marginBottom: 16 }}>{error || "Unknown error"}</p>
        <button className="btn-primary" onClick={() => navigate("/")}>
          Back to Dashboard
        </button>
      </div>
    );
  }

  // Connected — show Guacamole iframe
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Header bar */}
      <div
        style={{
          height: 44,
          background: "#1a1a2e",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 16px",
          flexShrink: 0,
        }}
      >
        <span style={{ color: "#fff", fontSize: 14, fontWeight: 500 }}>
          {result?.desktop_name || "Remote Desktop"}
        </span>
        <button
          onClick={handleDisconnect}
          style={{
            background: "#dc2626",
            color: "#fff",
            border: "none",
            padding: "6px 16px",
            borderRadius: 6,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Disconnect
        </button>
      </div>
      {/* Guacamole iframe */}
      <iframe
        src={guacClientUrl || ""}
        style={{ flex: 1, width: "100%", border: "none" }}
        allow="clipboard-read; clipboard-write"
        title="Remote Desktop"
      />
    </div>
  );
}
