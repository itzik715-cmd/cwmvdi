export interface User {
  id: string;
  username: string;
  email: string | null;
  role: "user" | "admin" | "superadmin";
  mfa_enabled: boolean;
  mfa_setup_required?: boolean;
  mfa_type?: "totp" | "duo";
  mfa_bypass?: boolean;
  duo_auth_mode?: "password_duo" | "duo_only";
  must_change_password: boolean;
  tenant_id: string;
  cloudwm_setup_required?: boolean;
}

export interface Desktop {
  id: string;
  display_name: string;
  current_state: "on" | "off" | "suspended" | "starting" | "suspending" | "provisioning" | "error" | "unknown";
  cloudwm_server_id: string;
  last_state_check: string | null;
  vm_cpu: string | null;
  vm_ram_mb: number | null;
  vm_disk_gb: number | null;
  created_at: string | null;
  last_session_at: string | null;
  total_sessions: number;
  usage_hours_this_month: number;
}

export interface ConnectResult {
  session_id: string;
  desktop_name: string;
  connection_type: "browser" | "native";
  guacamole_token?: string;
  guacamole_url?: string;
}

export interface AdminDesktop extends Desktop {
  user_email: string;
  user_id: string | null;
  vm_private_ip: string | null;
  is_active: boolean;
  created_at: string;
}

export interface AdminUser {
  id: string;
  username: string;
  email: string | null;
  role: string;
  mfa_enabled: boolean;
  mfa_required: boolean;
  mfa_bypass: boolean;
  is_active: boolean;
  created_at: string;
}

export interface AdminSession {
  id: string;
  user_id: string;
  desktop_id: string;
  started_at: string;
  last_heartbeat: string | null;
  connection_type: "browser" | "native";
  proxy_port: number | null;
  client_ip: string | null;
}

export interface AuditEntry {
  session_id: string;
  user_email: string;
  desktop_id: string;
  started_at: string;
  ended_at: string | null;
  end_reason: string | null;
  client_ip: string | null;
}

export interface TenantSettings {
  suspend_threshold_minutes: number;
  max_session_hours: number;
  tenant_name: string;
  tenant_slug: string;
  cloudwm_api_url: string;
  cloudwm_client_id: string;
  cloudwm_configured: boolean;
  cloudwm_setup_required: boolean;
  system_server_id: string | null;
  system_server_name: string | null;
  locked_datacenter: string | null;
  last_sync_at: string | null;
  nat_gateway_enabled: boolean;
  gateway_lan_ip: string | null;
  default_network_name: string | null;
  duo_enabled: boolean;
  duo_ikey: string;
  duo_api_host: string;
  duo_auth_mode: "password_duo" | "duo_only";
  duo_configured: boolean;
  brand_name: string | null;
  brand_logo_set: boolean;
  brand_favicon_set: boolean;
}

export interface LoginResponse {
  requires_mfa: boolean;
  mfa_token?: string;
  access_token?: string;
  requires_duo?: boolean;
  duo_token?: string;
  duo_factors?: string[];
  duo_devices?: Array<{ device: string; type: string; name?: string; capabilities: string[] }>;
  mfa_type?: "totp" | "duo";
}

export interface UsagePeriod {
  hours: number;
  session_count: number;
}

export interface DesktopUsage {
  desktop_id: string;
  display_name: string;
  vm_cpu: string | null;
  vm_ram_mb: number | null;
  vm_disk_gb: number | null;
  last_24h: UsagePeriod;
  last_7d: UsagePeriod;
  last_30d: UsagePeriod;
  current_month: UsagePeriod;
  previous_month: UsagePeriod;
  month_over_month_change: number | null;
  recent_sessions: {
    session_id: string;
    user: string;
    started_at: string;
    ended_at: string | null;
    duration_hours: number;
    connection_type: string;
    end_reason: string | null;
  }[];
}

export interface MFASetupData {
  secret: string;
  qr_code: string;
  provisioning_uri: string;
}
