import { useState } from "react";
import { authApi } from "../services/api";
import MFAInput from "../components/MFAInput";
import type { LoginResponse } from "../types";

interface Props {
  onLogin: (user: any, token: string) => void;
}

export default function Login({ onLogin }: Props) {
  const [step, setStep] = useState<"credentials" | "mfa">("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tenantSlug, setTenantSlug] = useState("default");
  const [mfaToken, setMfaToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await authApi.login(email, password, tenantSlug);
      const data: LoginResponse = res.data;

      if (data.requires_mfa && data.mfa_token) {
        setMfaToken(data.mfa_token);
        setStep("mfa");
      } else if (data.access_token) {
        // No MFA — get user info and log in
        localStorage.setItem("token", data.access_token);
        const me = await authApi.me();
        onLogin(me.data, data.access_token);
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
        localStorage.setItem("token", data.access_token);
        const me = await authApi.me();
        onLogin(me.data, data.access_token);
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
      }}
    >
      <div className="card" style={{ width: 420 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800 }}>CwmVDI</h1>
          <p style={{ color: "var(--text-muted)", marginTop: 8 }}>
            Virtual Desktop Infrastructure
          </p>
        </div>

        {step === "credentials" && (
          <form onSubmit={handleCredentials}>
            <div className="form-group">
              <label>Tenant</label>
              <input
                type="text"
                value={tenantSlug}
                onChange={(e) => setTenantSlug(e.target.value)}
                placeholder="Tenant slug"
              />
            </div>
            <div className="form-group">
              <label>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
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
                required
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
      </div>
    </div>
  );
}
