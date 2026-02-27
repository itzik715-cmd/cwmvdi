import { useState, useEffect } from "react";
import { adminApi } from "../../services/api";
import type { AdminUser } from "../../types";

export default function Users() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("user");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchUsers = () => {
    adminApi.listUsers().then((res) => setUsers(res.data));
  };

  useEffect(fetchUsers, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await adminApi.createUser({ email, password, role });
      setShowModal(false);
      setEmail("");
      setPassword("");
      setRole("user");
      fetchUsers();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to create user");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Deactivate this user?")) return;
    await adminApi.deleteUser(id);
    fetchUsers();
  };

  return (
    <div>
      <div className="page-header">
        <h1>Users</h1>
        <button className="btn-primary" onClick={() => setShowModal(true)}>
          Add User
        </button>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>MFA</th>
              <th>Status</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td><span className="badge badge-on">{u.role}</span></td>
                <td>{u.mfa_enabled ? "Enabled" : "Disabled"}</td>
                <td>{u.is_active ? "Active" : "Inactive"}</td>
                <td style={{ color: "var(--text-muted)", fontSize: 13 }}>
                  {new Date(u.created_at).toLocaleDateString()}
                </td>
                <td>
                  {u.is_active && (
                    <button
                      className="btn-danger"
                      style={{ padding: "4px 12px", fontSize: 12 }}
                      onClick={() => handleDelete(u.id)}
                    >
                      Deactivate
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create User Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Add User</h2>
            <form onSubmit={handleCreate}>
              <div className="form-group">
                <label>Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
              </div>
              <div className="form-group">
                <label>Password</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
              <div className="form-group">
                <label>Role</label>
                <select value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              {error && <p className="error-msg">{error}</p>}
              <div className="modal-actions">
                <button type="button" className="btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={loading}>
                  {loading ? "Creating..." : "Create User"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
