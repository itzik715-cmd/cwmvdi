import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { desktopsApi } from "../services/api";
import MFAInput from "./MFAInput";
import type { Desktop, User } from "../types";

interface Props {
  desktop: Desktop;
  user: User;
}

function formatCpu(cpu: string | null): string {
  if (!cpu) return "—";
  const match = cpu.match(/^(\d+)/);
  const cores = match ? match[1] : cpu;
  return `${cores} vCPU`;
}

function formatRam(mb: number | null): string {
  if (!mb) return "—";
  if (mb >= 1024) return `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB`;
  return `${mb} MB`;
}

function formatDisk(gb: number | null): string {
  if (!gb) return "—";
  return `${gb} GB`;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

const stateConfig: Record<string, { color: string; bg: string; label: string; dot: string }> = {
  on: { color: "#22c55e", bg: "rgba(34,197,94,0.12)", label: "Running", dot: "#22c55e" },
  off: { color: "#6b7280", bg: "rgba(107,114,128,0.12)", label: "Stopped", dot: "#6b7280" },
  suspended: { color: "#f59e0b", bg: "rgba(245,158,11,0.12)", label: "Suspended", dot: "#f59e0b" },
  starting: { color: "#06b6d4", bg: "rgba(6,182,212,0.12)", label: "Starting...", dot: "#06b6d4" },
  suspending: { color: "#f59e0b", bg: "rgba(245,158,11,0.12)", label: "Suspending...", dot: "#f59e0b" },
  provisioning: { color: "#8b5cf6", bg: "rgba(139,92,246,0.12)", label: "Provisioning...", dot: "#8b5cf6" },
  error: { color: "#ef4444", bg: "rgba(239,68,68,0.12)", label: "Error", dot: "#ef4444" },
  unknown: { color: "#6b7280", bg: "rgba(107,114,128,0.12)", label: "Unknown", dot: "#6b7280" },
};

export default function DesktopCard({ desktop, user }: Props) {
  const navigate = useNavigate();
  const [rdpLoading, setRdpLoading] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [showMFA, setShowMFA] = useState<"browser" | "native" | null>(null);
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [mfaLoading, setMfaLoading] = useState(false);
  const [duoPushing, setDuoPushing] = useState(false);
  const [showDuoPasscode, setShowDuoPasscode] = useState(false);

  const mfaType = user.mfa_type || "totp";
  const needsMFA = user.mfa_bypass ? false : (mfaType === "duo" ? true : user.mfa_enabled);
  const needsMFASetup = user.mfa_bypass ? false : (mfaType === "duo" ? false : user.mfa_setup_required);

  const state = stateConfig[desktop.current_state] || stateConfig.unknown;
  const hasSpecs = desktop.vm_cpu || desktop.vm_ram_mb || desktop.vm_disk_gb;

  const handleBrowserConnect = (mfaCode?: string) => {
    navigate(`/connecting/${desktop.id}`, { state: { mfa_code: mfaCode } });
  };

  const handleBrowserClick = () => {
    if (needsMFASetup) { navigate("/mfa-setup"); return; }
    if (needsMFA) { setShowMFA("browser"); setMfaError(null); setShowDuoPasscode(false); setDuoPushing(false); return; }
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
      setTimeout(() => { document.body.removeChild(iframe); setRdpLoading(false); setShowSetup(true); }, 2000);
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to launch native RDP");
      setRdpLoading(false);
    }
  };

  const handleNativeClick = () => {
    if (needsMFASetup) { navigate("/mfa-setup"); return; }
    if (needsMFA) { setShowMFA("native"); setMfaError(null); setShowDuoPasscode(false); setDuoPushing(false); return; }
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
      try { await handleNativeRDP(code); setShowMFA(null); }
      catch { setMfaError("Connection failed"); }
      finally { setMfaLoading(false); }
    }
  };

  const handleDuoPush = () => {
    setDuoPushing(true);
    setMfaError(null);
    if (showMFA === "browser") {
      handleBrowserConnect(undefined);
      setShowMFA(null);
      setDuoPushing(false);
    } else if (showMFA === "native") {
      handleNativeRDP(undefined)
        .then(() => setShowMFA(null))
        .catch(() => setMfaError("DUO verification failed"))
        .finally(() => setDuoPushing(false));
    }
  };

  const closeMFA = () => { setShowMFA(null); setShowDuoPasscode(false); setDuoPushing(false); setMfaError(null); };

  return (
    <>
      <div className="desktop-card">
        {/* Status indicator bar at top */}
        <div className="dc-status-bar" style={{ background: state.color }} />

        <div className="dc-body">
          {/* Header row: icon + name + status */}
          <div className="dc-header">
            <div className="dc-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                <line x1="8" y1="21" x2="16" y2="21"/>
                <line x1="12" y1="17" x2="12" y2="21"/>
              </svg>
            </div>
            <div style={{ flex: 1 }}>
              <h3 className="dc-name">{desktop.display_name}</h3>
              <span className="dc-state-badge" style={{ color: state.color, background: state.bg }}>
                <span className="dc-dot" style={{ background: state.dot }} />
                {state.label}
              </span>
            </div>
          </div>

          {/* Specs grid */}
          <div className="dc-specs">
            <div className="dc-spec">
              <svg className="dc-spec-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>
              <div>
                <div className="dc-spec-label">CPU</div>
                <div className="dc-spec-value">{hasSpecs ? formatCpu(desktop.vm_cpu) : "—"}</div>
              </div>
            </div>
            <div className="dc-spec">
              <svg className="dc-spec-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 19v-8a6 6 0 0 1 12 0v8"/><rect x="2" y="19" width="20" height="2" rx="1"/></svg>
              <div>
                <div className="dc-spec-label">RAM</div>
                <div className="dc-spec-value">{hasSpecs ? formatRam(desktop.vm_ram_mb) : "—"}</div>
              </div>
            </div>
            <div className="dc-spec">
              <svg className="dc-spec-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
              <div>
                <div className="dc-spec-label">Disk</div>
                <div className="dc-spec-value">{hasSpecs ? formatDisk(desktop.vm_disk_gb) : "—"}</div>
              </div>
            </div>
          </div>

          {/* Meta info */}
          <div className="dc-meta">
            <div className="dc-meta-item">
              <span className="dc-meta-label">Last Session</span>
              <span className="dc-meta-value">{timeAgo(desktop.last_session_at)}</span>
            </div>
            <div className="dc-meta-item">
              <span className="dc-meta-label">Total Sessions</span>
              <span className="dc-meta-value">{desktop.total_sessions}</span>
            </div>
            {desktop.created_at && (
              <div className="dc-meta-item">
                <span className="dc-meta-label">Created</span>
                <span className="dc-meta-value">{new Date(desktop.created_at).toLocaleDateString()}</span>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="dc-actions">
            <button className="dc-btn-primary" onClick={handleBrowserClick}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="2" y1="12" x2="22" y2="12"/>
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
              </svg>
              Open in Browser
            </button>
            <button className="dc-btn-secondary" onClick={handleNativeClick} disabled={rdpLoading}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                <line x1="8" y1="21" x2="16" y2="21"/>
                <line x1="12" y1="17" x2="12" y2="21"/>
              </svg>
              {rdpLoading ? "Connecting..." : "Native RDP"}
            </button>
          </div>

          {showSetup && (
            <div className="dc-setup-hint">
              One-time setup required.{" "}
              <a href="/api/desktops/rdp-setup" className="dc-setup-link">Download setup file</a>
              , run it, and click "Yes" to register. Then try Native RDP again.
            </div>
          )}
        </div>
      </div>

      {/* MFA Modal — DUO */}
      {showMFA && mfaType === "duo" && (
        <div className="modal-overlay" onClick={closeMFA}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400, textAlign: "center" }}>
            <h2 style={{ marginBottom: 8 }}>DUO Verification</h2>
            <p style={{ color: "var(--text-muted)", marginBottom: 24, fontSize: 14 }}>
              Verify your identity to connect to {desktop.display_name}
            </p>
            {!showDuoPasscode ? (
              <>
                <button className="btn-primary" style={{ width: "100%", padding: 14, marginBottom: 12 }} onClick={handleDuoPush} disabled={duoPushing}>
                  {duoPushing ? "Waiting for DUO Push..." : "Send DUO Push"}
                </button>
                <button className="btn-ghost" onClick={() => setShowDuoPasscode(true)} style={{ fontSize: 13 }}>Enter Passcode Instead</button>
              </>
            ) : (
              <>
                <MFAInput onSubmit={handleMFASubmit} error={mfaError} loading={mfaLoading} />
                <button className="btn-ghost" onClick={() => setShowDuoPasscode(false)} style={{ fontSize: 13, marginTop: 12 }}>Send Push Instead</button>
              </>
            )}
            {mfaError && !showDuoPasscode && <p className="error-msg" style={{ marginTop: 12 }}>{mfaError}</p>}
            <div style={{ marginTop: 16 }}>
              <button className="btn-ghost" onClick={closeMFA} style={{ fontSize: 13 }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* MFA Modal — TOTP */}
      {showMFA && mfaType !== "duo" && (
        <div className="modal-overlay" onClick={closeMFA}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400, textAlign: "center" }}>
            <h2 style={{ marginBottom: 8 }}>MFA Verification</h2>
            <p style={{ color: "var(--text-muted)", marginBottom: 24, fontSize: 14 }}>
              Enter the 6-digit code from your authenticator app to connect to {desktop.display_name}
            </p>
            <MFAInput onSubmit={handleMFASubmit} error={mfaError} loading={mfaLoading} />
            <div style={{ marginTop: 16 }}>
              <button className="btn-ghost" onClick={closeMFA} style={{ fontSize: 13 }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
