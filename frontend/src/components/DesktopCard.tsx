import { useNavigate } from "react-router-dom";
import { desktopsApi } from "../services/api";
import StatusBadge from "./StatusBadge";
import type { Desktop } from "../types";

interface Props {
  desktop: Desktop;
}

export default function DesktopCard({ desktop }: Props) {
  const navigate = useNavigate();

  const handleDownloadRDP = async () => {
    try {
      const res = await desktopsApi.downloadRDPFile(desktop.id);
      const blob = new Blob([res.data], { type: "application/x-rdp" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${desktop.display_name.replace(/ /g, "_")}.rdp`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Failed to generate RDP file");
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
          onClick={handleDownloadRDP}
          title="Download .rdp file for native Remote Desktop client"
        >
          RDP File
        </button>
      </div>
    </div>
  );
}
