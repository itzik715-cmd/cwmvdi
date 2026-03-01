import { useState, useEffect } from "react";
import { adminApi } from "../../services/api";

interface AnalyticsData {
  period_days: number;
  total_hours: number;
  total_sessions: number;
  active_desktops: number;
  active_users: number;
  daily_usage: { date: string; hours: number; sessions: number }[];
  top_desktops: { desktop_id: string; display_name: string; user: string; hours: number; sessions: number }[];
  top_users: { user_id: string; username: string; hours: number; sessions: number; desktop_count: number }[];
  idle_desktops: { desktop_id: string; display_name: string; user: string; last_used: string | null; days_idle: number }[];
  per_desktop: {
    desktop_id: string; display_name: string; user: string;
    hours_this_month: number; hours_last_month: number; change_pct: number | null;
    sessions_this_month: number; current_state: string;
    vm_cpu: string | null; vm_ram_mb: number | null; vm_disk_gb: number | null;
  }[];
  connection_types: { browser: number; native: number };
}

function formatCpu(cpu: string | null): string {
  if (!cpu) return "—";
  const match = cpu.match(/^(\d+)/);
  return match ? `${match[1]} vCPU` : cpu;
}
function formatRam(mb: number | null): string {
  if (!mb) return "—";
  return mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB` : `${mb} MB`;
}

const stateColors: Record<string, string> = {
  on: "#22c55e", off: "#6b7280", suspended: "#f59e0b", error: "#ef4444",
};

export default function Analytics() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  useEffect(() => {
    setLoading(true);
    adminApi.getAnalytics(days)
      .then((res) => setData(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [days]);

  if (loading || !data) {
    return (
      <div>
        <div className="page-header"><h1>Analytics</h1></div>
        <div style={{ display: "flex", justifyContent: "center", marginTop: 80 }}>
          <div className="spinner" />
        </div>
      </div>
    );
  }

  const maxDaily = Math.max(...data.daily_usage.map((d) => d.hours), 1);
  const maxDesktopHours = data.top_desktops.length > 0 ? data.top_desktops[0].hours : 1;
  const totalConn = data.connection_types.browser + data.connection_types.native || 1;

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 16 }}>
        <h1>Analytics</h1>
        <div style={{ display: "flex", gap: 4 }}>
          {[7, 14, 30, 90].map((d) => (
            <button
              key={d}
              className={days === d ? "btn-primary" : "btn-ghost"}
              style={{ padding: "5px 14px", fontSize: 13 }}
              onClick={() => setDays(d)}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Summary Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
        {[
          { label: "Total Hours", value: `${data.total_hours}h`, color: "#3b82f6" },
          { label: "Total Sessions", value: data.total_sessions, color: "#8b5cf6" },
          { label: "Active Desktops", value: data.active_desktops, color: "#22c55e" },
          { label: "Active Users", value: data.active_users, color: "#f59e0b" },
        ].map((c) => (
          <div key={c.label} className="card" style={{ padding: 18, textAlign: "center" }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6, fontWeight: 500 }}>{c.label}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Daily Usage Chart */}
      <div className="card" style={{ marginBottom: 24, padding: 20 }}>
        <h3 style={{ margin: "0 0 16px" }}>Daily Usage (hours)</h3>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 140 }}>
          {data.daily_usage.map((d) => {
            const pct = maxDaily > 0 ? (d.hours / maxDaily) * 100 : 0;
            return (
              <div
                key={d.date}
                style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", position: "relative" }}
                title={`${d.date}\n${d.hours}h — ${d.sessions} sessions`}
              >
                <div
                  style={{
                    width: "100%",
                    minWidth: 4,
                    height: `${Math.max(pct, 2)}%`,
                    background: "var(--accent)",
                    borderRadius: "3px 3px 0 0",
                    opacity: d.hours > 0 ? 1 : 0.15,
                    transition: "height 0.3s",
                  }}
                />
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{data.daily_usage[0]?.date.slice(5)}</span>
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{data.daily_usage[data.daily_usage.length - 1]?.date.slice(5)}</span>
        </div>
      </div>

      {/* Top Desktops + Top Users */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
        {/* Top Desktops */}
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ margin: "0 0 12px" }}>Top Desktops</h3>
          {data.top_desktops.length === 0 ? (
            <p style={{ color: "var(--text-muted)", fontSize: 13 }}>No usage in this period</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {data.top_desktops.map((d) => (
                <div key={d.desktop_id}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{d.display_name}</span>
                      <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 8 }}>{d.user}</span>
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{d.hours}h</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: "var(--bg-hover)", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${(d.hours / maxDesktopHours) * 100}%`, borderRadius: 3, background: "var(--accent)" }} />
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{d.sessions} sessions</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top Users */}
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ margin: "0 0 12px" }}>Top Users</h3>
          {data.top_users.length === 0 ? (
            <p style={{ color: "var(--text-muted)", fontSize: 13 }}>No usage in this period</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th style={{ fontSize: 11 }}>User</th>
                  <th style={{ fontSize: 11, textAlign: "right" }}>Hours</th>
                  <th style={{ fontSize: 11, textAlign: "right" }}>Sessions</th>
                  <th style={{ fontSize: 11, textAlign: "right" }}>Desktops</th>
                </tr>
              </thead>
              <tbody>
                {data.top_users.map((u) => (
                  <tr key={u.user_id}>
                    <td style={{ fontWeight: 600, fontSize: 13 }}>{u.username}</td>
                    <td style={{ textAlign: "right", fontWeight: 700, fontSize: 13 }}>{u.hours}h</td>
                    <td style={{ textAlign: "right", fontSize: 13, color: "var(--text-muted)" }}>{u.sessions}</td>
                    <td style={{ textAlign: "right", fontSize: 13, color: "var(--text-muted)" }}>{u.desktop_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Connection Types */}
      <div className="card" style={{ padding: 20, marginBottom: 24 }}>
        <h3 style={{ margin: "0 0 12px" }}>Connection Types</h3>
        <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
          <div style={{ flex: 1, height: 14, borderRadius: 7, background: "var(--bg-hover)", overflow: "hidden", display: "flex" }}>
            <div style={{ height: "100%", width: `${(data.connection_types.browser / totalConn) * 100}%`, background: "#8b5cf6" }} />
            <div style={{ height: "100%", width: `${(data.connection_types.native / totalConn) * 100}%`, background: "#3b82f6" }} />
          </div>
          <div style={{ display: "flex", gap: 16, flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#8b5cf6" }} />
              <span style={{ fontSize: 12 }}>Browser ({data.connection_types.browser})</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#3b82f6" }} />
              <span style={{ fontSize: 12 }}>Native RDP ({data.connection_types.native})</span>
            </div>
          </div>
        </div>
      </div>

      {/* Idle Desktops */}
      {data.idle_desktops.length > 0 && (
        <div className="card" style={{ padding: 20, marginBottom: 24, borderLeft: "4px solid #f59e0b" }}>
          <h3 style={{ margin: "0 0 4px", color: "#f59e0b" }}>Idle Desktops (14+ days)</h3>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
            These desktops haven't been used in over 14 days. Consider suspending or removing them to save resources.
          </p>
          <table>
            <thead>
              <tr>
                <th style={{ fontSize: 11 }}>Desktop</th>
                <th style={{ fontSize: 11 }}>User</th>
                <th style={{ fontSize: 11 }}>Last Used</th>
                <th style={{ fontSize: 11, textAlign: "right" }}>Days Idle</th>
              </tr>
            </thead>
            <tbody>
              {data.idle_desktops.map((d) => (
                <tr key={d.desktop_id}>
                  <td style={{ fontWeight: 600, fontSize: 13 }}>{d.display_name}</td>
                  <td style={{ fontSize: 13, color: "var(--text-muted)" }}>{d.user}</td>
                  <td style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {d.last_used ? new Date(d.last_used).toLocaleDateString() : "Never"}
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 700, fontSize: 13, color: d.days_idle >= 30 ? "#ef4444" : "#f59e0b" }}>
                    {d.days_idle}d
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* All Desktops Breakdown */}
      <div className="card" style={{ padding: 0, overflowX: "auto", marginBottom: 24 }}>
        <div style={{ padding: "16px 20px 0" }}>
          <h3 style={{ margin: 0 }}>All Desktops — Monthly Breakdown</h3>
        </div>
        <table>
          <thead>
            <tr>
              <th>Desktop</th>
              <th>User</th>
              <th style={{ textAlign: "right" }}>This Month</th>
              <th style={{ textAlign: "right" }}>Last Month</th>
              <th style={{ textAlign: "right" }}>Change</th>
              <th style={{ textAlign: "right" }}>Sessions</th>
              <th>State</th>
              <th>Specs</th>
            </tr>
          </thead>
          <tbody>
            {data.per_desktop.map((d) => (
              <tr key={d.desktop_id}>
                <td style={{ fontWeight: 600, fontSize: 13 }}>{d.display_name}</td>
                <td style={{ fontSize: 13, color: "var(--text-muted)" }}>{d.user}</td>
                <td style={{ textAlign: "right", fontWeight: 700, fontSize: 13 }}>{d.hours_this_month}h</td>
                <td style={{ textAlign: "right", fontSize: 13, color: "var(--text-muted)" }}>{d.hours_last_month}h</td>
                <td style={{ textAlign: "right", fontSize: 12 }}>
                  {d.change_pct !== null ? (
                    <span style={{ color: d.change_pct >= 0 ? "#22c55e" : "#ef4444", fontWeight: 600 }}>
                      {d.change_pct >= 0 ? "+" : ""}{d.change_pct}%
                    </span>
                  ) : (
                    <span style={{ color: "var(--text-muted)" }}>—</span>
                  )}
                </td>
                <td style={{ textAlign: "right", fontSize: 13, color: "var(--text-muted)" }}>{d.sessions_this_month}</td>
                <td>
                  <span style={{
                    fontSize: 11, padding: "2px 8px", borderRadius: 4, fontWeight: 500,
                    background: `${stateColors[d.current_state] || "#6b7280"}18`,
                    color: stateColors[d.current_state] || "#6b7280",
                  }}>
                    {d.current_state}
                  </span>
                </td>
                <td style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                  {d.vm_cpu ? `${formatCpu(d.vm_cpu)} / ${formatRam(d.vm_ram_mb)}` : "—"}
                </td>
              </tr>
            ))}
            {data.per_desktop.length === 0 && (
              <tr>
                <td colSpan={8} style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
                  No desktops
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
