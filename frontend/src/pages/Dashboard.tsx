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
    <div className="page">
      {/* Header */}
      <div className="page-header">
        <h1>My Desktops</h1>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {!user.mfa_enabled && (
            <Link to="/mfa-setup" className="btn-ghost" style={{ padding: "8px 16px", fontSize: 13, borderRadius: "var(--radius)" }}>
              Enable MFA
            </Link>
          )}
          {isAdmin && (
            <Link to="/admin" className="btn-ghost" style={{ padding: "8px 16px", fontSize: 13, borderRadius: "var(--radius)" }}>
              Admin
            </Link>
          )}
          <button
            className="btn-ghost topbar-theme-btn"
            onClick={toggleTheme}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            style={{ padding: "8px 16px", fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            {theme === "dark" ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="5"/>
                  <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                  <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                </svg>
                Light
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                </svg>
                Dark
              </>
            )}
          </button>
          <span style={{ color: "var(--text-muted)", fontSize: 13 }}>{user.username}</span>
          <button className="btn-ghost" onClick={onLogout} style={{ padding: "8px 16px", fontSize: 13 }}>
            Logout
          </button>
        </div>
      </div>

      {/* Content */}
      {loading && (
        <div style={{ display: "flex", justifyContent: "center", marginTop: 80 }}>
          <div className="spinner" />
        </div>
      )}

      {error && <p className="error-msg">{error}</p>}

      {!loading && desktops.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: 60 }}>
          <h3 style={{ color: "var(--text-muted)" }}>No desktops assigned</h3>
          <p style={{ color: "var(--text-muted)", marginTop: 8, fontSize: 14 }}>
            Contact your administrator to get a desktop assigned.
          </p>
        </div>
      )}

      {!loading && desktops.length > 0 && (
        <div className="grid">
          {desktops.map((d) => (
            <DesktopCard key={d.id} desktop={d} user={user} />
          ))}
        </div>
      )}
    </div>
  );
}
