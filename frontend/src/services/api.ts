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
  connect: (id: string) => api.post(`/desktops/${id}/connect`),
  disconnect: (id: string) => api.post(`/desktops/${id}/disconnect`),
  heartbeat: (sessionId: string) =>
    api.post("/desktops/heartbeat", { session_id: sessionId }),
};

// ── Admin APIs ──

export const adminApi = {
  listUsers: () => api.get("/admin/users"),
  createUser: (data: { email: string; password: string; role?: string }) =>
    api.post("/admin/users", data),
  deleteUser: (id: string) => api.delete(`/admin/users/${id}`),

  listDesktops: () => api.get("/admin/desktops"),
  createDesktop: (data: {
    user_id: string;
    display_name: string;
    image_id: string;
    cpu?: string;
    ram?: number;
    disk_size?: number;
    datacenter?: string;
    password?: string;
    network_name?: string;
  }) => api.post("/admin/desktops", data),
  deleteDesktop: (id: string) => api.delete(`/admin/desktops/${id}`),

  getDatacenters: () => api.get("/admin/datacenters"),
  getImages: (datacenter: string) => api.get("/admin/images", { params: { datacenter } }),

  listSessions: () => api.get("/admin/sessions"),
  terminateSession: (id: string) => api.delete(`/admin/sessions/${id}`),

  getAudit: (limit?: number) => api.get("/admin/audit", { params: { limit } }),

  getSettings: () => api.get("/admin/settings"),
  updateSettings: (data: {
    suspend_threshold_minutes?: number;
    max_session_hours?: number;
  }) => api.put("/admin/settings", data),

  updateCloudWM: (data: { api_url: string; client_id: string; secret: string }) =>
    api.put("/admin/settings/cloudwm", data),
  testCloudWM: (data: { api_url: string; client_id: string; secret: string }) =>
    api.post("/admin/settings/cloudwm/test", data),

  getNetworks: (datacenter?: string) => api.get("/admin/networks", { params: { datacenter } }),
  createNetwork: (data: { name: string; datacenter: string }) =>
    api.post("/admin/networks", data),
};

// ── Auth APIs ──

export const authApi = {
  login: (email: string, password: string, tenant_slug: string) =>
    api.post("/auth/login", { email, password, tenant_slug }),
  verifyMFA: (mfa_token: string, code: string) =>
    api.post("/auth/verify-mfa", { mfa_token, code }),
  setupMFA: () => api.post("/auth/setup-mfa"),
  confirmMFA: (code: string) =>
    api.post(`/auth/confirm-mfa?code=${encodeURIComponent(code)}`),
  me: () => api.get("/auth/me"),
};
