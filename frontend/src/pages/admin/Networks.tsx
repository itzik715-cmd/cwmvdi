import { useState, useEffect } from "react";
import { adminApi } from "../../services/api";
import type { TenantSettings } from "../../types";

interface Network {
  name: string;
  subnet: string;
}

export default function Networks() {
  const [networks, setNetworks] = useState<Network[]>([]);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<TenantSettings | null>(null);

  useEffect(() => {
    Promise.all([
      adminApi.getSettings(),
      adminApi.getNetworks(),
    ]).then(([settingsRes, netRes]) => {
      setSettings(settingsRes.data);
      setNetworks(netRes.data);
    }).catch(() => {
      setNetworks([]);
    }).finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="page-header">
        <h1>Private Networks</h1>
      </div>

      <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 16 }}>
        Cached VLAN networks for your locked datacenter{settings?.locked_datacenter ? ` (${settings.locked_datacenter})` : ""}.
        To create new VLANs, use the Kamatera console, then sync from Settings.
      </p>

      {loading && (
        <div style={{ display: "flex", justifyContent: "center", marginTop: 40 }}>
          <div className="spinner" />
        </div>
      )}

      {!loading && (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Subnet / IPs</th>
              </tr>
            </thead>
            <tbody>
              {networks.map((n) => (
                <tr key={n.name}>
                  <td style={{ fontWeight: 600 }}>{n.name}</td>
                  <td style={{ fontFamily: "monospace", fontSize: 13 }}>{n.subnet}</td>
                </tr>
              ))}
              {networks.length === 0 && (
                <tr>
                  <td
                    colSpan={2}
                    style={{
                      textAlign: "center",
                      padding: 40,
                      color: "var(--text-muted)",
                    }}
                  >
                    {settings?.locked_datacenter
                      ? "No private networks found. Sync from Settings to refresh."
                      : "No datacenter configured. Complete server discovery in Settings first."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
