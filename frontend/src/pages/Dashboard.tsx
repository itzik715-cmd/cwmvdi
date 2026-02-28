import { Link } from "react-router-dom";
import { useDesktops } from "../hooks/useDesktops";
import DesktopCard from "../components/DesktopCard";
import type { User } from "../types";

interface Props {
  user: User;
  onLogout: () => void;
}

export default function Dashboard({ user, onLogout }: Props) {
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
          <span style={{ color: "var(--text-muted)", fontSize: 13 }}>{user.email}</span>
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
            <DesktopCard key={d.id} desktop={d} />
          ))}
        </div>
      )}
    </div>
  );
}
