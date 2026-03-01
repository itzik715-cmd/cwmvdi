import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useState } from "react";
import type { User } from "../../types";

interface Props {
  user: User;
  onLogout: () => void;
  theme: "dark" | "light";
  toggleTheme: () => void;
}

const navItems = [
  { to: "/admin/overview", label: "Overview", icon: "\u229E" },
  { to: "/admin/desktops", label: "Desktops", icon: "\uD83D\uDDA5" },
  { to: "/admin/users", label: "Users", icon: "\uD83D\uDC65" },
  { to: "/admin/networks", label: "Networks", icon: "\uD83C\uDF10" },
  { to: "/admin/sessions", label: "Sessions", icon: "\uD83D\uDCE1" },
  { to: "/admin/audit", label: "Audit Log", icon: "\uD83D\uDCCB" },
  { to: "/admin/settings", label: "Settings", icon: "\u2699" },
];

export default function AdminLayout({ user, onLogout, theme, toggleTheme }: Props) {
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="admin-shell">
      <aside className={`sidebar ${collapsed ? "sidebar-collapsed" : ""}`}>
        <div className="sidebar-brand" onClick={() => navigate("/")}>
          <div className="brand-icon">V</div>
          {!collapsed && (
            <div className="brand-text">
              <span className="brand-name">CwmVDI</span>
              <span className="brand-sub">Admin Console</span>
            </div>
          )}
        </div>

        <button
          className="collapse-btn"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? "\u203A" : "\u2039"}
        </button>

        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-link ${isActive ? "nav-link-active" : ""}`}
              title={collapsed ? item.label : undefined}
            >
              <span className="nav-icon">{item.icon}</span>
              {!collapsed && <span className="nav-label">{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            <span>{theme === "dark" ? "\u2600\uFE0F" : "\uD83C\uDF19"}</span>
            {!collapsed && <span>{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>}
          </button>

          {!collapsed && (
            <div className="user-pill">
              <div className="user-avatar">
                {user.username.charAt(0).toUpperCase()}
              </div>
              <div className="user-info">
                <div className="user-email">{user.username}</div>
                <div className="user-role">{user.role}</div>
              </div>
            </div>
          )}

          <div className={`footer-actions ${collapsed ? "footer-actions-collapsed" : ""}`}>
            <button className="footer-btn" onClick={() => navigate("/")} title="User Dashboard">
              <span>{"\uD83C\uDFE0"}</span>
              {!collapsed && <span>Dashboard</span>}
            </button>
            <button className="footer-btn footer-btn-danger" onClick={onLogout} title="Logout">
              <span>{"\u23FB"}</span>
              {!collapsed && <span>Logout</span>}
            </button>
          </div>
        </div>
      </aside>

      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}
