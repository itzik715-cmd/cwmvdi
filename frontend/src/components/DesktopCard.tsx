import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { desktopsApi } from "../services/api";
import StatusBadge from "./StatusBadge";
import type { Desktop } from "../types";

interface Props {
  desktop: Desktop;
}

export default function DesktopCard({ desktop }: Props) {
  const navigate = useNavigate();
  const [rdpLoading, setRdpLoading] = useState(false);
  const [showStoreLink, setShowStoreLink] = useState(false);

  const handleNativeRDP = async () => {
    setRdpLoading(true);
    try {
      const res = await desktopsApi.nativeRDP(desktop.id);
      const { hostname, port, username } = res.data;
      const address = `${hostname}:${port}`;

      // Try ms-rd: protocol first (requires Microsoft Remote Desktop Store app)
      const uri = `ms-rd:full%20address=s:${encodeURIComponent(address)}&username=s:${encodeURIComponent(username)}`;
      const iframe = document.createElement("iframe");
      iframe.style.display = "none";
      iframe.src = uri;
      document.body.appendChild(iframe);

      // After 2 seconds, if still here, ms-rd: wasn't handled — show install prompt
      setTimeout(() => {
        document.body.removeChild(iframe);
        setRdpLoading(false);
        setShowStoreLink(true);
      }, 2000);
    } catch {
      alert("Failed to launch native RDP");
      setRdpLoading(false);
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
          disabled={rdpLoading}
          title="Open with native Remote Desktop client"
        >
          {rdpLoading ? "Connecting..." : "Native RDP"}
        </button>
      </div>

      {showStoreLink && (
        <div style={{ fontSize: 13, color: "var(--text-muted)", background: "rgba(255,255,255,0.05)", padding: "10px 12px", borderRadius: 8 }}>
          Microsoft Remote Desktop app is required.{" "}
          <a
            href="https://apps.microsoft.com/detail/9wzdncrfj3ps"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--accent)", textDecoration: "underline" }}
          >
            Install from Microsoft Store
          </a>
          , then try again.
        </div>
      )}
    </div>
  );
}
