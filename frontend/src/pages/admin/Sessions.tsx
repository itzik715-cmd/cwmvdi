import { useState, useEffect } from "react";
import { adminApi } from "../../services/api";
import type { AdminSession } from "../../types";

export default function Sessions() {
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [terminatingId, setTerminatingId] = useState<string | null>(null);

  const fetchSessions = () => {
    adminApi.listSessions().then((res) => setSessions(res.data));
  };

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleTerminate = async (id: string) => {
    if (!confirm("Force terminate this session?")) return;
    setTerminatingId(id);
    try {
      await adminApi.terminateSession(id);
      fetchSessions();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to terminate session");
    } finally {
      setTerminatingId(null);
    }
  };

  const timeSince = (dateStr: string | null) => {
    if (!dateStr) return "—";
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ${mins % 60}m ago`;
  };

  return (
    <div>
      <div className="page-header">
        <h1>Active Sessions</h1>
        <span style={{ color: "var(--text-muted)", fontSize: 13 }}>
          {sessions.length} active session{sessions.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Session ID</th>
              <th>User</th>
              <th>Desktop</th>
              <th>Started</th>
              <th>Last Heartbeat</th>
              <th>Type</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <td style={{ fontSize: 13, fontFamily: "monospace" }}>
                  {s.id.slice(0, 8)}...
                </td>
                <td>{s.user_id.slice(0, 8)}...</td>
                <td>{s.desktop_id.slice(0, 8)}...</td>
                <td style={{ fontSize: 13, color: "var(--text-muted)" }}>
                  {new Date(s.started_at).toLocaleString()}
                </td>
                <td style={{ fontSize: 13, color: "var(--text-muted)" }}>
                  {timeSince(s.last_heartbeat)}
                </td>
                <td style={{ fontSize: 13, color: "var(--text-muted)" }}>
                  {s.connection_type === "native" ? "Native RDP" : "Browser"}
                </td>
                <td>
                  <button
                    className="btn-danger"
                    style={{ padding: "4px 12px", fontSize: 12 }}
                    onClick={() => handleTerminate(s.id)}
                    disabled={terminatingId === s.id}
                  >
                    {terminatingId === s.id ? "Ending..." : "Terminate"}
                  </button>
                </td>
              </tr>
            ))}
            {sessions.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  style={{
                    textAlign: "center",
                    padding: 40,
                    color: "var(--text-muted)",
                  }}
                >
                  No active sessions.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
