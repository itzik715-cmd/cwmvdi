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

      // After 2 seconds, if still here, fall back to .rdp file download
      setTimeout(() => {
        document.body.removeChild(iframe);
        // Generate and download .rdp file as fallback
        const lines = [
          `full address:s:${address}`,
          `username:s:${username}`,
          "prompt for credentials:i:1",
          "screen mode id:i:2",
          "desktopwidth:i:1920",
          "desktopheight:i:1080",
          "session bpp:i:32",
          "compression:i:1",
          "keyboardhook:i:2",
          "audiocapturemode:i:0",
          "videoplaybackmode:i:1",
          "connection type:i:7",
          "networkautodetect:i:1",
          "bandwidthautodetect:i:1",
          "autoreconnection enabled:i:1",
        ];
        const rdpContent = lines.join("\r\n") + "\r\n";
        const blob = new Blob([rdpContent], { type: "application/x-rdp" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${desktop.display_name.replace(/ /g, "_")}.rdp`;
        a.click();
        URL.revokeObjectURL(url);
        setRdpLoading(false);
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
    </div>
  );
}
