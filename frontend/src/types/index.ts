export interface User {
  id: string;
  email: string;
  role: "user" | "admin" | "superadmin";
  mfa_enabled: boolean;
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
  email: string;
  role: string;
  mfa_enabled: boolean;
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
}

export interface LoginResponse {
  requires_mfa: boolean;
  mfa_token?: string;
  access_token?: string;
}

export interface MFASetupData {
  secret: string;
  qr_code: string;
  provisioning_uri: string;
}
