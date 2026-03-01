import { Link } from "react-router-dom";
import { useDesktops } from "../hooks/useDesktops";
import DesktopCard from "../components/DesktopCard";
import type { User } from "../types";

interface Props {
  user: User;
  onLogout: () => void;
  theme: "dark" | "light";
  toggleTheme: () => void;
}

export default function Dashboard({ user, onLogout, theme, toggleTheme }: Props) {
  const { desktops, loading, error } = useDesktops();
  const isAdmin = user.role === "admin" || user.role === "superadmin";

  return (
    <div className="dashboard-page">
      {/* Top bar */}
      <div className="dashboard-topbar">
        <div className="dashboard-brand">
          <div className="dashboard-brand-icon">V</div>
          <span className="dashboard-brand-text">CwmVDI</span>
        </div>
        <div className="dashboard-topbar-actions">
          {!user.mfa_enabled && (
            <Link to="/mfa-setup" className="btn-ghost btn-sm">Enable MFA</Link>
          )}
          {isAdmin && (
            <Link to="/admin" className="btn-ghost btn-sm">Admin Panel</Link>
          )}
          <button
            className="btn-ghost btn-sm topbar-theme-btn"
            onClick={toggleTheme}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            {theme === "dark" ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
              </svg>
            )}
          </button>
          <div className="dashboard-user-pill">
            <div className="dashboard-user-avatar">{user.username.charAt(0).toUpperCase()}</div>
            <span className="dashboard-username">{user.username}</span>
          </div>
          <button className="btn-ghost btn-sm" onClick={onLogout}>Logout</button>
        </div>
      </div>

      {/* Page content */}
      <div className="dashboard-content">
        <div className="dashboard-header">
          <h1 className="dashboard-title">My Desktops</h1>
          <p className="dashboard-subtitle">{desktops.length} desktop{desktops.length !== 1 ? "s" : ""} assigned</p>
        </div>

        {loading && (
          <div style={{ display: "flex", justifyContent: "center", marginTop: 80 }}>
            <div className="spinner" />
          </div>
        )}

        {error && <p className="error-msg">{error}</p>}

        {!loading && desktops.length === 0 && (
          <div className="dashboard-empty">
            <div className="dashboard-empty-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                <line x1="8" y1="21" x2="16" y2="21"/>
                <line x1="12" y1="17" x2="12" y2="21"/>
              </svg>
            </div>
            <h3>No desktops assigned</h3>
            <p>Contact your administrator to get a virtual desktop assigned to your account.</p>
          </div>
        )}

        {!loading && desktops.length > 0 && (
          <div className="desktop-grid">
            {desktops.map((d) => (
              <DesktopCard key={d.id} desktop={d} user={user} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
