import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { desktopsApi } from "../services/api";
import StatusBadge from "./StatusBadge";
import MFAInput from "./MFAInput";
import type { Desktop, User } from "../types";

interface Props {
  desktop: Desktop;
  user: User;
}

export default function DesktopCard({ desktop, user }: Props) {
  const navigate = useNavigate();
  const [rdpLoading, setRdpLoading] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [showMFA, setShowMFA] = useState<"browser" | "native" | null>(null);
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [mfaLoading, setMfaLoading] = useState(false);

  const needsMFA = user.mfa_enabled;
  const needsMFASetup = user.mfa_setup_required;

  const handleBrowserConnect = (mfaCode?: string) => {
    navigate(`/connecting/${desktop.id}`, { state: { mfa_code: mfaCode } });
  };

  const handleBrowserClick = () => {
    if (needsMFASetup) {
      navigate("/mfa-setup");
      return;
    }
    if (needsMFA) {
      setShowMFA("browser");
      setMfaError(null);
      return;
    }
    handleBrowserConnect();
  };

  const handleNativeRDP = async (mfaCode?: string) => {
    setRdpLoading(true);
    setShowSetup(false);
    try {
      const res = await desktopsApi.nativeRDP(desktop.id, mfaCode);
      const { hostname, port } = res.data;
      const uri = `cwmvdi://${hostname}:${port}`;

      const iframe = document.createElement("iframe");
      iframe.style.display = "none";
      iframe.src = uri;
      document.body.appendChild(iframe);

      setTimeout(() => {
        document.body.removeChild(iframe);
        setRdpLoading(false);
        setShowSetup(true);
      }, 2000);
    } catch (err: any) {
      const msg = err.response?.data?.detail || "Failed to launch native RDP";
      alert(msg);
      setRdpLoading(false);
    }
  };

  const handleNativeClick = () => {
    if (needsMFASetup) {
      navigate("/mfa-setup");
      return;
    }
    if (needsMFA) {
      setShowMFA("native");
      setMfaError(null);
      return;
    }
    handleNativeRDP();
  };

  const handleMFASubmit = async (code: string) => {
    setMfaLoading(true);
    setMfaError(null);
    if (showMFA === "browser") {
      handleBrowserConnect(code);
      setShowMFA(null);
      setMfaLoading(false);
    } else if (showMFA === "native") {
      try {
        await handleNativeRDP(code);
        setShowMFA(null);
      } catch {
        setMfaError("Connection failed");
      } finally {
        setMfaLoading(false);
      }
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
          onClick={handleBrowserClick}
        >
          Open in Browser
        </button>
        <button
          className="btn-ghost"
          style={{ padding: "12px 16px", fontSize: 13 }}
          onClick={handleNativeClick}
          disabled={rdpLoading}
          title="Open with native Remote Desktop client"
        >
          {rdpLoading ? "Connecting..." : "Native RDP"}
        </button>
      </div>

      {showSetup && (
        <div style={{ fontSize: 13, color: "var(--text-muted)", background: "rgba(255,255,255,0.05)", padding: "10px 12px", borderRadius: 8 }}>
          One-time setup required.{" "}
          <a
            href="/api/desktops/rdp-setup"
            style={{ color: "var(--accent)", textDecoration: "underline" }}
          >
            Download setup file
          </a>
          , run it, and click "Yes" to register. Then try Native RDP again.
        </div>
      )}

      {/* MFA Code Modal */}
      {showMFA && (
        <div className="modal-overlay" onClick={() => setShowMFA(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400, textAlign: "center" }}>
            <h2 style={{ marginBottom: 8 }}>MFA Verification</h2>
            <p style={{ color: "var(--text-muted)", marginBottom: 24, fontSize: 14 }}>
              Enter the 6-digit code from your authenticator app to connect to {desktop.display_name}
            </p>
            <MFAInput onSubmit={handleMFASubmit} error={mfaError} loading={mfaLoading} />
            <div style={{ marginTop: 16 }}>
              <button className="btn-ghost" onClick={() => setShowMFA(null)} style={{ fontSize: 13 }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
