import axios from "axios";

export const api = axios.create({
  baseURL: "/api",
  withCredentials: true,
});

// Add JWT to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 → redirect to login
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("token");
      window.location.href = "/";
    }
    return Promise.reject(error);
  }
);

// ── Desktop APIs ──

export const desktopsApi = {
  list: () => api.get("/desktops"),
  connect: (id: string, mfa_code?: string) => api.post(`/desktops/${id}/connect`, { mfa_code }),
  disconnect: (id: string) => api.post(`/desktops/${id}/disconnect`),
  heartbeat: (sessionId: string) =>
    api.post("/desktops/heartbeat", { session_id: sessionId }),
  downloadRDPFile: (id: string) =>
    api.post(`/desktops/${id}/rdp-file`, null, { responseType: "blob" }),
  nativeRDP: (id: string, mfa_code?: string) =>
    api.post(`/desktops/${id}/native-rdp`, { mfa_code }),
};

// ── Admin APIs ──

export const adminApi = {
  listUsers: () => api.get("/admin/users"),
  createUser: (data: { username: string; password: string; email?: string; role?: string }) =>
    api.post("/admin/users", data),
  deleteUser: (id: string) => api.delete(`/admin/users/${id}`),
  requireMFA: (id: string) => api.post(`/admin/users/${id}/require-mfa`),
  resetMFA: (id: string) => api.post(`/admin/users/${id}/reset-mfa`),
  disableMFA: (id: string) => api.post(`/admin/users/${id}/disable-mfa`),
  resetPassword: (id: string, new_password: string) =>
    api.post(`/admin/users/${id}/reset-password`, { new_password }),
  updateRole: (id: string, role: string) =>
    api.post(`/admin/users/${id}/role`, { role }),
  toggleMfaBypass: (id: string) =>
    api.post(`/admin/users/${id}/toggle-mfa-bypass`),

  getDesktopUsage: (id: string) => api.get(`/admin/desktops/${id}/usage`),
  listDesktops: () => api.get("/admin/desktops"),
  createDesktop: (data: {
    user_id: string;
    display_name: string;
    image_id: string;
    cpu?: string;
    ram?: number;
    disk_size?: number;
    password?: string;
    network_name?: string;
  }) => api.post("/admin/desktops", data),
  updateDesktop: (id: string, data: { user_id: string | null }) =>
    api.patch(`/admin/desktops/${id}`, data),
  unregisterDesktop: (id: string) => api.delete(`/admin/desktops/${id}`),
  terminateDesktop: (id: string, mfa_code: string) =>
    api.post(`/admin/desktops/${id}/terminate`, { mfa_code }),
  activateDesktop: (id: string) => api.post(`/admin/desktops/${id}/activate`),
  desktopPower: (id: string, action: string) =>
    api.post(`/admin/desktops/${id}/power`, { action }),
  getUnregisteredServers: () => api.get("/admin/unregistered-servers"),
  importServer: (data: {
    server_id: string;
    display_name: string;
    user_id?: string;
    password?: string;
  }) => api.post("/admin/desktops/import", data),

  getImages: () => api.get("/admin/images"),
  getNetworks: () => api.get("/admin/networks"),

  listSessions: () => api.get("/admin/sessions"),
  terminateSession: (id: string) => api.delete(`/admin/sessions/${id}`),

  getAudit: (limit?: number) => api.get("/admin/audit", { params: { limit } }),

  getSettings: () => api.get("/admin/settings"),
  updateSettings: (data: {
    suspend_threshold_minutes?: number;
    max_session_hours?: number;
    nat_gateway_enabled?: boolean;
    gateway_lan_ip?: string | null;
    default_network_name?: string | null;
  }) => api.put("/admin/settings", data),

  updateCloudWM: (data: { api_url: string; client_id: string; secret: string }) =>
    api.put("/admin/settings/cloudwm", data),
  testCloudWM: (data: { api_url: string; client_id: string; secret: string }) =>
    api.post("/admin/settings/cloudwm/test", data),
  discoverServer: () => api.post("/admin/settings/cloudwm/discover"),
  selectServer: (data: { server_id: string }) =>
    api.post("/admin/settings/cloudwm/select-server", data),
  syncFromConsole: () => api.post("/admin/settings/cloudwm/sync"),
  getSystemStatus: () => api.get("/admin/system-status"),
  updateDuo: (data: { duo_enabled: boolean; duo_ikey: string; duo_skey: string; duo_api_host: string; duo_auth_mode: string }) =>
    api.put("/admin/settings/duo", data),
  testDuo: (data: { duo_enabled: boolean; duo_ikey: string; duo_skey: string; duo_api_host: string; duo_auth_mode: string }) =>
    api.post("/admin/settings/duo/test", data),
  updateBranding: (formData: FormData) =>
    api.put("/admin/settings/branding", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    }),
};

// ── Branding (public, no auth) ──

export const brandingApi = {
  get: () => axios.get("/api/branding"),
};

// ── Auth APIs ──

export const authApi = {
  login: (username: string, password?: string) =>
    api.post("/auth/login", { username, password: password || undefined }),
  verifyMFA: (mfa_token: string, code: string) =>
    api.post("/auth/verify-mfa", { mfa_token, code }),
  verifyDuo: (duo_token: string, factor: string = "push", passcode?: string, device: string = "auto") =>
    api.post("/auth/verify-duo", { duo_token, factor, passcode, device }),
  setupMFA: () => api.post("/auth/setup-mfa"),
  confirmMFA: (code: string) =>
    api.post("/auth/confirm-mfa", { code }),
  me: () => api.get("/auth/me"),
};
