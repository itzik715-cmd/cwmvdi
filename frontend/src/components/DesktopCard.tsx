import { useNavigate } from "react-router-dom";
import { desktopsApi } from "../services/api";
import StatusBadge from "./StatusBadge";
import type { Desktop } from "../types";

interface Props {
  desktop: Desktop;
}

export default function DesktopCard({ desktop }: Props) {
  const navigate = useNavigate();

  const handleNativeRDP = async () => {
    try {
      const res = await desktopsApi.nativeRDP(desktop.id);
      const { hostname, port, username } = res.data;
      const address = `${hostname}:${port}`;
      const uri = `ms-rd:full%20address=s:${encodeURIComponent(address)}&username=s:${encodeURIComponent(username)}`;
      window.location.href = uri;
    } catch {
      alert("Failed to launch native RDP");
    }
  };

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

      <div style={{ display: "flex", gap: 8 }}>
        <button
          className="btn-primary"
          style={{ flex: 1, padding: 12, fontSize: 15 }}
          onClick={() => navigate(`/connecting/${desktop.id}`)}
        >
          Open in Browser
        </button>
        <button
          className="btn-ghost"
          style={{ padding: "12px 16px", fontSize: 13 }}
          onClick={handleNativeRDP}
          title="Open with native Remote Desktop client"
        >
          Native RDP
        </button>
      </div>
    </div>
  );
}
