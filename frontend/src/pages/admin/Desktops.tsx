import { useState, useEffect } from "react";
import { adminApi, api } from "../../services/api";
import StatusBadge from "../../components/StatusBadge";
import type { AdminDesktop, AdminUser } from "../../types";

export default function Desktops() {
  const [desktops, setDesktops] = useState<AdminDesktop[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [images, setImages] = useState<{ id: string; description: string }[]>([]);

  // Form state
  const [userId, setUserId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [imageId, setImageId] = useState("");
  const [cpu, setCpu] = useState("2B");
  const [ram, setRam] = useState(4096);
  const [diskSize, setDiskSize] = useState(50);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const fetchDesktops = () => {
    adminApi.listDesktops().then((res) => setDesktops(res.data));
  };

  useEffect(() => {
    fetchDesktops();
    adminApi.listUsers().then((res) => setUsers(res.data.filter((u: AdminUser) => u.is_active)));
  }, []);

  const openCreateModal = async () => {
    setShowModal(true);
    try {
      const res = await api.get("/images");
      setImages(res.data);
    } catch {
      // ignore
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      await adminApi.createDesktop({
        user_id: userId,
        display_name: displayName,
        image_id: imageId,
        cpu,
        ram,
        disk_size: diskSize,
      });
      setShowModal(false);
      setDisplayName("");
      setImageId("");
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
          <div className="modal" style={{ minWidth: 480 }} onClick={(e) => e.stopPropagation()}>
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
                <label>Windows Image</label>
                <select value={imageId} onChange={(e) => setImageId(e.target.value)} required>
                  <option value="">Select image...</option>
                  {images
                    .filter((i) => i.description.toLowerCase().includes("windows"))
                    .map((i) => (
                      <option key={i.id} value={i.id}>{i.description}</option>
                    ))}
                  {images
                    .filter((i) => !i.description.toLowerCase().includes("windows"))
                    .map((i) => (
                      <option key={i.id} value={i.id}>{i.description}</option>
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
                  <label>RAM (MB)</label>
                  <select value={ram} onChange={(e) => setRam(Number(e.target.value))}>
                    <option value={2048}>2 GB</option>
                    <option value={4096}>4 GB</option>
                    <option value={8192}>8 GB</option>
                    <option value={16384}>16 GB</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Disk (GB)</label>
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
