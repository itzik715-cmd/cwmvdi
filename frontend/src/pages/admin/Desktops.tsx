import { useState, useEffect } from "react";
import { adminApi } from "../../services/api";
import StatusBadge from "../../components/StatusBadge";
import type { AdminDesktop, AdminUser, TenantSettings } from "../../types";

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
    if (!password || password.length < 12) {
      setError("Password must be at least 12 characters");
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

  const handleDelete = async (id: string) => {
    if (!confirm("Deactivate this desktop?")) return;
    await adminApi.deleteDesktop(id);
    fetchDesktops();
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

  // Split images: Windows first, then others
  const windowsImages = images.filter((i) => i.description.toLowerCase().includes("windows"));
  const otherImages = images.filter((i) => !i.description.toLowerCase().includes("windows"));

  return (
    <div>
      <div className="page-header">
        <h1>Desktops</h1>
        <button className="btn-primary" onClick={openCreateModal}>
          New Desktop
        </button>
      </div>

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>User</th>
              <th>Status</th>
              <th>Server ID</th>
              <th>Connection</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {desktops.map((d) => (
              <tr key={d.id}>
                <td style={{ fontWeight: 600 }}>{d.display_name}</td>
                <td
                  style={{ cursor: "pointer", color: d.user_id ? "inherit" : "var(--text-muted)" }}
                  onClick={() => openAssignModal(d)}
                  title="Click to reassign"
                >
                  {d.user_email}{" "}
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>&#9998;</span>
                </td>
                <td><StatusBadge state={d.current_state} /></td>
                <td style={{ fontSize: 13, color: "var(--text-muted)" }}>{d.cloudwm_server_id}</td>
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
                  {d.is_active && (
                    <button
                      className="btn-danger"
                      style={{ padding: "4px 12px", fontSize: 12 }}
                      onClick={() => handleDelete(d.id)}
                    >
                      Deactivate
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {desktops.length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
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
                  <option key={u.id} value={u.id}>{u.email}</option>
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
                    <option key={u.id} value={u.id}>{u.email}</option>
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
                  minLength={12}
                />
                <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                  Min 12 chars. Used for RDP login to the Windows desktop.
                </p>
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
    </div>
  );
}
