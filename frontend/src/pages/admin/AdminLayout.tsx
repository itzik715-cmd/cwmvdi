import { NavLink, Outlet, useNavigate } from "react-router-dom";
import type { User } from "../../types";

interface Props {
  user: User;
  onLogout: () => void;
}

const navItems = [
  { to: "/admin/desktops", label: "Desktops" },
  { to: "/admin/users", label: "Users" },
  { to: "/admin/networks", label: "Networks" },
  { to: "/admin/sessions", label: "Sessions" },
  { to: "/admin/audit", label: "Audit Log" },
  { to: "/admin/settings", label: "Settings" },
];

export default function AdminLayout({ user, onLogout }: Props) {
  const navigate = useNavigate();

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      {/* Sidebar */}
      <aside
        style={{
          width: 220,
          background: "var(--bg-card)",
          borderRight: "1px solid var(--border)",
          padding: "24px 0",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ padding: "0 20px", marginBottom: 32 }}>
          <h2
            style={{ fontSize: 18, fontWeight: 800, cursor: "pointer" }}
            onClick={() => navigate("/")}
          >
            CwmVDI
          </h2>
          <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
            Admin Panel
          </p>
        </div>

        <nav style={{ flex: 1 }}>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              style={({ isActive }) => ({
                display: "block",
                padding: "10px 20px",
                fontSize: 14,
                color: isActive ? "var(--primary)" : "var(--text-muted)",
                background: isActive ? "rgba(59,130,246,0.1)" : "transparent",
                borderLeft: isActive ? "3px solid var(--primary)" : "3px solid transparent",
                textDecoration: "none",
              })}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div style={{ padding: "0 20px", borderTop: "1px solid var(--border)", paddingTop: 16 }}>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>{user.username}</p>
          <button
            className="btn-ghost"
            onClick={() => navigate("/")}
            style={{ width: "100%", marginBottom: 8, padding: "6px 12px", fontSize: 12 }}
          >
            Dashboard
          </button>
          <button
            className="btn-ghost"
            onClick={onLogout}
            style={{ width: "100%", padding: "6px 12px", fontSize: 12 }}
          >
            Logout
          </button>
        </div>
      </aside>

      {/* Content */}
      <main style={{ flex: 1, padding: 32, overflowY: "auto" }}>
        <Outlet />
      </main>
    </div>
  );
}
