import { useState, useEffect } from "react";
import { adminApi } from "../../services/api";
import StatusBadge from "../../components/StatusBadge";
import type { AdminDesktop, AdminUser, TenantSettings, DesktopUsage } from "../../types";

function formatCpu(cpu: string | null): string {
  if (!cpu) return "—";
  const match = cpu.match(/^(\d+)/);
  return match ? `${match[1]} vCPU` : cpu;
}
function formatRam(mb: number | null): string {
  if (!mb) return "—";
  return mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB` : `${mb} MB`;
}
function formatDisk(gb: number | null): string {
  if (!gb) return "—";
  return `${gb} GB`;
}

export default function Desktops() {
  const [desktops, setDesktops] = useState<AdminDesktop[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [settings, setSettings] = useState<TenantSettings | null>(null);

  // Dropdown data (from local cache)
  const [images, setImages] = useState<{ id: string; description: string; size_gb: number }[]>([]);
  const [networks, setNetworks] = useState<{ name: string; subnet: string }[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);

  // Form state
  const [userId, setUserId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [imageId, setImageId] = useState("");
  const [cpu, setCpu] = useState("2B");
  const [ram, setRam] = useState(4096);
  const [diskSize, setDiskSize] = useState(50);
  const [password, setPassword] = useState("");
  const [networkName, setNetworkName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Assign modal state
  const [assignDesktop, setAssignDesktop] = useState<AdminDesktop | null>(null);
  const [assignUserId, setAssignUserId] = useState<string>("");
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  // Import modal state
  const [showImport, setShowImport] = useState(false);
  const [unregisteredServers, setUnregisteredServers] = useState<{ id: string; name: string; power: string }[]>([]);
  const [loadingServers, setLoadingServers] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [importName, setImportName] = useState("");
  const [importUserId, setImportUserId] = useState("");
  const [importPassword, setImportPassword] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  // Terminate modal state
  const [terminateDesktop, setTerminateDesktop] = useState<AdminDesktop | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [terminateError, setTerminateError] = useState<string | null>(null);
  const [terminating, setTerminating] = useState(false);

  // Per-desktop loading state for power/activate/unregister actions
  const [busyAction, setBusyAction] = useState<Record<string, string>>({});

  // Usage drill-down modal
  const [usageDesktop, setUsageDesktop] = useState<AdminDesktop | null>(null);
  const [usageData, setUsageData] = useState<DesktopUsage | null>(null);
  const [loadingUsage, setLoadingUsage] = useState(false);

  const fetchDesktops = () => {
    adminApi.listDesktops().then((res) => setDesktops(res.data));
  };

  useEffect(() => {
    fetchDesktops();
    adminApi.listUsers().then((res) => setUsers(res.data.filter((u: AdminUser) => u.is_active)));
    adminApi.getSettings().then((res) => setSettings(res.data));
  }, []);

  // Auto-refresh while any desktop is provisioning
  useEffect(() => {
    const hasProvisioning = desktops.some((d) => d.current_state === "provisioning");
    if (!hasProvisioning) return;
    const interval = setInterval(fetchDesktops, 15000);
    return () => clearInterval(interval);
  }, [desktops]);

  const openCreateModal = async () => {
    setShowModal(true);
    setError(null);
    setDisplayName("");
    setImageId("");
    setPassword("");
    // Default to tenant's default network if NAT is enabled, otherwise "wan"
    if (settings?.nat_gateway_enabled && settings?.default_network_name) {
      setNetworkName(settings.default_network_name);
    } else {
      setNetworkName("wan");
    }

    setLoadingOptions(true);
    try {
      const [imgRes, netRes] = await Promise.all([
        adminApi.getImages(),
        adminApi.getNetworks(),
      ]);
      setImages(imgRes.data);
      setNetworks(netRes.data);
    } catch {
      setImages([]);
      setNetworks([]);
      setError("Failed to load options. Make sure server discovery and sync are complete in Settings.");
    } finally {
      setLoadingOptions(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const allowed = /^[a-zA-Z0-9!@#$^&*()~]+$/;
    if (!password || password.length < 14) {
      setError("Password must be at least 14 characters");
      return;
    }
    if (password.length > 32) {
      setError("Password must be at most 32 characters");
      return;
    }
    if (!/[a-z]/.test(password)) {
      setError("Password must contain at least one lowercase letter");
      return;
    }
    if (!/[A-Z]/.test(password)) {
      setError("Password must contain at least one uppercase letter");
      return;
    }
    if (!/[0-9]/.test(password)) {
      setError("Password must contain at least one number");
      return;
    }
    if (!allowed.test(password)) {
      setError("Password contains invalid characters. Allowed: a-z, A-Z, 0-9, !@#$^&*()~");
      return;
    }
    setCreating(true);
    try {
      await adminApi.createDesktop({
        user_id: userId,
        display_name: displayName,
        image_id: imageId,
        cpu,
        ram,
        disk_size: diskSize,
        password,
        network_name: networkName || undefined,
      });
      setShowModal(false);
      fetchDesktops();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to create desktop");
    } finally {
      setCreating(false);
    }
  };

  const handleUnregister = async (id: string) => {
    if (!confirm("Remove this desktop from the VDI system? The server will NOT be deleted.")) return;
    setBusyAction((prev) => ({ ...prev, [id]: "Removing..." }));
    try {
      await adminApi.unregisterDesktop(id);
      fetchDesktops();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to unregister");
    } finally {
      setBusyAction((prev) => { const n = { ...prev }; delete n[id]; return n; });
    }
  };

  const handleTerminate = async () => {
    if (!terminateDesktop) return;
    setTerminating(true);
    setTerminateError(null);
    try {
      await adminApi.terminateDesktop(terminateDesktop.id, mfaCode);
      setTerminateDesktop(null);
      setMfaCode("");
      fetchDesktops();
    } catch (err: any) {
      setTerminateError(err.response?.data?.detail || "Failed to terminate");
    } finally {
      setTerminating(false);
    }
  };

  const handleActivate = async (id: string) => {
    setBusyAction((prev) => ({ ...prev, [id]: "Activating..." }));
    try {
      await adminApi.activateDesktop(id);
      fetchDesktops();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to activate");
    } finally {
      setBusyAction((prev) => { const n = { ...prev }; delete n[id]; return n; });
    }
  };

  const powerLabels: Record<string, string> = {
    suspend: "Suspending...",
    resume: "Resuming...",
    power_on: "Powering on...",
    power_off: "Powering off...",
    restart: "Restarting...",
  };

  const handlePower = async (id: string, action: string) => {
    setBusyAction((prev) => ({ ...prev, [id]: powerLabels[action] || "Processing..." }));
    try {
      await adminApi.desktopPower(id, action);
      fetchDesktops();
    } catch (err: any) {
      alert(err.response?.data?.detail || `Power action '${action}' failed`);
    } finally {
      setBusyAction((prev) => { const n = { ...prev }; delete n[id]; return n; });
    }
  };

  const openAssignModal = (desktop: AdminDesktop) => {
    setAssignDesktop(desktop);
    setAssignUserId(desktop.user_id || "");
    setAssignError(null);
  };

  const handleAssign = async () => {
    if (!assignDesktop) return;
    setAssigning(true);
    setAssignError(null);
    try {
      await adminApi.updateDesktop(assignDesktop.id, {
        user_id: assignUserId || null,
      });
      setAssignDesktop(null);
      fetchDesktops();
    } catch (err: any) {
      setAssignError(err.response?.data?.detail || "Failed to update assignment");
    } finally {
      setAssigning(false);
    }
  };

  const openImportModal = async () => {
    setShowImport(true);
    setImportingId(null);
    setImportError(null);
    setLoadingServers(true);
    try {
      const res = await adminApi.getUnregisteredServers();
      setUnregisteredServers(res.data);
    } catch (err: any) {
      setImportError(err.response?.data?.detail || "Failed to load servers");
      setUnregisteredServers([]);
    } finally {
      setLoadingServers(false);
    }
  };

  const startImport = (server: { id: string; name: string }) => {
    setImportingId(server.id);
    setImportName(server.name);
    setImportUserId("");
    setImportPassword("");
    setImportError(null);
  };

  const handleImport = async () => {
    if (!importingId) return;
    setImporting(true);
    setImportError(null);
    try {
      await adminApi.importServer({
        server_id: importingId,
        display_name: importName,
        user_id: importUserId || undefined,
        password: importPassword || undefined,
      });
      setShowImport(false);
      fetchDesktops();
    } catch (err: any) {
      setImportError(err.response?.data?.detail || "Failed to import server");
    } finally {
      setImporting(false);
    }
  };

  const openUsageModal = async (desktop: AdminDesktop) => {
    setUsageDesktop(desktop);
    setUsageData(null);
    setLoadingUsage(true);
    try {
      const res = await adminApi.getDesktopUsage(desktop.id);
      setUsageData(res.data);
    } catch {
      // silent
    } finally {
      setLoadingUsage(false);
    }
  };

  // Split images: Windows first, then others
  const windowsImages = images.filter((i) => i.description.toLowerCase().includes("windows"));
  const otherImages = images.filter((i) => !i.description.toLowerCase().includes("windows"));

  return (
    <div>
      <div className="page-header">
        <h1>Desktops</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn-ghost" onClick={openImportModal}>
            Import Existing
          </button>
          <button className="btn-primary" onClick={openCreateModal}>
            New Desktop
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Specs</th>
              <th>User</th>
              <th>Status</th>
              <th>Connection</th>
              <th>Power</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {desktops.map((d) => (
              <tr key={d.id}>
                <td
                  style={{ fontWeight: 600, cursor: "pointer", color: "var(--accent)" }}
                  onClick={() => openUsageModal(d)}
                  title="Click to view usage"
                >
                  {d.display_name}
                </td>
                <td style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                  {d.vm_cpu || d.vm_ram_mb || d.vm_disk_gb ? (
                    <span>{formatCpu(d.vm_cpu)} / {formatRam(d.vm_ram_mb)} / {formatDisk(d.vm_disk_gb)}</span>
                  ) : (
                    <span>—</span>
                  )}
                </td>
                <td
                  style={{ cursor: "pointer", color: d.user_id ? "inherit" : "var(--text-muted)" }}
                  onClick={() => openAssignModal(d)}
                  title="Click to reassign"
                >
                  {d.user_email}{" "}
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>&#9998;</span>
                </td>
                <td><StatusBadge state={d.current_state} /></td>
                <td style={{ fontSize: 13 }}>
                  {d.vm_private_ip ? (
                    <span style={{ color: "var(--success)" }}>{d.vm_private_ip}</span>
                  ) : d.current_state !== "provisioning" ? (
                    <span style={{ color: "var(--text-muted)" }}>No IP</span>
                  ) : (
                    <span style={{ color: "var(--text-muted)" }}>Pending</span>
                  )}
                </td>
                <td>
                  {busyAction[d.id] ? (
                    <span style={{ fontSize: 11, color: "var(--accent)" }}>{busyAction[d.id]}</span>
                  ) : (
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {d.current_state === "on" && (
                      <>
                        <button
                          style={{ padding: "3px 8px", fontSize: 11, background: "#f59e0b", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}
                          onClick={() => handlePower(d.id, "suspend")}
                          title="Suspend"
                        >Suspend</button>
                        <button
                          style={{ padding: "3px 8px", fontSize: 11, background: "#6b7280", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}
                          onClick={() => handlePower(d.id, "power_off")}
                          title="Power Off"
                        >Power Off</button>
                        <button
                          style={{ padding: "3px 8px", fontSize: 11, background: "#3b82f6", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}
                          onClick={() => handlePower(d.id, "restart")}
                          title="Restart"
                        >Restart</button>
                      </>
                    )}
                    {d.current_state === "suspended" && (
                      <button
                        style={{ padding: "3px 8px", fontSize: 11, background: "#22c55e", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}
                        onClick={() => handlePower(d.id, "resume")}
                        title="Resume"
                      >Resume</button>
                    )}
                    {d.current_state === "off" && (
                      <button
                        style={{ padding: "3px 8px", fontSize: 11, background: "#22c55e", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}
                        onClick={() => handlePower(d.id, "power_on")}
                        title="Power On"
                      >Power On</button>
                    )}
                    {!["on", "off", "suspended"].includes(d.current_state) && (
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>—</span>
                    )}
                  </div>
                  )}
                </td>
                <td>
                  <div style={{ display: "flex", gap: 4 }}>
                    {!d.is_active && (
                      <button
                        className="btn-primary"
                        style={{ padding: "3px 8px", fontSize: 11 }}
                        onClick={() => handleActivate(d.id)}
                        disabled={!!busyAction[d.id]}
                      >Activate</button>
                    )}
                    <button
                      style={{ padding: "3px 8px", fontSize: 11, background: "#6b7280", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", opacity: busyAction[d.id] ? 0.5 : 1 }}
                      onClick={() => handleUnregister(d.id)}
                      disabled={!!busyAction[d.id]}
                    >Unregister</button>
                    <button
                      className="btn-danger"
                      style={{ padding: "3px 8px", fontSize: 11 }}
                      onClick={() => { setTerminateDesktop(d); setMfaCode(""); setTerminateError(null); }}
                      disabled={!!busyAction[d.id]}
                    >Terminate</button>
                  </div>
                </td>
              </tr>
            ))}
            {desktops.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
                  No desktops yet. Click "New Desktop" to create one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Assign User Modal */}
      {assignDesktop && (
        <div className="modal-overlay" onClick={() => setAssignDesktop(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Assign Desktop</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 16 }}>
              {assignDesktop.display_name}
            </p>
            <div className="form-group">
              <label>Assign to User</label>
              <select value={assignUserId} onChange={(e) => setAssignUserId(e.target.value)}>
                <option value="">Unassigned</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.username}</option>
                ))}
              </select>
            </div>
            {assignError && <p className="error-msg">{assignError}</p>}
            <div className="modal-actions">
              <button type="button" className="btn-ghost" onClick={() => setAssignDesktop(null)}>Cancel</button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleAssign}
                disabled={assigning}
              >
                {assigning ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Server Modal */}
      {showImport && (
        <div className="modal-overlay" onClick={() => setShowImport(false)}>
          <div className="modal" style={{ minWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <h2>Import Existing Server</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 16 }}>
              Select a Kamatera server to register as a managed desktop.
            </p>

            {loadingServers && (
              <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
                <div className="spinner" />
              </div>
            )}

            {!loadingServers && !importingId && (
              <>
                {unregisteredServers.length === 0 ? (
                  <p style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
                    No unregistered servers found.
                  </p>
                ) : (
                  <div style={{ maxHeight: 350, overflowY: "auto" }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>State</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {unregisteredServers.map((s) => (
                          <tr key={s.id}>
                            <td style={{ fontWeight: 600 }}>{s.name}</td>
                            <td>
                              <span style={{
                                fontSize: 12,
                                padding: "2px 8px",
                                borderRadius: 4,
                                background: s.power === "on" ? "rgba(34,197,94,0.15)" : "rgba(156,163,175,0.15)",
                                color: s.power === "on" ? "var(--success)" : "var(--text-muted)",
                              }}>
                                {s.power}
                              </span>
                            </td>
                            <td>
                              <button
                                className="btn-primary"
                                style={{ padding: "4px 12px", fontSize: 12 }}
                                onClick={() => startImport(s)}
                              >
                                Import
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {importingId && (
              <div>
                <div className="form-group">
                  <label>Display Name</label>
                  <input
                    value={importName}
                    onChange={(e) => setImportName(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Assign to User (optional)</label>
                  <select value={importUserId} onChange={(e) => setImportUserId(e.target.value)}>
                    <option value="">Unassigned</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>{u.username}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>VM Password (optional)</label>
                  <input
                    type="password"
                    value={importPassword}
                    onChange={(e) => setImportPassword(e.target.value)}
                    placeholder="For Guacamole auto-login"
                  />
                  <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                    If set, browser RDP will auto-login with these credentials.
                  </p>
                </div>
                {importError && <p className="error-msg">{importError}</p>}
                <div className="modal-actions">
                  <button type="button" className="btn-ghost" onClick={() => setImportingId(null)}>Back</button>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleImport}
                    disabled={importing || !importName}
                  >
                    {importing ? "Importing..." : "Import Server"}
                  </button>
                </div>
              </div>
            )}

            {!importingId && (
              <div className="modal-actions" style={{ marginTop: 16 }}>
                <button type="button" className="btn-ghost" onClick={() => setShowImport(false)}>Close</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create Desktop Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" style={{ minWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <h2>Create Desktop</h2>

            {settings?.locked_datacenter && (
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
                Datacenter: <strong>{settings.locked_datacenter}</strong> (locked to system server)
              </p>
            )}

            <form onSubmit={handleCreate}>
              <div className="form-group">
                <label>Assign to User</label>
                <select value={userId} onChange={(e) => setUserId(e.target.value)} required>
                  <option value="">Select user...</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{u.username}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Desktop Name</label>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. Development Desktop"
                  required
                />
              </div>

              <div className="form-group">
                <label>OS Image</label>
                <select
                  value={imageId}
                  onChange={(e) => setImageId(e.target.value)}
                  required
                  disabled={loadingOptions}
                >
                  <option value="">
                    {loadingOptions ? "Loading images..." : "Select image..."}
                  </option>
                  {windowsImages.length > 0 && (
                    <optgroup label="Windows">
                      {windowsImages.map((i) => (
                        <option key={i.id} value={i.id}>{i.description}</option>
                      ))}
                    </optgroup>
                  )}
                  {otherImages.length > 0 && (
                    <optgroup label="Other">
                      {otherImages.map((i) => (
                        <option key={i.id} value={i.id}>{i.description}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>

              <div className="form-group">
                <label>VM Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Strong password for RDP access"
                  required
                  minLength={14}
                  maxLength={32}
                />
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                  <p style={{ marginBottom: 2 }}>Allowed: a-z, A-Z, 0-9, !@#$^&amp;*()~</p>
                  <p style={{ margin: 0 }}>14–32 chars, must include lowercase, uppercase, and number</p>
                </div>
              </div>

              <div className="form-group">
                <label>Network</label>
                <select
                  value={networkName}
                  onChange={(e) => setNetworkName(e.target.value)}
                  disabled={loadingOptions}
                >
                  {settings?.nat_gateway_enabled && settings?.default_network_name ? (
                    <option value="">Private VLAN (NAT Gateway)</option>
                  ) : null}
                  <option value="wan">Public (WAN)</option>
                  {networks.map((n) => (
                    <option key={n.name} value={n.name}>{n.name} — {n.subnet}</option>
                  ))}
                </select>
                {settings?.nat_gateway_enabled && (
                  <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                    NAT Gateway is enabled. VMs on private VLAN will route internet through gateway ({settings.gateway_lan_ip}).
                  </p>
                )}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <div className="form-group">
                  <label>CPU</label>
                  <select value={cpu} onChange={(e) => setCpu(e.target.value)}>
                    <option value="2B">2 Cores</option>
                    <option value="4B">4 Cores</option>
                    <option value="8B">8 Cores</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>RAM</label>
                  <select value={ram} onChange={(e) => setRam(Number(e.target.value))}>
                    <option value={2048}>2 GB</option>
                    <option value={4096}>4 GB</option>
                    <option value={8192}>8 GB</option>
                    <option value={16384}>16 GB</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Disk</label>
                  <select value={diskSize} onChange={(e) => setDiskSize(Number(e.target.value))}>
                    <option value={40}>40 GB</option>
                    <option value={50}>50 GB</option>
                    <option value={80}>80 GB</option>
                    <option value={100}>100 GB</option>
                  </select>
                </div>
              </div>

              {error && <p className="error-msg">{error}</p>}
              {creating && (
                <p style={{ color: "var(--warning)", fontSize: 13, marginTop: 8 }}>
                  Creating VM... this may take a few minutes.
                </p>
              )}
              <div className="modal-actions">
                <button type="button" className="btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={creating}>
                  {creating ? "Creating..." : "Create Desktop"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Terminate Desktop Modal (MFA required) */}
      {terminateDesktop && (
        <div className="modal-overlay" onClick={() => setTerminateDesktop(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ color: "var(--danger)" }}>Terminate Server</h2>
            <p style={{ fontSize: 14, marginBottom: 8 }}>
              This will <strong>permanently destroy</strong> the server:
            </p>
            <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>
              {terminateDesktop.display_name}
            </p>
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
              Server ID: {terminateDesktop.cloudwm_server_id}
            </p>
            <p style={{ fontSize: 13, color: "var(--danger)", marginBottom: 16 }}>
              This action cannot be undone. All data on this server will be lost.
            </p>
            <div className="form-group">
              <label>Enter your MFA code to confirm</label>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))}
                placeholder="6-digit code"
                style={{ letterSpacing: 8, fontSize: 20, textAlign: "center" }}
                autoFocus
              />
            </div>
            {terminateError && <p className="error-msg">{terminateError}</p>}
            <div className="modal-actions">
              <button type="button" className="btn-ghost" onClick={() => setTerminateDesktop(null)}>Cancel</button>
              <button
                type="button"
                className="btn-danger"
                onClick={handleTerminate}
                disabled={terminating || mfaCode.length !== 6}
              >
                {terminating ? "Terminating..." : "Terminate Server"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Desktop Usage Modal */}
      {usageDesktop && (
        <div className="modal-overlay" onClick={() => setUsageDesktop(null)}>
          <div className="modal" style={{ minWidth: 660, maxHeight: "85vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
            <h2>{usageDesktop.display_name}</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 16 }}>
              {usageDesktop.user_email} &middot; {usageDesktop.cloudwm_server_id.slice(0, 12)}&hellip;
              {(usageDesktop.vm_cpu || usageDesktop.vm_ram_mb || usageDesktop.vm_disk_gb) && (
                <span> &middot; {formatCpu(usageDesktop.vm_cpu)} / {formatRam(usageDesktop.vm_ram_mb)} / {formatDisk(usageDesktop.vm_disk_gb)}</span>
              )}
            </p>

            {loadingUsage && (
              <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
                <div className="spinner" />
              </div>
            )}

            {usageData && (
              <>
                {/* Usage period cards */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 16 }}>
                  {([
                    { label: "Last 24h", data: usageData.last_24h },
                    { label: "Last 7 Days", data: usageData.last_7d },
                    { label: "Last 30 Days", data: usageData.last_30d },
                  ] as const).map((p) => (
                    <div key={p.label} className="card" style={{ padding: 14, textAlign: "center" }}>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{p.label}</div>
                      <div style={{ fontSize: 22, fontWeight: 700 }}>{p.data.hours}h</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{p.data.session_count} sessions</div>
                    </div>
                  ))}
                </div>

                {/* Month comparison */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
                  <div className="card" style={{ padding: 14 }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>This Month</div>
                    <div style={{ fontSize: 22, fontWeight: 700 }}>{usageData.current_month.hours}h</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{usageData.current_month.session_count} sessions</div>
                  </div>
                  <div className="card" style={{ padding: 14 }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Last Month</div>
                    <div style={{ fontSize: 22, fontWeight: 700 }}>{usageData.previous_month.hours}h</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{usageData.previous_month.session_count} sessions</div>
                    {usageData.month_over_month_change !== null && (
                      <div style={{
                        fontSize: 12, marginTop: 4, fontWeight: 600,
                        color: usageData.month_over_month_change >= 0 ? "var(--success)" : "var(--danger)",
                      }}>
                        {usageData.month_over_month_change >= 0 ? "+" : ""}{usageData.month_over_month_change}% vs this month
                      </div>
                    )}
                  </div>
                </div>

                {/* Recent sessions */}
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Recent Sessions</div>
                <div style={{ maxHeight: 260, overflowY: "auto" }}>
                  <table>
                    <thead>
                      <tr>
                        <th>User</th>
                        <th>Started</th>
                        <th>Duration</th>
                        <th>Type</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usageData.recent_sessions.map((s) => (
                        <tr key={s.session_id}>
                          <td style={{ fontSize: 13 }}>{s.user}</td>
                          <td style={{ fontSize: 12, color: "var(--text-muted)" }}>
                            {new Date(s.started_at).toLocaleString()}
                          </td>
                          <td style={{ fontSize: 13, fontWeight: 600 }}>{s.duration_hours}h</td>
                          <td style={{ fontSize: 12 }}>
                            <span style={{
                              padding: "2px 6px", borderRadius: 4, fontSize: 11,
                              background: s.connection_type === "native" ? "rgba(59,130,246,0.12)" : "rgba(139,92,246,0.12)",
                              color: s.connection_type === "native" ? "#3b82f6" : "#8b5cf6",
                            }}>
                              {s.connection_type === "native" ? "RDP" : "Browser"}
                            </span>
                          </td>
                          <td style={{ fontSize: 12, color: "var(--text-muted)" }}>
                            {s.end_reason ? s.end_reason.replace(/_/g, " ") : s.ended_at ? "ended" : "Active"}
                          </td>
                        </tr>
                      ))}
                      {usageData.recent_sessions.length === 0 && (
                        <tr>
                          <td colSpan={5} style={{ textAlign: "center", padding: 20, color: "var(--text-muted)" }}>
                            No sessions recorded
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button type="button" className="btn-ghost" onClick={() => setUsageDesktop(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
