import { useState, useEffect } from "react";
import { adminApi } from "../../services/api";
import type { TenantSettings } from "../../types";

export default function Settings() {
  const [settings, setSettings] = useState<TenantSettings | null>(null);
  const [suspendMinutes, setSuspendMinutes] = useState(30);
  const [maxHours, setMaxHours] = useState(12);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // CloudWM state
  const [cwmUrl, setCwmUrl] = useState("");
  const [cwmClientId, setCwmClientId] = useState("");
  const [cwmSecret, setCwmSecret] = useState("");
  const [cwmSaving, setCwmSaving] = useState(false);
  const [cwmSaved, setCwmSaved] = useState(false);
  const [cwmError, setCwmError] = useState<string | null>(null);
  const [cwmTesting, setCwmTesting] = useState(false);
  const [cwmTestResult, setCwmTestResult] = useState<string | null>(null);

  useEffect(() => {
    adminApi.getSettings().then((res) => {
      setSettings(res.data);
      setSuspendMinutes(res.data.suspend_threshold_minutes);
      setMaxHours(res.data.max_session_hours);
      setCwmUrl(res.data.cloudwm_api_url || "");
      setCwmClientId(res.data.cloudwm_client_id || "");
    });
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await adminApi.updateSettings({
        suspend_threshold_minutes: suspendMinutes,
        max_session_hours: maxHours,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const handleCwmTest = async () => {
    setCwmTesting(true);
    setCwmTestResult(null);
    setCwmError(null);
    try {
      await adminApi.testCloudWM({ api_url: cwmUrl, client_id: cwmClientId, secret: cwmSecret });
      setCwmTestResult("Connection successful");
      setTimeout(() => setCwmTestResult(null), 5000);
    } catch (err: any) {
      setCwmError(err.response?.data?.detail || "Connection test failed");
    } finally {
      setCwmTesting(false);
    }
  };

  const handleCwmSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cwmSecret) {
      setCwmError("Secret is required");
      return;
    }
    setCwmSaving(true);
    setCwmError(null);
    setCwmSaved(false);
    try {
      await adminApi.updateCloudWM({ api_url: cwmUrl, client_id: cwmClientId, secret: cwmSecret });
      setCwmSaved(true);
      setCwmSecret("");
      setTimeout(() => setCwmSaved(false), 3000);
    } catch (err: any) {
      setCwmError(err.response?.data?.detail || "Failed to save CloudWM settings");
    } finally {
      setCwmSaving(false);
    }
  };

  if (!settings) {
    return (
      <div style={{ display: "flex", justifyContent: "center", marginTop: 80 }}>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1>Settings</h1>
      </div>

      {/* Session Settings */}
      <div className="card" style={{ maxWidth: 560, marginBottom: 24 }}>
        <h3 style={{ marginBottom: 4 }}>{settings.tenant_name}</h3>
        <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 24 }}>
          Tenant: {settings.tenant_slug}
        </p>

        <form onSubmit={handleSave}>
          <div className="form-group">
            <label>Auto-Suspend Threshold (minutes)</label>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
              Desktops will be suspended after this many minutes without a heartbeat.
            </p>
            <select
              value={suspendMinutes}
              onChange={(e) => setSuspendMinutes(Number(e.target.value))}
            >
              <option value={10}>10 minutes</option>
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes</option>
              <option value={60}>1 hour</option>
              <option value={120}>2 hours</option>
            </select>
          </div>

          <div className="form-group">
            <label>Max Session Duration (hours)</label>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
              Sessions will be automatically terminated after this duration.
            </p>
            <select
              value={maxHours}
              onChange={(e) => setMaxHours(Number(e.target.value))}
            >
              <option value={4}>4 hours</option>
              <option value={8}>8 hours</option>
              <option value={12}>12 hours</option>
              <option value={24}>24 hours</option>
              <option value={48}>48 hours</option>
            </select>
          </div>

          {error && <p className="error-msg">{error}</p>}
          {saved && (
            <p style={{ color: "var(--success)", fontSize: 13, marginBottom: 8 }}>
              Settings saved successfully.
            </p>
          )}

          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? "Saving..." : "Save Settings"}
          </button>
        </form>
      </div>

      {/* CloudWM API Settings */}
      <div className="card" style={{ maxWidth: 560 }}>
        <h3 style={{ marginBottom: 4 }}>CloudWM API</h3>
        <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 16 }}>
          Kamatera cloud management API credentials for provisioning and managing VMs.
        </p>

        {settings.cloudwm_configured && (
          <p style={{ color: "var(--success)", fontSize: 13, marginBottom: 16 }}>
            CloudWM API is configured.
          </p>
        )}

        <form onSubmit={handleCwmSave}>
          <div className="form-group">
            <label>API URL</label>
            <input
              type="text"
              value={cwmUrl}
              onChange={(e) => setCwmUrl(e.target.value)}
              placeholder="https://console.clubvps.com/service"
            />
          </div>

          <div className="form-group">
            <label>Client ID</label>
            <input
              type="text"
              value={cwmClientId}
              onChange={(e) => setCwmClientId(e.target.value)}
              placeholder="Your Kamatera API Client ID"
            />
          </div>

          <div className="form-group">
            <label>API Secret</label>
            <input
              type="password"
              value={cwmSecret}
              onChange={(e) => setCwmSecret(e.target.value)}
              placeholder={settings.cloudwm_configured ? "••••••••  (enter new to update)" : "Your Kamatera API Secret"}
            />
          </div>

          {cwmError && <p className="error-msg">{cwmError}</p>}
          {cwmTestResult && (
            <p style={{ color: "var(--success)", fontSize: 13, marginBottom: 8 }}>
              {cwmTestResult}
            </p>
          )}
          {cwmSaved && (
            <p style={{ color: "var(--success)", fontSize: 13, marginBottom: 8 }}>
              CloudWM credentials saved successfully.
            </p>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="btn-ghost"
              onClick={handleCwmTest}
              disabled={cwmTesting || !cwmUrl || !cwmClientId || !cwmSecret}
            >
              {cwmTesting ? "Testing..." : "Test Connection"}
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={cwmSaving || !cwmUrl || !cwmClientId || !cwmSecret}
            >
              {cwmSaving ? "Saving..." : "Save Credentials"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
