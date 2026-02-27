import { useState, useEffect } from "react";
import { adminApi } from "../../services/api";
import type { AuditEntry } from "../../types";

export default function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [limit, setLimit] = useState(50);

  useEffect(() => {
    adminApi.getAudit(limit).then((res) => setEntries(res.data));
  }, [limit]);

  const formatDuration = (start: string, end: string | null) => {
    if (!end) return "—";
    const diff = new Date(end).getTime() - new Date(start).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ${mins % 60}m`;
  };

  return (
    <div>
      <div className="page-header">
        <h1>Audit Log</h1>
        <select
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          style={{ padding: "6px 12px", fontSize: 13 }}
        >
          <option value={25}>Last 25</option>
          <option value={50}>Last 50</option>
          <option value={100}>Last 100</option>
          <option value={200}>Last 200</option>
        </select>
      </div>

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Desktop</th>
              <th>Started</th>
              <th>Ended</th>
              <th>Duration</th>
              <th>End Reason</th>
              <th>Client IP</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.session_id}>
                <td>{e.user_email}</td>
                <td style={{ fontSize: 13 }}>{e.desktop_id.slice(0, 8)}...</td>
                <td style={{ fontSize: 13, color: "var(--text-muted)" }}>
                  {new Date(e.started_at).toLocaleString()}
                </td>
                <td style={{ fontSize: 13, color: "var(--text-muted)" }}>
                  {e.ended_at ? new Date(e.ended_at).toLocaleString() : "Active"}
                </td>
                <td style={{ fontSize: 13, color: "var(--text-muted)" }}>
                  {formatDuration(e.started_at, e.ended_at)}
                </td>
                <td>
                  {e.end_reason && (
                    <span
                      className={`badge ${
                        e.end_reason === "user_disconnect"
                          ? "badge-off"
                          : e.end_reason === "idle_suspend"
                          ? "badge-suspended"
                          : "badge-off"
                      }`}
                    >
                      {e.end_reason.replace(/_/g, " ")}
                    </span>
                  )}
                </td>
                <td style={{ fontSize: 13, fontFamily: "monospace", color: "var(--text-muted)" }}>
                  {e.client_ip || "—"}
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  style={{
                    textAlign: "center",
                    padding: 40,
                    color: "var(--text-muted)",
                  }}
                >
                  No session history yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
