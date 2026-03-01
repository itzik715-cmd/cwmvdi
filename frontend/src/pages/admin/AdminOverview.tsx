import { useState, useEffect, useRef } from "react";
import { adminApi } from "../../services/api";
import type { AdminDesktop, AdminSession, AdminUser } from "../../types";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: string;
  color: string;
  trend?: { value: number; positive: boolean };
}

function StatCard({ title, value, subtitle, icon, color, trend }: StatCardProps) {
  return (
    <div className="stat-card" style={{ borderTop: `3px solid ${color}` }}>
      <div className="stat-card-header">
        <div className="stat-icon" style={{ background: `${color}20`, color }}>
          {icon}
        </div>
        {trend && (
          <span className={`stat-trend ${trend.positive ? "trend-up" : "trend-down"}`}>
            {trend.positive ? "\u2191" : "\u2193"} {Math.abs(trend.value)}%
          </span>
        )}
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-title">{title}</div>
      {subtitle && <div className="stat-subtitle">{subtitle}</div>}
    </div>
  );
}

interface DonutChartProps {
  data: { label: string; value: number; color: string }[];
  title: string;
  centerValue?: string;
  centerLabel?: string;
}

function DonutChart({ data, title, centerValue, centerLabel }: DonutChartProps) {
  const total = data.reduce((s, d) => s + d.value, 0);
  let cumulative = 0;
  const radius = 54;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="donut-chart-container">
      <div className="donut-title">{title}</div>
      <div className="donut-wrapper">
        <svg viewBox="0 0 140 140" width="140" height="140">
          <circle cx="70" cy="70" r={radius} fill="none" stroke="var(--border)" strokeWidth="14" />
          {total > 0 && data.map((d, i) => {
            const portion = (d.value / total) * circumference;
            const offset = circumference - cumulative;
            cumulative += portion;
            return (
              <circle
                key={i}
                cx="70" cy="70" r={radius}
                fill="none"
                stroke={d.color}
                strokeWidth="14"
                strokeDasharray={`${portion} ${circumference - portion}`}
                strokeDashoffset={offset}
                strokeLinecap="round"
                style={{ transition: "stroke-dasharray 0.5s ease", transformOrigin: "70px 70px", transform: "rotate(-90deg)" }}
              />
            );
          })}
          {centerValue && (
            <>
              <text x="70" y="65" textAnchor="middle" fill="var(--text)" fontSize="20" fontWeight="700">{centerValue}</text>
              {centerLabel && <text x="70" y="82" textAnchor="middle" fill="var(--text-muted)" fontSize="10">{centerLabel}</text>}
            </>
          )}
        </svg>
        <div className="donut-legend">
          {data.map((d, i) => (
            <div key={i} className="legend-item">
              <span className="legend-dot" style={{ background: d.color }} />
              <span className="legend-label">{d.label}</span>
              <span className="legend-value">{d.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface SparklineProps {
  data: number[];
  color: string;
  height?: number;
}

function Sparkline({ data, color, height = 40 }: SparklineProps) {
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const width = 120;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 8) - 4;
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} style={{ overflow: "visible" }}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polygon
        points={`0,${height} ${points} ${width},${height}`}
        fill={`${color}20`}
      />
    </svg>
  );
}

export default function AdminOverview() {
  const [desktops, setDesktops] = useState<AdminDesktop[]>([]);
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [sessionHistory, setSessionHistory] = useState<number[]>([0, 0, 0, 0, 0, 0, 0]);
  const [powerHistory, setPowerHistory] = useState<number[]>([0, 0, 0, 0, 0, 0, 0]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAll = async () => {
    try {
      const [dRes, sRes, uRes] = await Promise.all([
        adminApi.listDesktops(),
        adminApi.listSessions(),
        adminApi.listUsers(),
      ]);
      setDesktops(dRes.data);
      setSessions(sRes.data);
      setUsers(uRes.data);
      setLastRefresh(new Date());
      setSessionHistory((prev) => [...prev.slice(1), sRes.data.length]);
      setPowerHistory((prev) => [...prev.slice(1), dRes.data.filter((d: AdminDesktop) => d.current_state === "on").length]);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    intervalRef.current = setInterval(fetchAll, 20000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const totalDesktops = desktops.length;
  const runningDesktops = desktops.filter((d) => d.current_state === "on").length;
  const suspendedDesktops = desktops.filter((d) => d.current_state === "suspended").length;
  const offDesktops = desktops.filter((d) => d.current_state === "off").length;
  const errorDesktops = desktops.filter((d) => d.current_state === "error").length;
  const provisioningDesktops = desktops.filter((d) => d.current_state === "provisioning").length;
  const activeSessions = sessions.length;
  const activeUsers = users.filter((u) => u.is_active).length;
  const unassignedDesktops = desktops.filter((d) => !d.user_id).length;
  const nativeRdpSessions = sessions.filter((s) => s.connection_type === "native").length;
  const browserSessions = sessions.filter((s) => s.connection_type === "browser").length;

  const formatDuration = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ${mins % 60}m`;
    return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
  };

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 300 }}>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="overview-page">
      <div className="overview-header">
        <div>
          <h1 className="overview-title">VDI Overview</h1>
          <p className="overview-subtitle">
            Last updated {lastRefresh.toLocaleTimeString()} · Auto-refresh every 20s
          </p>
        </div>
        <button className="btn-ghost btn-sm" onClick={fetchAll} title="Refresh now">
          {"\uD83D\uDD04"} Refresh
        </button>
      </div>

      <div className="stats-grid">
        <StatCard icon={"\uD83D\uDDA5\uFE0F"} title="Total Desktops" value={totalDesktops} subtitle={`${unassignedDesktops} unassigned`} color="#3b82f6" />
        <StatCard icon={"\u2705"} title="Running Now" value={runningDesktops} subtitle={`${Math.round((runningDesktops / (totalDesktops || 1)) * 100)}% of fleet`} color="#22c55e" />
        <StatCard icon={"\uD83D\uDCA4"} title="Suspended" value={suspendedDesktops} color="#f59e0b" />
        <StatCard icon={"\uD83D\uDC65"} title="Active Sessions" value={activeSessions} subtitle={`${nativeRdpSessions} RDP \u00B7 ${browserSessions} Browser`} color="#06b6d4" />
        <StatCard icon={"\uD83D\uDC64"} title="Active Users" value={activeUsers} subtitle={`${users.length} total`} color="#8b5cf6" />
        {errorDesktops > 0 && (
          <StatCard icon={"\u26A0\uFE0F"} title="Errors" value={errorDesktops} subtitle="Needs attention" color="#ef4444" />
        )}
        {provisioningDesktops > 0 && (
          <StatCard icon={"\u2699\uFE0F"} title="Provisioning" value={provisioningDesktops} color="#f59e0b" />
        )}
      </div>

      <div className="charts-row">
        <div className="card chart-card">
          <DonutChart
            title="Desktop States"
            data={[
              { label: "Running", value: runningDesktops, color: "#22c55e" },
              { label: "Suspended", value: suspendedDesktops, color: "#f59e0b" },
              { label: "Off", value: offDesktops, color: "#6b7280" },
              ...(errorDesktops > 0 ? [{ label: "Error", value: errorDesktops, color: "#ef4444" }] : []),
            ]}
            centerValue={`${totalDesktops}`}
            centerLabel="total"
          />
        </div>
        <div className="card chart-card">
          <DonutChart
            title="Session Types"
            data={[
              { label: "Native RDP", value: nativeRdpSessions, color: "#3b82f6" },
              { label: "Browser", value: browserSessions, color: "#8b5cf6" },
            ]}
            centerValue={`${activeSessions}`}
            centerLabel="active"
          />
        </div>
        <div className="card chart-card">
          <div className="donut-title">Trend (last 7 refreshes)</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 20, marginTop: 16 }}>
            <div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6, display: "flex", justifyContent: "space-between" }}>
                <span>Active Sessions</span>
                <span style={{ color: "#06b6d4", fontWeight: 600 }}>{activeSessions}</span>
              </div>
              <Sparkline data={sessionHistory} color="#06b6d4" />
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6, display: "flex", justifyContent: "space-between" }}>
                <span>Running Desktops</span>
                <span style={{ color: "#22c55e", fontWeight: 600 }}>{runningDesktops}</span>
              </div>
              <Sparkline data={powerHistory} color="#22c55e" />
            </div>
          </div>
        </div>
        <div className="card chart-card">
          <div className="donut-title">Resource Health</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
            <ResourceBar label="Fleet Power On" value={totalDesktops > 0 ? Math.round((runningDesktops / totalDesktops) * 100) : 0} color="#22c55e" />
            <ResourceBar label="Session Utilization" value={runningDesktops > 0 ? Math.round((activeSessions / runningDesktops) * 100) : 0} color="#3b82f6" />
            <ResourceBar label="User Activation" value={users.length > 0 ? Math.round((activeUsers / users.length) * 100) : 0} color="#8b5cf6" />
            <ResourceBar label="Desktop Assignment" value={totalDesktops > 0 ? Math.round(((totalDesktops - unassignedDesktops) / totalDesktops) * 100) : 0} color="#f59e0b" />
          </div>
        </div>
      </div>

      <div className="section-header">
        <h2 className="section-title">
          <span className="section-dot" style={{ background: "#06b6d4" }} />
          Active Sessions
          <span className="badge">{activeSessions}</span>
        </h2>
      </div>

      <div className="card" style={{ padding: 0, overflowX: "auto", marginBottom: 24 }}>
        <table className="modern-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Desktop</th>
              <th>Session Type</th>
              <th>Port / Client IP</th>
              <th>Duration</th>
              <th>Last Heartbeat</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {sessions.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", padding: 32, color: "var(--text-muted)" }}>
                  No active sessions
                </td>
              </tr>
            ) : sessions.map((s) => {
              const desktop = desktops.find((d) => d.id === s.desktop_id);
              const heartbeatAge = s.last_heartbeat ? Date.now() - new Date(s.last_heartbeat).getTime() : Infinity;
              const isStale = heartbeatAge > 5 * 60 * 1000;
              return (
                <tr key={s.id}>
                  <td><div style={{ fontWeight: 500 }}>{s.user_id.slice(0, 8)}{"\u2026"}</div></td>
                  <td>
                    <div style={{ fontWeight: 500 }}>{desktop?.display_name || s.desktop_id.slice(0, 8) + "\u2026"}</div>
                    {desktop?.vm_private_ip && (
                      <div style={{ fontSize: 11, color: "var(--success)" }}>{desktop.vm_private_ip}</div>
                    )}
                  </td>
                  <td>
                    <span className={`type-badge ${s.connection_type === "native" ? "type-native" : "type-browser"}`}>
                      {s.connection_type === "native" ? "\uD83D\uDDA5 Native RDP" : "\uD83C\uDF10 Browser"}
                    </span>
                  </td>
                  <td style={{ fontSize: 12, fontFamily: "monospace" }}>
                    {s.proxy_port ? (
                      <div>
                        <div style={{ fontWeight: 600 }}>:{s.proxy_port}</div>
                        <div style={{ color: "var(--text-muted)" }}>{s.client_ip || "\u2014"}</div>
                      </div>
                    ) : (
                      <span style={{ color: "var(--text-muted)" }}>{s.client_ip || "\u2014"}</span>
                    )}
                  </td>
                  <td style={{ fontVariantNumeric: "tabular-nums" }}>{formatDuration(s.started_at)}</td>
                  <td>
                    {s.last_heartbeat ? (
                      <span style={{ color: isStale ? "var(--warning)" : "var(--success)", fontSize: 13 }}>
                        {isStale ? "\u26A0 " : "\u25CF "}{formatDuration(s.last_heartbeat)} ago
                      </span>
                    ) : "\u2014"}
                  </td>
                  <td>
                    <span className={`status-pill ${isStale ? "pill-warning" : "pill-success"}`}>
                      {isStale ? "Stale" : "Live"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="section-header">
        <h2 className="section-title">
          <span className="section-dot" style={{ background: "#3b82f6" }} />
          Desktop Fleet
          <span className="badge">{totalDesktops}</span>
        </h2>
      </div>

      <div className="card" style={{ padding: 0, overflowX: "auto", marginBottom: 24 }}>
        <table className="modern-table">
          <thead>
            <tr>
              <th>Desktop</th>
              <th>Assigned User</th>
              <th>State</th>
              <th>IP Address</th>
              <th>Sessions</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {desktops.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", padding: 32, color: "var(--text-muted)" }}>
                  No desktops registered
                </td>
              </tr>
            ) : desktops.map((d) => {
              const deskSessions = sessions.filter((s) => s.desktop_id === d.id);
              return (
                <tr key={d.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{d.display_name}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>
                      {d.cloudwm_server_id?.slice(0, 12)}{"\u2026"}
                    </div>
                  </td>
                  <td>
                    {d.user_email ? (
                      <div style={{ fontSize: 13 }}>{d.user_email}</div>
                    ) : (
                      <span style={{ color: "var(--text-muted)", fontSize: 12 }}>Unassigned</span>
                    )}
                  </td>
                  <td><StateBadge state={d.current_state} /></td>
                  <td>
                    {d.vm_private_ip ? (
                      <span style={{ color: "var(--success)", fontSize: 13, fontFamily: "monospace" }}>{d.vm_private_ip}</span>
                    ) : (
                      <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{"\u2014"}</span>
                    )}
                  </td>
                  <td>
                    {deskSessions.length > 0 ? (
                      <span style={{ color: "var(--info)", fontWeight: 600 }}>{"\u25CF"} {deskSessions.length} active</span>
                    ) : (
                      <span style={{ color: "var(--text-muted)", fontSize: 12 }}>None</span>
                    )}
                  </td>
                  <td style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {new Date(d.created_at).toLocaleDateString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {(errorDesktops > 0 || unassignedDesktops > 0) && (
        <div className="alerts-section">
          <div className="section-header">
            <h2 className="section-title">
              <span className="section-dot" style={{ background: "#ef4444" }} />
              Alerts & Recommendations
            </h2>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {errorDesktops > 0 && (
              <div className="alert-item alert-danger">
                <span>{"\u26A0\uFE0F"}</span>
                <span><strong>{errorDesktops} desktop{errorDesktops > 1 ? "s" : ""}</strong> in error state. Check the Desktops page for details.</span>
              </div>
            )}
            {unassignedDesktops > 0 && (
              <div className="alert-item alert-warning">
                <span>{"\uD83D\uDCA1"}</span>
                <span><strong>{unassignedDesktops} desktop{unassignedDesktops > 1 ? "s" : ""}</strong> are unassigned. Assign them to users or consider cleaning up.</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ResourceBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
        <span style={{ color: "var(--text-muted)" }}>{label}</span>
        <span style={{ fontWeight: 600, color }}>{value}%</span>
      </div>
      <div style={{ height: 6, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${Math.min(value, 100)}%`,
            background: color,
            borderRadius: 3,
            transition: "width 0.6s ease",
          }}
        />
      </div>
    </div>
  );
}

function StateBadge({ state }: { state: string }) {
  const configs: Record<string, { color: string; bg: string; label: string }> = {
    on: { color: "#22c55e", bg: "rgba(34,197,94,0.12)", label: "Running" },
    off: { color: "#6b7280", bg: "rgba(107,114,128,0.12)", label: "Off" },
    suspended: { color: "#f59e0b", bg: "rgba(245,158,11,0.12)", label: "Suspended" },
    suspending: { color: "#f59e0b", bg: "rgba(245,158,11,0.12)", label: "Suspending" },
    starting: { color: "#06b6d4", bg: "rgba(6,182,212,0.12)", label: "Starting" },
    provisioning: { color: "#8b5cf6", bg: "rgba(139,92,246,0.12)", label: "Provisioning" },
    error: { color: "#ef4444", bg: "rgba(239,68,68,0.12)", label: "Error" },
  };
  const cfg = configs[state] || { color: "#6b7280", bg: "rgba(107,114,128,0.12)", label: state };
  return (
    <span style={{
      fontSize: 12,
      fontWeight: 600,
      padding: "3px 10px",
      borderRadius: 20,
      color: cfg.color,
      background: cfg.bg,
      border: `1px solid ${cfg.color}30`,
    }}>
      {cfg.label}
    </span>
  );
}
