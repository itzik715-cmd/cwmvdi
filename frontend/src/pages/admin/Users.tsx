import { useState, useEffect } from "react";
import { adminApi } from "../../services/api";
import type { AdminUser } from "../../types";

export default function Users() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("user");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);
  const [mfaBusyId, setMfaBusyId] = useState<string | null>(null);
  const [roleBusyId, setRoleBusyId] = useState<string | null>(null);
  const [bypassBusyId, setBypassBusyId] = useState<string | null>(null);

  // Reset password modal state
  const [resetPwUser, setResetPwUser] = useState<AdminUser | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetPwError, setResetPwError] = useState<string | null>(null);
  const [resetPwLoading, setResetPwLoading] = useState(false);

  const fetchUsers = () => {
    adminApi.listUsers().then((res) => setUsers(res.data));
  };

  useEffect(fetchUsers, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await adminApi.createUser({
        username,
        password,
        email: email || undefined,
        role,
      });
      setShowModal(false);
      setUsername("");
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
    setDeactivatingId(id);
    try {
      await adminApi.deleteUser(id);
      fetchUsers();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to deactivate user");
    } finally {
      setDeactivatingId(null);
    }
  };

  const handleMFAAction = async (id: string, action: "require" | "reset" | "disable") => {
    setMfaBusyId(id);
    try {
      if (action === "require") await adminApi.requireMFA(id);
      else if (action === "reset") await adminApi.resetMFA(id);
      else await adminApi.disableMFA(id);
      fetchUsers();
    } catch (err: any) {
      alert(err.response?.data?.detail || "MFA action failed");
    } finally {
      setMfaBusyId(null);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetPwUser) return;
    setResetPwError(null);
    setResetPwLoading(true);
    try {
      await adminApi.resetPassword(resetPwUser.id, newPassword);
      setResetPwUser(null);
      setNewPassword("");
    } catch (err: any) {
      setResetPwError(err.response?.data?.detail || "Failed to reset password");
    } finally {
      setResetPwLoading(false);
    }
  };

  const handleRoleChange = async (id: string, newRole: string) => {
    setRoleBusyId(id);
    try {
      await adminApi.updateRole(id, newRole);
      fetchUsers();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to update role");
    } finally {
      setRoleBusyId(null);
    }
  };

  const handleToggleBypass = async (id: string) => {
    setBypassBusyId(id);
    try {
      await adminApi.toggleMfaBypass(id);
      fetchUsers();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to toggle MFA bypass");
    } finally {
      setBypassBusyId(null);
    }
  };

  const getMfaStatus = (u: AdminUser): { label: string; color: string } => {
    if (u.mfa_enabled) return { label: "Active", color: "var(--success)" };
    if (u.mfa_required) return { label: "Pending Setup", color: "var(--warning)" };
    return { label: "Off", color: "var(--text-muted)" };
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
              <th>Username</th>
              <th>Email</th>
              <th>Role</th>
              <th>MFA</th>
              <th>MFA Bypass</th>
              <th>Status</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const mfa = getMfaStatus(u);
              return (
                <tr key={u.id}>
                  <td style={{ fontWeight: 600 }}>{u.username}</td>
                  <td style={{ color: u.email ? "inherit" : "var(--text-muted)" }}>
                    {u.email || "—"}
                  </td>
                  <td>
                    {u.is_active ? (
                      <select
                        value={u.role}
                        onChange={(e) => handleRoleChange(u.id, e.target.value)}
                        disabled={roleBusyId === u.id}
                        style={{
                          padding: "2px 6px",
                          fontSize: 12,
                          fontWeight: 600,
                          borderRadius: 6,
                          border: "1px solid var(--border)",
                          background: "var(--card-bg)",
                          color: "var(--text)",
                          cursor: "pointer",
                        }}
                      >
                        <option value="user">user</option>
                        <option value="admin">admin</option>
                        <option value="superadmin">superadmin</option>
                      </select>
                    ) : (
                      <span className="badge badge-on">{u.role}</span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: mfa.color, fontWeight: 600, fontSize: 12 }}>
                        {mfa.label}
                      </span>
                      {u.is_active && mfaBusyId !== u.id && (
                        <>
                          {!u.mfa_enabled && !u.mfa_required && (
                            <button
                              className="btn-ghost"
                              style={{ padding: "2px 8px", fontSize: 11 }}
                              onClick={() => handleMFAAction(u.id, "require")}
                            >
                              Require
                            </button>
                          )}
                          {u.mfa_required && !u.mfa_enabled && (
                            <button
                              className="btn-ghost"
                              style={{ padding: "2px 8px", fontSize: 11 }}
                              onClick={() => handleMFAAction(u.id, "disable")}
                            >
                              Cancel
                            </button>
                          )}
                          {u.mfa_enabled && (
                            <button
                              className="btn-ghost"
                              style={{ padding: "2px 8px", fontSize: 11 }}
                              onClick={() => handleMFAAction(u.id, "reset")}
                            >
                              Reset
                            </button>
                          )}
                        </>
                      )}
                      {mfaBusyId === u.id && (
                        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>...</span>
                      )}
                    </div>
                  </td>
                  <td>
                    {u.is_active && (
                      <button
                        className={u.mfa_bypass ? "btn-danger" : "btn-ghost"}
                        style={{ padding: "2px 10px", fontSize: 11, minWidth: 60 }}
                        onClick={() => handleToggleBypass(u.id)}
                        disabled={bypassBusyId === u.id}
                      >
                        {bypassBusyId === u.id ? "..." : u.mfa_bypass ? "On" : "Off"}
                      </button>
                    )}
                  </td>
                  <td>{u.is_active ? "Active" : "Inactive"}</td>
                  <td style={{ color: "var(--text-muted)", fontSize: 13 }}>
                    {new Date(u.created_at).toLocaleDateString()}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6 }}>
                      {u.is_active && (
                        <>
                          <button
                            className="btn-ghost"
                            style={{ padding: "4px 12px", fontSize: 12 }}
                            onClick={() => {
                              setResetPwUser(u);
                              setNewPassword("");
                              setResetPwError(null);
                            }}
                          >
                            Reset Password
                          </button>
                          <button
                            className="btn-danger"
                            style={{ padding: "4px 12px", fontSize: 12 }}
                            onClick={() => handleDelete(u.id)}
                            disabled={deactivatingId === u.id}
                          >
                            {deactivatingId === u.id ? "Deactivating..." : "Deactivate"}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
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
                <label>Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. john"
                  required
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label>Email <span style={{ color: "var(--text-muted)", fontSize: 12 }}>(optional)</span></label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="john@company.com"
                />
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

      {/* Reset Password Modal */}
      {resetPwUser && (
        <div className="modal-overlay" onClick={() => setResetPwUser(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Reset Password</h2>
            <p style={{ color: "var(--text-muted)", marginBottom: 16 }}>
              Set a new password for <strong>{resetPwUser.username}</strong>
            </p>
            <form onSubmit={handleResetPassword}>
              <div className="form-group">
                <label>New Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Minimum 8 characters"
                  required
                  autoFocus
                  minLength={8}
                />
              </div>
              {resetPwError && <p className="error-msg">{resetPwError}</p>}
              <div className="modal-actions">
                <button type="button" className="btn-ghost" onClick={() => setResetPwUser(null)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={resetPwLoading}>
                  {resetPwLoading ? "Resetting..." : "Reset Password"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
