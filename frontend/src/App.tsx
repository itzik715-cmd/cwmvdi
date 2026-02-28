import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Connecting from "./pages/Connecting";
import MFASetup from "./pages/MFASetup";
import ChangePassword from "./pages/ChangePassword";
import AdminLayout from "./pages/admin/AdminLayout";
import AdminUsers from "./pages/admin/Users";
import AdminDesktops from "./pages/admin/Desktops";
import AdminSessions from "./pages/admin/Sessions";
import AdminAuditLog from "./pages/admin/AuditLog";
import AdminSettings from "./pages/admin/Settings";
import AdminNetworks from "./pages/admin/Networks";
import AdminOverview from "./pages/admin/AdminOverview";
import { api } from "./services/api";

function App() {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchUser = () => {
    api
      .get("/auth/me")
      .then((res) => setUser(res.data))
      .catch(() => {
        localStorage.removeItem("token");
        setUser(null);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) {
      fetchUser();
    } else {
      setLoading(false);
    }
  }, []);

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", marginTop: 200 }}>
        <div className="spinner" />
      </div>
    );
  }

  const handleLogin = (userData: any, token: string) => {
    localStorage.setItem("token", token);
    setUser(userData);
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    setUser(null);
  };

  if (!user) {
    return <Login onLogin={handleLogin} />;
  }

  // Force password change on first login
  if (user.must_change_password) {
    return <ChangePassword user={user} onChanged={fetchUser} />;
  }

  const isAdmin = user.role === "admin" || user.role === "superadmin";

  // Force CloudWM setup for admin users
  if (isAdmin && user.cloudwm_setup_required) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", background: "var(--bg)" }}>
        <div className="card" style={{ maxWidth: 500, textAlign: "center", padding: 40 }}>
          <h2 style={{ marginBottom: 12 }}>Setup Required</h2>
          <p style={{ color: "var(--text-muted)", marginBottom: 24 }}>
            Configure your Kamatera API connection to start managing desktops.
            Tag your system server with <strong>cwmvdi-&#123;userId&#125;</strong> in your Kamatera console first.
          </p>
          <button
            className="btn-primary"
            onClick={() => {
              setUser({ ...user, cloudwm_setup_required: false });
              navigate("/admin/settings");
            }}
          >
            Go to Settings
          </button>
          <div style={{ marginTop: 16 }}>
            <button className="btn-ghost" onClick={handleLogout}>Logout</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Dashboard user={user} onLogout={handleLogout} />} />
      <Route path="/connecting/:desktopId" element={<Connecting user={user} />} />
      <Route path="/mfa-setup" element={<MFASetup user={user} />} />
      {isAdmin && (
        <Route path="/admin" element={<AdminLayout user={user} onLogout={handleLogout} />}>
          <Route index element={<Navigate to="overview" />} />
          <Route path="overview" element={<AdminOverview />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="desktops" element={<AdminDesktops />} />
          <Route path="networks" element={<AdminNetworks />} />
          <Route path="sessions" element={<AdminSessions />} />
          <Route path="audit" element={<AdminAuditLog />} />
          <Route path="settings" element={<AdminSettings />} />
        </Route>
      )}
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}

export default App;
