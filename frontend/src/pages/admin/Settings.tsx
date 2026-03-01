import { useState, useEffect, useCallback, useRef } from "react";
import { adminApi } from "../../services/api";
import { refreshBranding } from "../../hooks/useBranding";
import type { TenantSettings } from "../../types";

interface KamateraServer {
  id: string;
  name: string;
  datacenter: string;
  power: string;
}

interface SystemStatus {
  cpu: { percent: number; cores: number };
  ram: { total_gb: number; used_gb: number; available_gb: number; percent: number };
  disk: { total_gb: number; used_gb: number; free_gb: number; percent: number };
  network: { bytes_sent: number; bytes_recv: number; bytes_sent_mb: number; bytes_recv_mb: number; packets_sent: number; packets_recv: number };
  services: { name: string; status: string; healthy: boolean }[];
  uptime: string;
}

function StatusBar({ label, percent, used, total, unit }: { label: string; percent: number; used: number; total: number; unit: string }) {
  const color = percent > 90 ? "var(--error)" : percent > 70 ? "var(--warning)" : "var(--success)";
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {used} / {total} {unit} ({percent}%)
        </span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: "var(--bg-hover)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${Math.min(percent, 100)}%`, borderRadius: 4, background: color, transition: "width 0.5s ease" }} />
      </div>
    </div>
  );
}

function ServiceBadge({ name, status, healthy }: { name: string; status: string; healthy: boolean }) {
  const displayName = name.replace(/^kamvdi-|-1$/g, "");
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 500,
        background: healthy ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
        color: healthy ? "var(--success)" : "var(--error)",
        border: `1px solid ${healthy ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: healthy ? "var(--success)" : "var(--error)" }} />
      {displayName}
    </div>
  );
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

  // DUO Security state
  const [duoEnabled, setDuoEnabled] = useState(false);
  const [duoIkey, setDuoIkey] = useState("");
  const [duoSkey, setDuoSkey] = useState("");
  const [duoApiHost, setDuoApiHost] = useState("");
  const [duoAuthMode, setDuoAuthMode] = useState<"password_duo" | "duo_only">("password_duo");
  const [duoSaving, setDuoSaving] = useState(false);
  const [duoSaved, setDuoSaved] = useState(false);
  const [duoError, setDuoError] = useState<string | null>(null);
  const [duoTesting, setDuoTesting] = useState(false);
  const [duoTestResult, setDuoTestResult] = useState<string | null>(null);

  // System status state
  const [sysStatus, setSysStatus] = useState<SystemStatus | null>(null);
  const [sysLoading, setSysLoading] = useState(true);

  const fetchSystemStatus = useCallback(() => {
    adminApi.getSystemStatus()
      .then((res) => setSysStatus(res.data))
      .catch(() => {})
      .finally(() => setSysLoading(false));
  }, []);

  // NAT Gateway state
  const [natEnabled, setNatEnabled] = useState(false);
  const [gatewayIp, setGatewayIp] = useState("");
  const [defaultNetwork, setDefaultNetwork] = useState("");
  const [networks, setNetworks] = useState<{ name: string; subnet: string }[]>([]);
  const [natSaving, setNatSaving] = useState(false);
  const [natSaved, setNatSaved] = useState(false);
  const [natError, setNatError] = useState<string | null>(null);

  // Branding state
  const [brandName, setBrandName] = useState("");
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [faviconPreview, setFaviconPreview] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [faviconFile, setFaviconFile] = useState<File | null>(null);
  const [brandSaving, setBrandSaving] = useState(false);
  const [brandSaved, setBrandSaved] = useState(false);
  const [brandError, setBrandError] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const faviconInputRef = useRef<HTMLInputElement>(null);

  const loadSettings = () => {
    adminApi.getSettings().then((res) => {
      setSettings(res.data);
      setSuspendMinutes(res.data.suspend_threshold_minutes);
      setMaxHours(res.data.max_session_hours);
      setCwmUrl(res.data.cloudwm_api_url || "");
      setCwmClientId(res.data.cloudwm_client_id || "");
      setNatEnabled(res.data.nat_gateway_enabled || false);
      setGatewayIp(res.data.gateway_lan_ip || "");
      setDefaultNetwork(res.data.default_network_name || "");
      setDuoEnabled(res.data.duo_enabled || false);
      setDuoIkey(res.data.duo_ikey || "");
      setDuoApiHost(res.data.duo_api_host || "");
      setDuoAuthMode(res.data.duo_auth_mode || "password_duo");
      setBrandName(res.data.brand_name || "");
    });
    adminApi.getNetworks().then((res) => {
      setNetworks(res.data);
    }).catch(() => {});
  };

  useEffect(() => {
    loadSettings();
    fetchSystemStatus();
    const interval = setInterval(fetchSystemStatus, 10000);
    return () => clearInterval(interval);
  }, [fetchSystemStatus]);

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
        setDiscoverError('No system server found. Tag a server with "cwmvdi-{userId}" in your Kamatera console.');
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
        setDiscoverError('No system server found. Tag a server with "cwmvdi-{userId}" in your Kamatera console.');
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

  const handleNatSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setNatSaving(true);
    setNatError(null);
    setNatSaved(false);
    try {
      await adminApi.updateSettings({
        nat_gateway_enabled: natEnabled,
        gateway_lan_ip: gatewayIp || null,
        default_network_name: defaultNetwork || null,
      });
      setNatSaved(true);
      setTimeout(() => setNatSaved(false), 3000);
    } catch (err: any) {
      setNatError(err.response?.data?.detail || "Failed to save NAT settings");
    } finally {
      setNatSaving(false);
    }
  };

  const handleDuoTest = async () => {
    setDuoTesting(true);
    setDuoTestResult(null);
    setDuoError(null);
    try {
      await adminApi.testDuo({
        duo_enabled: duoEnabled,
        duo_ikey: duoIkey,
        duo_skey: duoSkey,
        duo_api_host: duoApiHost,
        duo_auth_mode: duoAuthMode,
      });
      setDuoTestResult("DUO connection successful");
      setTimeout(() => setDuoTestResult(null), 5000);
    } catch (err: any) {
      setDuoError(err.response?.data?.detail || "DUO connection test failed");
    } finally {
      setDuoTesting(false);
    }
  };

  const handleDuoSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setDuoSaving(true);
    setDuoError(null);
    setDuoSaved(false);
    try {
      await adminApi.updateDuo({
        duo_enabled: duoEnabled,
        duo_ikey: duoIkey,
        duo_skey: duoSkey,
        duo_api_host: duoApiHost,
        duo_auth_mode: duoAuthMode,
      });
      setDuoSkey("");
      setDuoSaved(true);
      loadSettings();
      setTimeout(() => setDuoSaved(false), 3000);
    } catch (err: any) {
      setDuoError(err.response?.data?.detail || "Failed to save DUO settings");
    } finally {
      setDuoSaving(false);
    }
  };

  const handleLogoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 512 * 1024) {
      setBrandError("Logo must be under 512 KB");
      return;
    }
    setLogoFile(file);
    const reader = new FileReader();
    reader.onload = () => setLogoPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleFaviconSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 256 * 1024) {
      setBrandError("Favicon must be under 256 KB");
      return;
    }
    setFaviconFile(file);
    const reader = new FileReader();
    reader.onload = () => setFaviconPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleBrandSave = async () => {
    setBrandSaving(true);
    setBrandError(null);
    setBrandSaved(false);
    try {
      const fd = new FormData();
      fd.append("brand_name", brandName);
      if (logoFile) fd.append("logo", logoFile);
      if (faviconFile) fd.append("favicon", faviconFile);
      await adminApi.updateBranding(fd);
      setBrandSaved(true);
      setLogoFile(null);
      setFaviconFile(null);
      loadSettings();
      refreshBranding();
      setTimeout(() => setBrandSaved(false), 3000);
    } catch (err: any) {
      setBrandError(err.response?.data?.detail || "Failed to save branding");
    } finally {
      setBrandSaving(false);
    }
  };

  const handleBrandReset = async () => {
    setBrandSaving(true);
    setBrandError(null);
    try {
      const fd = new FormData();
      fd.append("brand_name", "");
      fd.append("reset_logo", "true");
      fd.append("reset_favicon", "true");
      await adminApi.updateBranding(fd);
      setBrandName("");
      setLogoPreview(null);
      setFaviconPreview(null);
      setLogoFile(null);
      setFaviconFile(null);
      loadSettings();
      refreshBranding();
      setBrandSaved(true);
      setTimeout(() => setBrandSaved(false), 3000);
    } catch (err: any) {
      setBrandError(err.response?.data?.detail || "Failed to reset branding");
    } finally {
      setBrandSaving(false);
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

      {/* System Status */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>System Status</h3>
          {sysStatus && (
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Uptime: {sysStatus.uptime} &middot; Auto-refresh 10s
            </span>
          )}
        </div>

        {sysLoading && !sysStatus && (
          <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
            <div className="spinner" />
          </div>
        )}

        {sysStatus && (
          <>
            {/* Resource bars */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 24 }}>
              <div>
                <StatusBar
                  label={`CPU (${sysStatus.cpu.cores} cores)`}
                  percent={sysStatus.cpu.percent}
                  used={sysStatus.cpu.percent}
                  total={100}
                  unit="%"
                />
                <StatusBar
                  label="RAM"
                  percent={sysStatus.ram.percent}
                  used={sysStatus.ram.used_gb}
                  total={sysStatus.ram.total_gb}
                  unit="GB"
                />
              </div>
              <div>
                <StatusBar
                  label="Disk"
                  percent={sysStatus.disk.percent}
                  used={sysStatus.disk.used_gb}
                  total={sysStatus.disk.total_gb}
                  unit="GB"
                />
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>Network</span>
                  </div>
                  <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--text-muted)" }}>
                    <span>&#8593; Sent: {sysStatus.network.bytes_sent_mb > 1024 ? `${(sysStatus.network.bytes_sent_mb / 1024).toFixed(1)} GB` : `${sysStatus.network.bytes_sent_mb} MB`}</span>
                    <span>&#8595; Recv: {sysStatus.network.bytes_recv_mb > 1024 ? `${(sysStatus.network.bytes_recv_mb / 1024).toFixed(1)} GB` : `${sysStatus.network.bytes_recv_mb} MB`}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Services */}
            <div>
              <span style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 8 }}>Services</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {sysStatus.services.map((s) => (
                  <ServiceBadge key={s.name} name={s.name} status={s.status} healthy={s.healthy} />
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Session Settings */}
      <div className="card" style={{ maxWidth: 560, marginBottom: 24 }}>
        <h3 style={{ marginBottom: 16 }}>Session Policies</h3>

        <form onSubmit={handleSave}>
          <div className="form-group">
            <label>Auto-Suspend Threshold (minutes)</label>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
              Desktops will be suspended after this many minutes without a heartbeat.
            </p>
            <input
              type="number"
              min={1}
              value={suspendMinutes}
              onChange={(e) => setSuspendMinutes(Number(e.target.value))}
              style={{ width: 120 }}
            />
          </div>

          <div className="form-group">
            <label>Max Session Duration (hours)</label>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
              Sessions will be automatically terminated after this duration.
            </p>
            <input
              type="number"
              min={1}
              value={maxHours}
              onChange={(e) => setMaxHours(Number(e.target.value))}
              style={{ width: 120 }}
            />
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

      {/* Server Selection (shown when multiple cwmvdi-* servers found) */}
      {multipleServers.length > 0 && (
        <div className="card" style={{ maxWidth: 560, marginBottom: 24, borderColor: "var(--warning)" }}>
          <h3 style={{ marginBottom: 8 }}>Select System Server</h3>
          <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 16 }}>
            Multiple cwmvdi-* servers found. Select which one is your system server:
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
            No system server discovered yet. Tag your server with <strong>cwmvdi-&#123;userId&#125;</strong> in
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

      {/* NAT Gateway Settings */}
      <div className="card" style={{ maxWidth: 560, marginBottom: 24 }}>
        <h3 style={{ marginBottom: 4 }}>NAT Gateway</h3>
        <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 16 }}>
          Route all Windows VM internet traffic through this server. VMs will use a private
          VLAN and this server as their default gateway.
        </p>

        <form onSubmit={handleNatSave}>
          <div className="form-group">
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={natEnabled}
                onChange={(e) => setNatEnabled(e.target.checked)}
                style={{ width: "auto" }}
              />
              Enable NAT Gateway
            </label>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
              When enabled, new VMs will be provisioned on the private VLAN with this server as the gateway.
            </p>
          </div>

          {natEnabled && (
            <>
              <div className="form-group">
                <label>Gateway LAN IP</label>
                <input
                  type="text"
                  value={gatewayIp}
                  onChange={(e) => setGatewayIp(e.target.value)}
                  placeholder="e.g. 10.0.0.1"
                />
                <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                  The private IP of this server on the VLAN. Windows VMs will use this as their default gateway.
                </p>
              </div>

              <div className="form-group">
                <label>Default Private Network</label>
                <select
                  value={defaultNetwork}
                  onChange={(e) => setDefaultNetwork(e.target.value)}
                >
                  <option value="">Select network...</option>
                  {networks.map((n) => (
                    <option key={n.name} value={n.name}>{n.name} — {n.subnet}</option>
                  ))}
                </select>
                <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                  The Kamatera private VLAN to use for new VMs. Must be in the same datacenter.
                </p>
              </div>
            </>
          )}

          {natError && <p className="error-msg">{natError}</p>}
          {natSaved && (
            <p style={{ color: "var(--success)", fontSize: 13, marginBottom: 8 }}>
              NAT gateway settings saved.
            </p>
          )}

          <button type="submit" className="btn-primary" disabled={natSaving}>
            {natSaving ? "Saving..." : "Save NAT Settings"}
          </button>
        </form>
      </div>

      {/* DUO Security MFA */}
      <div className="card" style={{ maxWidth: 560, marginBottom: 24 }}>
        <h3 style={{ marginBottom: 4 }}>DUO Security MFA</h3>
        <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 16 }}>
          Two-factor authentication using DUO Security. When enabled, DUO replaces
          Google Authenticator (TOTP) for all users.
        </p>

        <form onSubmit={handleDuoSave}>
          <div className="form-group">
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={duoEnabled}
                onChange={(e) => setDuoEnabled(e.target.checked)}
                style={{ width: "auto" }}
              />
              Enable DUO Security
            </label>
          </div>

          {duoEnabled && (
            <>
              <div className="form-group">
                <label>Integration Key (ikey)</label>
                <input
                  type="text"
                  value={duoIkey}
                  onChange={(e) => setDuoIkey(e.target.value)}
                  placeholder="DIXXXXXXXXXXXXXXXXXX"
                />
              </div>

              <div className="form-group">
                <label>Secret Key (skey)</label>
                <input
                  type="password"
                  value={duoSkey}
                  onChange={(e) => setDuoSkey(e.target.value)}
                  placeholder={settings?.duo_configured ? "••••••••  (enter new to update)" : "Your DUO Secret Key"}
                />
              </div>

              <div className="form-group">
                <label>API Hostname</label>
                <input
                  type="text"
                  value={duoApiHost}
                  onChange={(e) => setDuoApiHost(e.target.value)}
                  placeholder="api-XXXXXXXX.duosecurity.com"
                />
              </div>

              <div className="form-group">
                <label>User Authentication Mode</label>
                <select
                  value={duoAuthMode}
                  onChange={(e) => setDuoAuthMode(e.target.value as "password_duo" | "duo_only")}
                >
                  <option value="password_duo">Password + DUO (recommended)</option>
                  <option value="duo_only">DUO Only (no password for regular users)</option>
                </select>
                <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                  {duoAuthMode === "duo_only"
                    ? "Regular users authenticate with DUO only. Admin users always require password + DUO."
                    : "All users authenticate with password + DUO verification."}
                </p>
              </div>
            </>
          )}

          {duoError && <p className="error-msg">{duoError}</p>}
          {duoTestResult && (
            <p style={{ color: "var(--success)", fontSize: 13, marginBottom: 8 }}>
              {duoTestResult}
            </p>
          )}
          {duoSaved && (
            <p style={{ color: "var(--success)", fontSize: 13, marginBottom: 8 }}>
              DUO settings saved successfully.
            </p>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            {duoEnabled && (
              <button
                type="button"
                className="btn-ghost"
                onClick={handleDuoTest}
                disabled={duoTesting || !duoIkey || !duoApiHost || (!duoSkey && !settings?.duo_configured)}
              >
                {duoTesting ? "Testing..." : "Test Connection"}
              </button>
            )}
            <button
              type="submit"
              className="btn-primary"
              disabled={duoSaving || (duoEnabled && (!duoIkey || !duoApiHost))}
            >
              {duoSaving ? "Saving..." : "Save DUO Settings"}
            </button>
          </div>
        </form>
      </div>

      {/* Branding */}
      <div className="card" style={{ maxWidth: 560, marginBottom: 24 }}>
        <h3 style={{ marginBottom: 4 }}>Branding</h3>
        <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 16 }}>
          Customize the system name, logo, and favicon shown across the portal.
        </p>

        <div className="form-group">
          <label>Brand Name</label>
          <input
            type="text"
            value={brandName}
            onChange={(e) => setBrandName(e.target.value)}
            placeholder="CwmVDI"
            maxLength={100}
          />
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
            Displayed in the header, sidebar, and login page. Leave empty for default.
          </p>
        </div>

        <div className="form-group">
          <label>Logo</label>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div
              onClick={() => logoInputRef.current?.click()}
              style={{
                width: 80,
                height: 80,
                borderRadius: 8,
                border: "2px dashed var(--border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                overflow: "hidden",
                background: "var(--bg-hover)",
              }}
            >
              {logoPreview ? (
                <img src={logoPreview} alt="Logo" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
              ) : settings.brand_logo_set ? (
                <span style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center" }}>Current<br/>logo set</span>
              ) : (
                <span style={{ fontSize: 24, color: "var(--text-muted)" }}>+</span>
              )}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              <p>Click to upload. PNG, JPG, or SVG.</p>
              <p>Max 512 KB. Recommended: 200x200px.</p>
              {(logoPreview || settings.brand_logo_set) && (
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  style={{ marginTop: 4, fontSize: 11, padding: "2px 8px" }}
                  onClick={() => { setLogoPreview(null); setLogoFile(null); }}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
          <input
            ref={logoInputRef}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml"
            onChange={handleLogoSelect}
            style={{ display: "none" }}
          />
        </div>

        <div className="form-group">
          <label>Favicon</label>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div
              onClick={() => faviconInputRef.current?.click()}
              style={{
                width: 48,
                height: 48,
                borderRadius: 6,
                border: "2px dashed var(--border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                overflow: "hidden",
                background: "var(--bg-hover)",
              }}
            >
              {faviconPreview ? (
                <img src={faviconPreview} alt="Favicon" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
              ) : settings.brand_favicon_set ? (
                <span style={{ fontSize: 9, color: "var(--text-muted)", textAlign: "center" }}>Set</span>
              ) : (
                <span style={{ fontSize: 18, color: "var(--text-muted)" }}>+</span>
              )}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              <p>Browser tab icon. PNG, JPG, ICO, or SVG.</p>
              <p>Max 256 KB. Recommended: 32x32px.</p>
            </div>
          </div>
          <input
            ref={faviconInputRef}
            type="file"
            accept="image/png,image/jpeg,image/x-icon,image/svg+xml,image/vnd.microsoft.icon"
            onChange={handleFaviconSelect}
            style={{ display: "none" }}
          />
        </div>

        {brandError && <p className="error-msg">{brandError}</p>}
        {brandSaved && (
          <p style={{ color: "var(--success)", fontSize: 13, marginBottom: 8 }}>
            Branding saved successfully.
          </p>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn-primary"
            onClick={handleBrandSave}
            disabled={brandSaving}
          >
            {brandSaving ? "Saving..." : "Save Branding"}
          </button>
          {(settings.brand_name || settings.brand_logo_set || settings.brand_favicon_set) && (
            <button
              className="btn-ghost"
              onClick={handleBrandReset}
              disabled={brandSaving}
            >
              Reset to Default
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
