import { useState } from "react";
import { authApi } from "../services/api";
import { useBranding } from "../hooks/useBranding";
import MFAInput from "../components/MFAInput";
import type { LoginResponse } from "../types";

interface Props {
  onLogin: (user: any, token: string) => void;
  theme: "dark" | "light";
  toggleTheme: () => void;
}

export default function Login({ onLogin, theme, toggleTheme }: Props) {
  const branding = useBranding();
  const [step, setStep] = useState<"credentials" | "mfa" | "duo_push" | "duo_passcode">("credentials");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mfaToken, setMfaToken] = useState("");
  const [duoToken, setDuoToken] = useState("");
  const [duoFactors, setDuoFactors] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const completeLogin = async (accessToken: string) => {
    localStorage.setItem("token", accessToken);
    const me = await authApi.me();
    onLogin(me.data, accessToken);
  };

  const handleDuoPush = async (token?: string) => {
    setError(null);
    setLoading(true);
    try {
      const res = await authApi.verifyDuo(token || duoToken, "push");
      const data = res.data;
      if (data.access_token) {
        await completeLogin(data.access_token);
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || "DUO verification failed");
      setStep("duo_passcode");
    } finally {
      setLoading(false);
    }
  };

  const handleDuoPasscode = async (code: string) => {
    setError(null);
    setLoading(true);
    try {
      const res = await authApi.verifyDuo(duoToken, "passcode", code);
      const data = res.data;
      if (data.access_token) {
        await completeLogin(data.access_token);
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || "Invalid passcode");
    } finally {
      setLoading(false);
    }
  };

  const handleCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await authApi.login(username, password || undefined);
      const data: LoginResponse = res.data;

      if (data.requires_duo && data.duo_token) {
        setDuoToken(data.duo_token);
        setDuoFactors(data.duo_factors || []);

        if (data.duo_factors?.includes("push")) {
          setStep("duo_push");
          setLoading(false);
          handleDuoPush(data.duo_token);
        } else {
          setStep("duo_passcode");
        }
        return;
      }

      if (data.requires_mfa && data.mfa_token) {
        setMfaToken(data.mfa_token);
        setStep("mfa");
      } else if (data.access_token) {
        await completeLogin(data.access_token);
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const handleMFA = async (code: string) => {
    setError(null);
    setLoading(true);
    try {
      const res = await authApi.verifyMFA(mfaToken, code);
      const data: LoginResponse = res.data;
      if (data.access_token) {
        await completeLogin(data.access_token);
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || "Invalid code");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
      }}
    >
      {/* Theme toggle */}
      <button
        onClick={toggleTheme}
        title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        style={{
          position: "fixed",
          top: 20,
          right: 20,
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "7px 14px",
          borderRadius: 8,
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          color: "var(--text-muted)",
          fontSize: 12.5,
          fontWeight: 600,
          cursor: "pointer",
          transition: "all 0.15s",
          zIndex: 10,
        }}
      >
        {theme === "dark" ? (
          <>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5"/>
              <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
              <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
            </svg>
            Light Mode
          </>
        ) : (
          <>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>
            Dark Mode
          </>
        )}
      </button>

      <div className="card" style={{ width: 420 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          {branding.logo_url && (
            <img src={branding.logo_url} alt="" style={{ width: 72, height: 72, objectFit: "contain", marginBottom: 12 }} />
          )}
          <h1 style={{ fontSize: 28, fontWeight: 800, color: branding.brand_name ? "#3b82f6" : undefined }}>{branding.brand_name || "CwmVDI"}</h1>
          <p style={{ color: "var(--text-muted)", marginTop: 8 }}>
            Virtual Desktop Infrastructure
          </p>
        </div>

        {step === "credentials" && (
          <form onSubmit={handleCredentials}>
            <div className="form-group">
              <label>Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Username"
                autoFocus
                required
              />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
              />
            </div>
            {error && <p className="error-msg">{error}</p>}
            <button
              className="btn-primary"
              type="submit"
              disabled={loading}
              style={{ width: "100%", marginTop: 8, padding: 12 }}
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>
        )}

        {step === "mfa" && (
          <div>
            <p style={{ textAlign: "center", marginBottom: 24, color: "var(--text-muted)" }}>
              Enter the 6-digit code from Google Authenticator
            </p>
            <MFAInput onSubmit={handleMFA} error={error} loading={loading} />
          </div>
        )}

        {step === "duo_push" && (
          <div style={{ textAlign: "center" }}>
            <div className="spinner" style={{ margin: "0 auto 16px" }} />
            <h3 style={{ marginBottom: 8 }}>DUO Push Sent</h3>
            <p style={{ color: "var(--text-muted)", marginBottom: 24, fontSize: 14 }}>
              Approve the push notification on your DUO Mobile app.
            </p>
            {error && <p className="error-msg">{error}</p>}
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <button className="btn-ghost" onClick={() => handleDuoPush()} disabled={loading}>
                Resend Push
              </button>
              {duoFactors.includes("mobile_otp") && (
                <button className="btn-ghost" onClick={() => { setError(null); setStep("duo_passcode"); }}>
                  Enter Passcode
                </button>
              )}
            </div>
          </div>
        )}

        {step === "duo_passcode" && (
          <div>
            <p style={{ textAlign: "center", marginBottom: 24, color: "var(--text-muted)" }}>
              Enter a passcode from your DUO Mobile app
            </p>
            <MFAInput onSubmit={handleDuoPasscode} error={error} loading={loading} />
            {duoFactors.includes("push") && (
              <div style={{ textAlign: "center", marginTop: 16 }}>
                <button
                  className="btn-ghost"
                  onClick={() => { setError(null); setStep("duo_push"); handleDuoPush(); }}
                >
                  Send Push Instead
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
