import { useState, useEffect } from "react";
import { adminApi } from "../../services/api";

interface Network {
  name: string;
  subnet: string;
  datacenter: string;
}

export default function Networks() {
  const [networks, setNetworks] = useState<Network[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDC, setSelectedDC] = useState("");
  const [datacenters, setDatacenters] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    adminApi.getDatacenters().then((res) => {
      setDatacenters(res.data || []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedDC) {
      setNetworks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    adminApi.getNetworks(selectedDC).then((res) => {
      setNetworks(res.data);
    }).catch(() => {
      setNetworks([]);
    }).finally(() => setLoading(false));
  }, [selectedDC]);

  return (
    <div>
      <div className="page-header">
        <h1>Private Networks</h1>
      </div>

      <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 16 }}>
        Existing VLAN networks from your Kamatera account. To create new VLANs, use the
        Kamatera console. Networks are available when creating desktops.
      </p>

      <div className="form-group" style={{ maxWidth: 300, marginBottom: 20 }}>
        <label>Datacenter</label>
        <select value={selectedDC} onChange={(e) => setSelectedDC(e.target.value)}>
          <option value="">Select datacenter...</option>
          {datacenters.map((dc) => (
            <option key={dc.id} value={dc.id}>{dc.name} ({dc.id})</option>
          ))}
        </select>
      </div>

      {loading && selectedDC && (
        <div style={{ display: "flex", justifyContent: "center", marginTop: 40 }}>
          <div className="spinner" />
        </div>
      )}

      {!loading && selectedDC && (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Subnet / IPs</th>
                <th>Datacenter</th>
              </tr>
            </thead>
            <tbody>
              {networks.map((n) => (
                <tr key={n.name}>
                  <td style={{ fontWeight: 600 }}>{n.name}</td>
                  <td style={{ fontFamily: "monospace", fontSize: 13 }}>{n.subnet}</td>
                  <td style={{ fontSize: 13, color: "var(--text-muted)" }}>{n.datacenter}</td>
                </tr>
              ))}
              {networks.length === 0 && (
                <tr>
                  <td
                    colSpan={3}
                    style={{
                      textAlign: "center",
                      padding: 40,
                      color: "var(--text-muted)",
                    }}
                  >
                    No private networks in this datacenter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {!selectedDC && !loading && (
        <div className="card" style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
          Select a datacenter to view available networks.
        </div>
      )}
    </div>
  );
}
