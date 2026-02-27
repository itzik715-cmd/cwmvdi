import { useNavigate } from "react-router-dom";
import StatusBadge from "./StatusBadge";
import type { Desktop } from "../types";

interface Props {
  desktop: Desktop;
}

export default function DesktopCard({ desktop }: Props) {
  const navigate = useNavigate();

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ fontSize: 18, fontWeight: 600 }}>{desktop.display_name}</h3>
        <StatusBadge state={desktop.current_state} />
      </div>

      <div style={{ color: "var(--text-muted)", fontSize: 13 }}>
        Server: {desktop.cloudwm_server_id}
        {desktop.last_state_check && (
          <span style={{ marginLeft: 12 }}>
            Checked: {new Date(desktop.last_state_check).toLocaleTimeString()}
          </span>
        )}
      </div>

      <button
        className="btn-primary"
        style={{ width: "100%", padding: 12, fontSize: 15 }}
        onClick={() => navigate(`/connecting/${desktop.id}`)}
      >
        Connect
      </button>
    </div>
  );
}
