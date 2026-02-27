export interface User {
  id: string;
  email: string;
  role: "user" | "admin" | "superadmin";
  mfa_enabled: boolean;
  must_change_password: boolean;
  tenant_id: string;
}

export interface Desktop {
  id: string;
  display_name: string;
  current_state: "on" | "off" | "suspended" | "starting" | "suspending" | "provisioning" | "error" | "unknown";
  cloudwm_server_id: string;
  last_state_check: string | null;
}

export interface ConnectResult {
  uri: string;
  session_id: string;
  desktop_name: string;
}

export interface AdminDesktop extends Desktop {
  user_email: string;
  user_id: string;
  boundary_target_id: string | null;
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
  agent_version: string | null;
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
