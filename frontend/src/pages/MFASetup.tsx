import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { authApi } from "../services/api";
import MFAInput from "../components/MFAInput";
import type { MFASetupData, User } from "../types";

interface Props {
  user: User;
  onComplete?: () => void;
}

export default function MFASetup({ user, onComplete }: Props) {
  const navigate = useNavigate();
  const [data, setData] = useState<MFASetupData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (user.mfa_enabled) {
      navigate("/");
      return;
    }
    authApi.setupMFA().then((res) => setData(res.data)).catch(() => {});
  }, [user, navigate]);

  const handleConfirm = async (code: string) => {
    setError(null);
    setLoading(true);
    try {
      await authApi.confirmMFA(code);
      setConfirmed(true);
      if (onComplete) {
        setTimeout(() => onComplete(), 1500);
      } else {
        setTimeout(() => navigate("/"), 2000);
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || "Invalid code");
    } finally {
      setLoading(false);
    }
  };

  if (confirmed) {
    return (
      <div className="page" style={{ textAlign: "center", marginTop: 100 }}>
        <h2 style={{ color: "var(--success)" }}>MFA Enabled Successfully!</h2>
        <p style={{ color: "var(--text-muted)", marginTop: 8 }}>Redirecting...</p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div className="card" style={{ width: 440, textAlign: "center" }}>
        <h2 style={{ marginBottom: 8 }}>Set Up MFA</h2>
        <p style={{ color: "var(--text-muted)", marginBottom: 24 }}>
          Scan this QR code with Google Authenticator
        </p>

        {data && (
          <>
            <img
              src={`data:image/png;base64,${data.qr_code}`}
              alt="MFA QR Code"
              style={{ width: 200, height: 200, borderRadius: 8, margin: "0 auto 16px" }}
            />
            <p style={{ fontSize: 12, color: "var(--text-muted)", wordBreak: "break-all", marginBottom: 24 }}>
              Manual key: {data.secret}
            </p>
            <p style={{ marginBottom: 16 }}>Enter the code to confirm:</p>
            <MFAInput onSubmit={handleConfirm} error={error} loading={loading} />
          </>
        )}
      </div>
    </div>
  );
}
