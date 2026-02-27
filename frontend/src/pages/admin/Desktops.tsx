import { useState, useEffect } from "react";
import { adminApi } from "../../services/api";
import StatusBadge from "../../components/StatusBadge";
import type { AdminDesktop, AdminUser } from "../../types";

export default function Desktops() {
  const [desktops, setDesktops] = useState<AdminDesktop[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [showModal, setShowModal] = useState(false);

  // Dropdown data
  const [datacenters, setDatacenters] = useState<{ id: string; name: string }[]>([]);
  const [images, setImages] = useState<{ id: string; description: string; size_gb: number }[]>([]);
  const [networks, setNetworks] = useState<{ name: string; subnet: string }[]>([]);
  const [loadingImages, setLoadingImages] = useState(false);

  // Form state
  const [userId, setUserId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [datacenter, setDatacenter] = useState("");
  const [imageId, setImageId] = useState("");
  const [cpu, setCpu] = useState("2B");
  const [ram, setRam] = useState(4096);
  const [diskSize, setDiskSize] = useState(50);
  const [password, setPassword] = useState("");
  const [networkName, setNetworkName] = useState("wan");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const fetchDesktops = () => {
    adminApi.listDesktops().then((res) => setDesktops(res.data));
  };

  useEffect(() => {
    fetchDesktops();
    adminApi.listUsers().then((res) => setUsers(res.data.filter((u: AdminUser) => u.is_active)));
  }, []);

  // When datacenter changes, reload images and networks
  useEffect(() => {
    if (!datacenter) return;
    setLoadingImages(true);
    setImageId("");
    setNetworkName("wan");

    Promise.all([
      adminApi.getImages(datacenter),
      adminApi.getNetworks(datacenter),
    ])
      .then(([imgRes, netRes]) => {
        setImages(imgRes.data);
        setNetworks(netRes.data);
      })
      .catch(() => {
        setImages([]);
        setNetworks([]);
      })
      .finally(() => setLoadingImages(false));
  }, [datacenter]);

  const openCreateModal = async () => {
    setShowModal(true);
    setError(null);
    setDisplayName("");
    setImageId("");
    setPassword("");
    setDatacenter("");
    setNetworkName("wan");
    setImages([]);
    setNetworks([]);

    try {
      const res = await adminApi.getDatacenters();
      setDatacenters(res.data);
    } catch {
      setDatacenters([]);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!password || password.length < 8) {
      setError("Password must be at least 8 characters");
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
        datacenter,
        password,
        network_name: networkName,
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
              <th>Boundary</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {desktops.map((d) => (
              <tr key={d.id}>
                <td style={{ fontWeight: 600 }}>{d.display_name}</td>
                <td>{d.user_email}</td>
                <td><StatusBadge state={d.current_state} /></td>
                <td style={{ fontSize: 13, color: "var(--text-muted)" }}>{d.cloudwm_server_id}</td>
                <td style={{ fontSize: 13, color: "var(--text-muted)" }}>
                  {d.boundary_target_id ? "Configured" : "Pending"}
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

      {/* Create Desktop Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" style={{ minWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <h2>Create Desktop</h2>
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
                <label>Datacenter</label>
                <select value={datacenter} onChange={(e) => setDatacenter(e.target.value)} required>
                  <option value="">Select datacenter...</option>
                  {datacenters.map((dc) => (
                    <option key={dc.id} value={dc.id}>{dc.name} ({dc.id})</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>OS Image</label>
                <select
                  value={imageId}
                  onChange={(e) => setImageId(e.target.value)}
                  required
                  disabled={!datacenter || loadingImages}
                >
                  <option value="">
                    {!datacenter ? "Select datacenter first..." : loadingImages ? "Loading images..." : "Select image..."}
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
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Strong password for RDP access"
                  required
                />
                <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                  Min 8 chars. Used for RDP login to the Windows desktop.
                </p>
              </div>

              <div className="form-group">
                <label>Network</label>
                <select
                  value={networkName}
                  onChange={(e) => setNetworkName(e.target.value)}
                  disabled={!datacenter || loadingImages}
                >
                  <option value="wan">Public (WAN)</option>
                  {networks.map((n) => (
                    <option key={n.name} value={n.name}>{n.name} — {n.subnet}</option>
                  ))}
                </select>
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
