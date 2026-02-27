import { useState, useEffect } from "react";
import { adminApi } from "../../services/api";

interface Network {
  name: string;
  subnet: string;
  gateway: string;
  datacenter: string;
}

export default function Networks() {
  const [networks, setNetworks] = useState<Network[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSubnet, setNewSubnet] = useState("10.0.0.0/24");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchNetworks = async () => {
    setLoading(true);
    try {
      const res = await adminApi.getNetworks();
      setNetworks(res.data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNetworks();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      await adminApi.createNetwork({ name: newName, subnet: newSubnet });
      setShowCreate(false);
      setNewName("");
      fetchNetworks();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to create network");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>Private Networks</h1>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          New Network
        </button>
      </div>

      <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 16 }}>
        Private LAN networks for Windows desktop VMs. VMs on a private network
        are only accessible through Boundary.
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
                <th>Subnet</th>
                <th>Gateway</th>
                <th>Datacenter</th>
              </tr>
            </thead>
            <tbody>
              {networks.map((n) => (
                <tr key={n.name}>
                  <td style={{ fontWeight: 600 }}>{n.name}</td>
                  <td style={{ fontFamily: "monospace", fontSize: 13 }}>{n.subnet}</td>
                  <td style={{ fontFamily: "monospace", fontSize: 13 }}>{n.gateway}</td>
                  <td style={{ fontSize: 13, color: "var(--text-muted)" }}>{n.datacenter}</td>
                </tr>
              ))}
              {networks.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    style={{
                      textAlign: "center",
                      padding: 40,
                      color: "var(--text-muted)",
                    }}
                  >
                    No private networks configured.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Create Private Network</h2>
            <form onSubmit={handleCreate}>
              <div className="form-group">
                <label>Network Name</label>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. kamvdi-lan"
                  required
                />
              </div>
              <div className="form-group">
                <label>Subnet (CIDR)</label>
                <input
                  value={newSubnet}
                  onChange={(e) => setNewSubnet(e.target.value)}
                  placeholder="10.0.0.0/24"
                  required
                />
              </div>
              {error && <p className="error-msg">{error}</p>}
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setShowCreate(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={creating}>
                  {creating ? "Creating..." : "Create Network"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
