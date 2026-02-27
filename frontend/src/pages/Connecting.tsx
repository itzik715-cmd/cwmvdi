import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useSession } from "../hooks/useSession";
import type { User } from "../types";

interface Props {
  user: User;
}

export default function Connecting({ user }: Props) {
  const { desktopId } = useParams<{ desktopId: string }>();
  const navigate = useNavigate();
  const { connect, connecting, error, result } = useSession();
  const [phase, setPhase] = useState<"starting" | "tunneling" | "launching" | "done" | "error">("starting");

  useEffect(() => {
    if (!desktopId) return;

    const run = async () => {
      try {
        setPhase("starting");
        // This call powers on the VM, authorizes Boundary, and returns the URI
        await connect(desktopId);
        setPhase("launching");

        // Give time for the agent to pick up the URI
        setTimeout(() => {
          setPhase("done");
          setTimeout(() => navigate("/"), 3000);
        }, 3000);
      } catch {
        setPhase("error");
      }
    };

    run();
  }, [desktopId]); // eslint-disable-line react-hooks/exhaustive-deps

  const messages = {
    starting: "Starting your desktop...",
    tunneling: "Establishing secure tunnel...",
    launching: "Opening RDP client...",
    done: "Connected! Redirecting to dashboard...",
    error: "Connection failed",
  };

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
      {phase !== "error" && phase !== "done" && <div className="spinner" />}

      {phase === "done" && (
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: "50%",
            background: "rgba(34,197,94,0.15)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 32,
          }}
        >
          &#10003;
        </div>
      )}

      <h2 style={{ fontSize: 20 }}>{messages[phase]}</h2>

      {phase === "starting" && (
        <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
          This may take up to 3 minutes if your desktop was off.
        </p>
      )}

      {error && (
        <div style={{ textAlign: "center" }}>
          <p className="error-msg" style={{ fontSize: 15, marginBottom: 16 }}>{error}</p>
          <button className="btn-primary" onClick={() => navigate("/")}>
            Back to Dashboard
          </button>
        </div>
      )}

      {result && phase === "launching" && (
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
          Session: {result.session_id.slice(0, 8)}...
        </p>
      )}
    </div>
  );
}
