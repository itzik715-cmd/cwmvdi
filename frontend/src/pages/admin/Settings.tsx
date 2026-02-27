import { useState, useEffect } from "react";
import { adminApi } from "../../services/api";
import type { TenantSettings } from "../../types";

interface KamateraServer {
  id: string;
  name: string;
  datacenter: string;
  power: string;
}

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

  // Discovery state
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [multipleServers, setMultipleServers] = useState<KamateraServer[]>([]);
  const [selectedServerId, setSelectedServerId] = useState("");
  const [selectingServer, setSelectingServer] = useState(false);

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  const loadSettings = () => {
    adminApi.getSettings().then((res) => {
      setSettings(res.data);
      setSuspendMinutes(res.data.suspend_threshold_minutes);
      setMaxHours(res.data.max_session_hours);
      setCwmUrl(res.data.cloudwm_api_url || "");
      setCwmClientId(res.data.cloudwm_client_id || "");
    });
  };

  useEffect(() => {
    loadSettings();
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
    setDiscoverError(null);
    setMultipleServers([]);
    try {
      const res = await adminApi.updateCloudWM({ api_url: cwmUrl, client_id: cwmClientId, secret: cwmSecret });
      setCwmSecret("");

      // Handle auto-discovery result
      const data = res.data;
      if (data.discover_status === "found") {
        setCwmSaved(true);
        loadSettings();
        setTimeout(() => setCwmSaved(false), 5000);
      } else if (data.discover_status === "multiple") {
        setMultipleServers(data.servers || []);
        setCwmSaved(true);
      } else if (data.discover_status === "no_match") {
        setDiscoverError("No system server found. Create a server named kamvdi-{userId} in your Kamatera console.");
        setCwmSaved(true);
      } else if (data.discover_status === "error") {
        setDiscoverError(`Discovery failed: ${data.detail}`);
        setCwmSaved(true);
      } else {
        setCwmSaved(true);
      }
      setTimeout(() => setCwmSaved(false), 3000);
    } catch (err: any) {
      setCwmError(err.response?.data?.detail || "Failed to save CloudWM settings");
    } finally {
      setCwmSaving(false);
    }
  };

  const handleDiscover = async () => {
    setDiscovering(true);
    setDiscoverError(null);
    setMultipleServers([]);
    try {
      const res = await adminApi.discoverServer();
      const data = res.data;
      if (data.discover_status === "found") {
        loadSettings();
      } else if (data.discover_status === "multiple") {
        setMultipleServers(data.servers || []);
      } else if (data.discover_status === "no_match") {
        setDiscoverError("No system server found. Create a server named kamvdi-{userId} in your Kamatera console.");
      } else if (data.discover_status === "error") {
        setDiscoverError(`Discovery failed: ${data.detail}`);
      }
    } catch (err: any) {
      setDiscoverError(err.response?.data?.detail || "Discovery failed");
    } finally {
      setDiscovering(false);
    }
  };

  const handleSelectServer = async () => {
    if (!selectedServerId) return;
    setSelectingServer(true);
    setDiscoverError(null);
    try {
      await adminApi.selectServer({ server_id: selectedServerId });
      setMultipleServers([]);
      loadSettings();
    } catch (err: any) {
      setDiscoverError(err.response?.data?.detail || "Failed to select server");
    } finally {
      setSelectingServer(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      await adminApi.syncFromConsole();
      setSyncResult("Sync complete");
      loadSettings();
      setTimeout(() => setSyncResult(null), 5000);
    } catch (err: any) {
      setSyncResult(`Sync failed: ${err.response?.data?.detail || "Unknown error"}`);
    } finally {
      setSyncing(false);
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
      <div className="card" style={{ maxWidth: 560, marginBottom: 24 }}>
        <h3 style={{ marginBottom: 4 }}>CloudWM API</h3>
        <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 16 }}>
          Kamatera cloud management API credentials for provisioning and managing VMs.
        </p>

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
              CloudWM credentials saved. Server discovery triggered automatically.
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

      {/* Server Selection (shown when multiple kamvdi-* servers found) */}
      {multipleServers.length > 0 && (
        <div className="card" style={{ maxWidth: 560, marginBottom: 24, borderColor: "var(--warning)" }}>
          <h3 style={{ marginBottom: 8 }}>Select System Server</h3>
          <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 16 }}>
            Multiple kamvdi-* servers found. Select which one is your system server:
          </p>
          {multipleServers.map((s) => (
            <label
              key={s.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 12px",
                borderRadius: 6,
                cursor: "pointer",
                background: selectedServerId === s.id ? "var(--bg-hover)" : "transparent",
              }}
            >
              <input
                type="radio"
                name="server"
                value={s.id}
                checked={selectedServerId === s.id}
                onChange={() => setSelectedServerId(s.id)}
              />
              <div>
                <strong>{s.name}</strong>
                <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: 8 }}>
                  DC: {s.datacenter} | {s.power}
                </span>
              </div>
            </label>
          ))}
          {discoverError && <p className="error-msg" style={{ marginTop: 8 }}>{discoverError}</p>}
          <div style={{ marginTop: 12 }}>
            <button
              className="btn-primary"
              onClick={handleSelectServer}
              disabled={!selectedServerId || selectingServer}
            >
              {selectingServer ? "Selecting..." : "Use This Server"}
            </button>
          </div>
        </div>
      )}

      {/* System Server Info & Sync */}
      {settings.system_server_id && (
        <div className="card" style={{ maxWidth: 560, marginBottom: 24 }}>
          <h3 style={{ marginBottom: 8 }}>System Server</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
            <div>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Server Name</span>
              <p style={{ fontWeight: 600 }}>{settings.system_server_name}</p>
            </div>
            <div>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Datacenter</span>
              <p style={{ fontWeight: 600 }}>{settings.locked_datacenter}</p>
            </div>
            <div>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Server ID</span>
              <p style={{ fontSize: 12, color: "var(--text-muted)" }}>{settings.system_server_id}</p>
            </div>
            <div>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Last Sync</span>
              <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {settings.last_sync_at ? new Date(settings.last_sync_at).toLocaleString() : "Never"}
              </p>
            </div>
          </div>

          {discoverError && <p className="error-msg" style={{ marginBottom: 8 }}>{discoverError}</p>}
          {syncResult && (
            <p style={{ color: syncResult.startsWith("Sync failed") ? "var(--error)" : "var(--success)", fontSize: 13, marginBottom: 8 }}>
              {syncResult}
            </p>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn-ghost"
              onClick={handleSync}
              disabled={syncing}
            >
              {syncing ? "Syncing..." : "Sync from Console"}
            </button>
            <button
              className="btn-ghost"
              onClick={handleDiscover}
              disabled={discovering}
            >
              {discovering ? "Discovering..." : "Re-discover Server"}
            </button>
          </div>
        </div>
      )}

      {/* Show discover button if no system server yet but CloudWM is configured */}
      {!settings.system_server_id && settings.cloudwm_configured && multipleServers.length === 0 && (
        <div className="card" style={{ maxWidth: 560, marginBottom: 24 }}>
          <h3 style={{ marginBottom: 8 }}>System Server</h3>
          <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 16 }}>
            No system server discovered yet. Create a server named <strong>kamvdi-&#123;userId&#125;</strong> in
            your Kamatera console, then click Discover.
          </p>
          {discoverError && <p className="error-msg" style={{ marginBottom: 8 }}>{discoverError}</p>}
          <button
            className="btn-primary"
            onClick={handleDiscover}
            disabled={discovering}
          >
            {discovering ? "Discovering..." : "Discover Server"}
          </button>
        </div>
      )}
    </div>
  );
}
