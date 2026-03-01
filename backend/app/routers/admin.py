import asyncio
import ipaddress
import logging
import re
import uuid
from datetime import datetime, timedelta
from enum import Enum

import psutil
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db, async_session
from app.dependencies import require_admin
from app.models.cached_data import CachedImage, CachedNetwork
from app.models.desktop import DesktopAssignment
from app.models.session import Session
from app.models.tenant import Tenant
from app.models.user import User
from app.services.auth import hash_password, validate_password_strength
from app.services.cloudwm import CloudWMClient
from app.services.encryption import encrypt_value, decrypt_value
from app.services.mfa import verify_totp

logger = logging.getLogger(__name__)

router = APIRouter()
settings = get_settings()


# ── Schemas ──


def _validate_url_not_internal(url: str, label: str = "URL") -> None:
    """Block SSRF by rejecting internal/private IP addresses in URLs."""
    from urllib.parse import urlparse
    parsed = urlparse(url)
    hostname = parsed.hostname
    if not hostname:
        raise HTTPException(status_code=400, detail=f"Invalid {label}")
    if parsed.scheme not in ("https", "http"):
        raise HTTPException(status_code=400, detail=f"{label} must use HTTP or HTTPS")
    try:
        ip = ipaddress.ip_address(hostname)
        if ip.is_private or ip.is_loopback or ip.is_reserved or ip.is_link_local:
            raise HTTPException(status_code=400, detail=f"{label} cannot point to internal addresses")
    except ValueError:
        pass  # hostname, not IP — OK


class CreateUserRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=150)
    password: str = Field(..., min_length=8, max_length=256)
    email: str | None = Field(None, max_length=255)
    role: str = Field("user", pattern=r"^(user|admin)$")


class CreateDesktopRequest(BaseModel):
    user_id: str = Field(..., max_length=50)
    display_name: str = Field(..., min_length=1, max_length=100)
    image_id: str = Field(..., max_length=255)
    cpu: str = Field("2B", max_length=10)
    ram: int = Field(4096, ge=1024, le=131072)
    disk_size: int = Field(50, ge=10, le=2000)
    password: str = Field(..., max_length=256)
    network_name: str | None = Field(None, max_length=100)  # None = use tenant default

    @staticmethod
    def validate_vm_password(pw: str) -> str | None:
        """Validate password against Kamatera policy. Returns error message or None."""
        allowed = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$^&*()~")
        if len(pw) < 14:
            return "Password must be at least 14 characters"
        if len(pw) > 32:
            return "Password must be at most 32 characters"
        if not any(c.islower() for c in pw):
            return "Password must contain at least one lowercase letter"
        if not any(c.isupper() for c in pw):
            return "Password must contain at least one uppercase letter"
        if not any(c.isdigit() for c in pw):
            return "Password must contain at least one number"
        if not all(c in allowed for c in pw):
            return "Password contains invalid characters. Allowed: a-z, A-Z, 0-9, !@#$^&*()~"
        return None


class ImportServerRequest(BaseModel):
    server_id: str = Field(..., max_length=50)
    display_name: str = Field(..., min_length=1, max_length=100)
    user_id: str | None = Field(None, max_length=50)
    password: str | None = Field(None, max_length=256)


class UpdateDesktopRequest(BaseModel):
    user_id: str | None = Field(None, max_length=50)  # None = unassign


class UpdateSettingsRequest(BaseModel):
    suspend_threshold_minutes: int | None = Field(None, ge=5, le=1440)
    max_session_hours: int | None = Field(None, ge=1, le=24)
    nat_gateway_enabled: bool | None = None
    gateway_lan_ip: str | None = Field(None, max_length=45)
    default_network_name: str | None = Field(None, max_length=100)


# ── Helpers ──


async def _get_tenant(db: AsyncSession, tenant_id: uuid.UUID) -> Tenant:
    result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return tenant


async def _verify_admin_mfa(admin: User, mfa_code: str, db: AsyncSession) -> None:
    """Verify MFA for admin actions. Uses DUO if enabled, TOTP otherwise."""
    tenant = await _get_tenant(db, admin.tenant_id)

    if tenant.duo_enabled and tenant.duo_ikey and tenant.duo_skey_encrypted:
        from app.services.duo import verify_duo, DuoAuthError
        duo_skey = decrypt_value(tenant.duo_skey_encrypted)
        try:
            await verify_duo(
                tenant.duo_ikey, duo_skey, tenant.duo_api_host,
                admin.username, factor="passcode", passcode=mfa_code,
            )
        except DuoAuthError:
            raise HTTPException(status_code=401, detail="MFA verification failed")
    else:
        if not admin.mfa_secret or not verify_totp(admin.mfa_secret, mfa_code):
            raise HTTPException(status_code=401, detail="Invalid MFA code")


def _extract_specs_from_server_info(server_info: dict) -> tuple[str | None, int | None, int | None]:
    """Extract (vm_cpu, vm_ram_mb, vm_disk_gb) from a Kamatera server info dict."""
    vm_cpu = None
    vm_ram_mb = None
    vm_disk_gb = None

    cpu_raw = server_info.get("cpu")
    if cpu_raw:
        vm_cpu = str(cpu_raw)

    ram_raw = server_info.get("ram")
    if ram_raw:
        try:
            vm_ram_mb = int(ram_raw)
        except (ValueError, TypeError):
            pass

    disk_sizes = server_info.get("diskSizes")
    if isinstance(disk_sizes, list) and disk_sizes:
        try:
            vm_disk_gb = sum(int(d) for d in disk_sizes)
        except (ValueError, TypeError):
            pass

    return vm_cpu, vm_ram_mb, vm_disk_gb


# ── Users ──


@router.get("/users")
async def list_users(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User).where(User.tenant_id == admin.tenant_id).order_by(User.created_at)
    )
    users = result.scalars().all()
    return [
        {
            "id": str(u.id),
            "username": u.username,
            "email": u.email,
            "role": u.role,
            "mfa_enabled": u.mfa_enabled,
            "mfa_required": u.mfa_required,
            "mfa_bypass": u.mfa_bypass,
            "is_active": u.is_active,
            "created_at": u.created_at.isoformat(),
        }
        for u in users
    ]


@router.post("/users")
async def create_user(
    req: CreateUserRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    # Validate password strength
    pw_error = validate_password_strength(req.password)
    if pw_error:
        raise HTTPException(status_code=400, detail=pw_error)

    # Check for existing user
    existing = await db.execute(
        select(User).where(
            User.tenant_id == admin.tenant_id, User.username == req.username
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="User with this username already exists")

    user = User(
        tenant_id=admin.tenant_id,
        username=req.username,
        email=req.email,
        password_hash=hash_password(req.password),
        role=req.role,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    return {"id": str(user.id), "username": user.username, "role": user.role}


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: str,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User).where(
            User.id == uuid.UUID(user_id), User.tenant_id == admin.tenant_id
        )
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.is_active = False
    await db.commit()
    return {"message": "User deactivated"}


class UpdateRoleRequest(BaseModel):
    role: str = Field(..., pattern=r"^(user|admin|superadmin)$")


@router.post("/users/{user_id}/role")
async def update_user_role(
    user_id: str,
    req: UpdateRoleRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Change a user's role (user, admin, superadmin)."""
    result = await db.execute(
        select(User).where(
            User.id == uuid.UUID(user_id), User.tenant_id == admin.tenant_id
        )
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot change your own role")

    user.role = req.role
    await db.commit()
    logger.info("Admin %s changed user %s role to %s", admin.username, user.username, req.role)
    return {"message": f"Role updated to {req.role}"}


@router.post("/users/{user_id}/require-mfa")
async def require_mfa(
    user_id: str,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User).where(
            User.id == uuid.UUID(user_id), User.tenant_id == admin.tenant_id
        )
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.mfa_required = True
    await db.commit()
    return {"message": "MFA required for user"}


@router.post("/users/{user_id}/reset-mfa")
async def reset_mfa(
    user_id: str,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User).where(
            User.id == uuid.UUID(user_id), User.tenant_id == admin.tenant_id
        )
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.mfa_secret = None
    user.mfa_enabled = False
    # Keep mfa_required=True so user must re-setup
    await db.commit()
    return {"message": "MFA reset — user must set up again"}


@router.post("/users/{user_id}/disable-mfa")
async def disable_mfa(
    user_id: str,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User).where(
            User.id == uuid.UUID(user_id), User.tenant_id == admin.tenant_id
        )
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.mfa_required = False
    user.mfa_enabled = False
    user.mfa_secret = None
    await db.commit()
    return {"message": "MFA disabled for user"}


@router.post("/users/{user_id}/toggle-mfa-bypass")
async def toggle_mfa_bypass(
    user_id: str,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Toggle MFA bypass for a user."""
    result = await db.execute(
        select(User).where(
            User.id == uuid.UUID(user_id), User.tenant_id == admin.tenant_id
        )
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.mfa_bypass = not user.mfa_bypass
    await db.commit()
    status = "enabled" if user.mfa_bypass else "disabled"
    logger.info("Admin %s %s MFA bypass for user %s", admin.username, status, user.username)
    return {"message": f"MFA bypass {status}", "mfa_bypass": user.mfa_bypass}


class ResetPasswordRequest(BaseModel):
    new_password: str = Field(..., min_length=8, max_length=256)


@router.post("/users/{user_id}/reset-password")
async def reset_password(
    user_id: str,
    req: ResetPasswordRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Admin resets a user's password."""
    result = await db.execute(
        select(User).where(
            User.id == uuid.UUID(user_id), User.tenant_id == admin.tenant_id
        )
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    errors = validate_password_strength(req.new_password)
    if errors:
        raise HTTPException(status_code=400, detail=errors[0])

    user.password_hash = hash_password(req.new_password)
    await db.commit()
    logger.info("Admin %s reset password for user %s", admin.username, user.username)
    return {"message": "Password reset successfully"}


# ── Desktops ──


@router.get("/desktops")
async def list_all_desktops(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    tenant = await _get_tenant(db, admin.tenant_id)

    result = await db.execute(
        select(DesktopAssignment)
        .where(DesktopAssignment.tenant_id == admin.tenant_id)
        .order_by(DesktopAssignment.created_at)
    )
    desktops = result.scalars().all()

    # Refresh states from CloudWM for active desktops (non-blocking best effort)
    if tenant.cloudwm_client_id and desktops:
        try:
            cloudwm = CloudWMClient(
                api_url=tenant.cloudwm_api_url,
                client_id=tenant.cloudwm_client_id,
                secret=decrypt_value(tenant.cloudwm_secret_encrypted),
            )
            servers = await cloudwm.list_servers()
            server_map = {s["id"]: s.get("power", "").lower() for s in servers}
            server_by_name = {s.get("name", ""): s for s in servers}

            for d in desktops:
                power = server_map.get(d.cloudwm_server_id)

                # Recovery: if server ID is numeric (command_id), try to find the real server
                if not power and d.cloudwm_server_id.isdigit():
                    for s in servers:
                        if s.get("name", "").startswith("cwmvdi-") and s["id"] not in server_map:
                            continue
                        # Match by name pattern containing the display name
                        name_slug = d.display_name.lower().replace(" ", "-")
                        if name_slug in s.get("name", "").lower():
                            d.cloudwm_server_id = s["id"]
                            power = s.get("power", "").lower()
                            # Also fetch IP
                            try:
                                info = await cloudwm.get_server(s["id"])
                                nets = info.get("networks", [])
                                if nets and nets[0].get("ips"):
                                    d.vm_private_ip = nets[0]["ips"][0]
                            except Exception:
                                pass
                            break

                if d.current_state == "provisioning" and not power:
                    continue  # don't override provisioning state if no match yet
                if power:
                    if power == "on":
                        new_state = "on"
                    elif power == "off":
                        new_state = "off"
                    elif power in ("suspended", "paused"):
                        new_state = "suspended"
                    else:
                        new_state = d.current_state
                    if new_state != d.current_state or d.current_state in ("unknown", "provisioning"):
                        d.current_state = new_state
                        d.last_state_check = datetime.utcnow()
            await db.commit()
        except Exception:
            logger.warning("Failed to refresh desktop states from CloudWM")

    # Lazy backfill specs for desktops missing them
    desktops_needing_specs = [
        d for d in desktops
        if d.vm_cpu is None and d.cloudwm_server_id and not d.cloudwm_server_id.isdigit()
    ]
    if desktops_needing_specs and tenant.cloudwm_client_id:
        try:
            for d in desktops_needing_specs[:5]:
                try:
                    server_info = await cloudwm.get_server(d.cloudwm_server_id)
                    cpu, ram, disk = _extract_specs_from_server_info(server_info)
                    if cpu:
                        d.vm_cpu = cpu
                    if ram:
                        d.vm_ram_mb = ram
                    if disk:
                        d.vm_disk_gb = disk
                except Exception:
                    logger.debug("Could not fetch specs for desktop %s", d.id)
            await db.commit()
        except Exception:
            logger.warning("Failed to backfill desktop specs")

    # Get user emails for display
    user_ids = [d.user_id for d in desktops if d.user_id]
    users_map = {}
    if user_ids:
        users_result = await db.execute(select(User).where(User.id.in_(user_ids)))
        users_map = {u.id: u.username for u in users_result.scalars().all()}

    return [
        {
            "id": str(d.id),
            "display_name": d.display_name,
            "user_email": users_map.get(d.user_id, "Unassigned") if d.user_id else "Unassigned",
            "user_id": str(d.user_id) if d.user_id else None,
            "cloudwm_server_id": d.cloudwm_server_id,
            "current_state": d.current_state,
            "vm_private_ip": d.vm_private_ip,
            "is_active": d.is_active,
            "created_at": d.created_at.isoformat(),
            "vm_cpu": d.vm_cpu,
            "vm_ram_mb": d.vm_ram_mb,
            "vm_disk_gb": d.vm_disk_gb,
        }
        for d in desktops
    ]


@router.get("/desktops/{desktop_id}/usage")
async def get_desktop_usage(
    desktop_id: str,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get usage statistics for a specific desktop."""
    result = await db.execute(
        select(DesktopAssignment).where(
            DesktopAssignment.id == uuid.UUID(desktop_id),
            DesktopAssignment.tenant_id == admin.tenant_id,
        )
    )
    desktop = result.scalar_one_or_none()
    if not desktop:
        raise HTTPException(status_code=404, detail="Desktop not found")

    now = datetime.utcnow()

    # Helper to compute hours + session count for a time range
    async def _usage_for_period(since, until=None):
        filters = [
            Session.desktop_id == uuid.UUID(desktop_id),
            Session.started_at >= since,
        ]
        if until:
            filters.append(Session.started_at < until)
        r = await db.execute(
            select(
                func.count(Session.id),
                func.sum(
                    func.extract("epoch",
                        func.coalesce(Session.ended_at, func.now()) - Session.started_at
                    )
                ),
            ).where(*filters)
        )
        count, total_seconds = r.one()
        return {"hours": round((total_seconds or 0) / 3600, 2), "session_count": count or 0}

    last_24h = await _usage_for_period(now - timedelta(hours=24))
    last_7d = await _usage_for_period(now - timedelta(days=7))
    last_30d = await _usage_for_period(now - timedelta(days=30))

    current_month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    prev_month_end = current_month_start - timedelta(seconds=1)
    prev_month_start = prev_month_end.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    current_month = await _usage_for_period(current_month_start)
    previous_month = await _usage_for_period(prev_month_start, current_month_start)

    mom_change = None
    if previous_month["hours"] > 0:
        mom_change = round(((current_month["hours"] - previous_month["hours"]) / previous_month["hours"]) * 100, 1)

    # Recent sessions (last 20)
    result = await db.execute(
        select(Session).where(
            Session.desktop_id == uuid.UUID(desktop_id),
        ).order_by(Session.started_at.desc()).limit(20)
    )
    sessions = result.scalars().all()

    session_user_ids = list({s.user_id for s in sessions})
    users_map = {}
    if session_user_ids:
        users_result = await db.execute(select(User).where(User.id.in_(session_user_ids)))
        users_map = {u.id: u.username for u in users_result.scalars().all()}

    recent_sessions = []
    for s in sessions:
        duration_sec = ((s.ended_at or now) - s.started_at).total_seconds()
        recent_sessions.append({
            "session_id": str(s.id),
            "user": users_map.get(s.user_id, "unknown"),
            "started_at": s.started_at.isoformat() + "Z",
            "ended_at": s.ended_at.isoformat() + "Z" if s.ended_at else None,
            "duration_hours": round(duration_sec / 3600, 2),
            "connection_type": s.connection_type,
            "end_reason": s.end_reason,
        })

    return {
        "desktop_id": str(desktop.id),
        "display_name": desktop.display_name,
        "vm_cpu": desktop.vm_cpu,
        "vm_ram_mb": desktop.vm_ram_mb,
        "vm_disk_gb": desktop.vm_disk_gb,
        "last_24h": last_24h,
        "last_7d": last_7d,
        "last_30d": last_30d,
        "current_month": current_month,
        "previous_month": previous_month,
        "month_over_month_change": mom_change,
        "recent_sessions": recent_sessions,
    }


@router.get("/unregistered-servers")
async def list_unregistered_servers(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """List Kamatera servers not yet registered as desktops."""
    tenant = await _get_tenant(db, admin.tenant_id)
    if not tenant.cloudwm_client_id:
        raise HTTPException(status_code=400, detail="CloudWM API not configured")

    cloudwm = CloudWMClient(
        api_url=tenant.cloudwm_api_url,
        client_id=tenant.cloudwm_client_id,
        secret=decrypt_value(tenant.cloudwm_secret_encrypted),
    )

    # Get all servers with datacenter info
    all_servers = await cloudwm.list_servers_runtime()

    # Get all registered server IDs
    result = await db.execute(
        select(DesktopAssignment.cloudwm_server_id)
        .where(DesktopAssignment.tenant_id == admin.tenant_id)
    )
    registered_ids = {row[0] for row in result.all()}

    # Also exclude the system server
    if tenant.system_server_id:
        registered_ids.add(tenant.system_server_id)

    # Filter by locked datacenter if set
    locked_dc = tenant.locked_datacenter

    return [
        {
            "id": s["id"],
            "name": s.get("name", "Unknown"),
            "power": s.get("power", "unknown").lower(),
        }
        for s in all_servers
        if s["id"] not in registered_ids
        and (not locked_dc or s.get("datacenter", "") == locked_dc)
    ]


@router.post("/desktops/import")
async def import_server(
    req: ImportServerRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Import an existing Kamatera server as a managed desktop."""
    tenant = await _get_tenant(db, admin.tenant_id)
    if not tenant.cloudwm_client_id:
        raise HTTPException(status_code=400, detail="CloudWM API not configured")

    # Check not already registered
    existing = await db.execute(
        select(DesktopAssignment).where(
            DesktopAssignment.cloudwm_server_id == req.server_id,
            DesktopAssignment.tenant_id == admin.tenant_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Server is already registered")

    cloudwm = CloudWMClient(
        api_url=tenant.cloudwm_api_url,
        client_id=tenant.cloudwm_client_id,
        secret=decrypt_value(tenant.cloudwm_secret_encrypted),
    )

    # Get server details for IP
    try:
        server_info = await cloudwm.get_server(req.server_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Server not found in Kamatera")

    # Extract private IP from networks
    vm_ip = None
    networks = server_info.get("networks", [])
    if networks:
        ips = networks[0].get("ips", [])
        if ips:
            vm_ip = ips[0]

    # Extract VM specs
    vm_cpu, vm_ram_mb, vm_disk_gb = _extract_specs_from_server_info(server_info)

    # Get power state
    power_state = "unknown"
    try:
        power_state = await cloudwm.get_server_state(req.server_id)
    except Exception:
        pass

    # Validate user if provided
    user_id = None
    if req.user_id:
        user_result = await db.execute(
            select(User).where(User.id == uuid.UUID(req.user_id), User.tenant_id == admin.tenant_id)
        )
        if not user_result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="User not found")
        user_id = uuid.UUID(req.user_id)

    # Create desktop assignment
    desktop = DesktopAssignment(
        user_id=user_id,
        tenant_id=tenant.id,
        cloudwm_server_id=req.server_id,
        display_name=req.display_name,
        current_state=power_state,
        vm_private_ip=vm_ip,
        vm_cpu=vm_cpu,
        vm_ram_mb=vm_ram_mb,
        vm_disk_gb=vm_disk_gb,
    )

    if req.password:
        desktop.vm_rdp_username = "Administrator"
        desktop.vm_rdp_password_encrypted = encrypt_value(req.password)

    db.add(desktop)
    await db.commit()
    await db.refresh(desktop)

    return {
        "id": str(desktop.id),
        "display_name": desktop.display_name,
        "cloudwm_server_id": desktop.cloudwm_server_id,
        "current_state": desktop.current_state,
        "vm_private_ip": desktop.vm_private_ip,
        "message": "Server imported successfully",
    }


async def _provision_desktop_background(
    desktop_id: uuid.UUID,
    tenant_id: uuid.UUID,
    cloudwm_api_url: str,
    cloudwm_client_id: str,
    cloudwm_secret: str,
    command_id: int,
    vm_name: str,
    vm_password: str = "",
):
    """Background task: wait for VM creation, update desktop record."""
    try:
        cloudwm = CloudWMClient(
            api_url=cloudwm_api_url,
            client_id=cloudwm_client_id,
            secret=cloudwm_secret,
        )

        # Wait for VM creation (up to 10 minutes)
        queue_result = await cloudwm.wait_for_command(command_id, timeout=600)

        async with async_session() as db:
            result = await db.execute(
                select(DesktopAssignment).where(DesktopAssignment.id == desktop_id)
            )
            desktop = result.scalar_one_or_none()
            if not desktop:
                return

            if not queue_result:
                desktop.current_state = "error"
                await db.commit()
                logger.error("VM provisioning failed for desktop %s (command %d)", desktop_id, command_id)
                return

            # Find the actual server UUID by name
            server_id = str(command_id)  # fallback
            try:
                server_info = await cloudwm.find_server_by_name(vm_name)
                if server_info:
                    server_id = server_info.get("id", server_id)
            except Exception:
                logger.warning("Could not find server by name %s", vm_name)

            desktop.cloudwm_server_id = server_id
            desktop.current_state = "on"

            # Try to get the VM's IP address
            try:
                server_data = await cloudwm.get_server(server_id)
                networks = server_data.get("networks", [])
                if isinstance(networks, list):
                    for net in networks:
                        if isinstance(net, dict):
                            ips = net.get("ips", [])
                            if isinstance(ips, list) and ips:
                                desktop.vm_private_ip = ips[0]
                                break
            except Exception:
                pass

            # Store RDP credentials for Guacamole auto-login
            desktop.vm_rdp_username = "Administrator"
            if vm_password:
                desktop.vm_rdp_password_encrypted = encrypt_value(vm_password)

            await db.commit()
            logger.info("Desktop %s provisioned successfully (server: %s)", desktop_id, server_id)

    except Exception:
        logger.exception("Background provisioning failed for desktop %s", desktop_id)
        try:
            async with async_session() as db:
                result = await db.execute(
                    select(DesktopAssignment).where(DesktopAssignment.id == desktop_id)
                )
                desktop = result.scalar_one_or_none()
                if desktop:
                    desktop.current_state = "error"
                    await db.commit()
        except Exception:
            pass


@router.post("/desktops")
async def create_desktop(
    req: CreateDesktopRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Create a new Windows VM — starts provisioning in background."""
    pw_error = CreateDesktopRequest.validate_vm_password(req.password)
    if pw_error:
        raise HTTPException(status_code=400, detail=pw_error)

    tenant = await _get_tenant(db, admin.tenant_id)

    # Verify user exists
    user_result = await db.execute(
        select(User).where(
            User.id == uuid.UUID(req.user_id), User.tenant_id == admin.tenant_id
        )
    )
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if not tenant.cloudwm_client_id:
        raise HTTPException(status_code=400, detail="CloudWM API not configured")
    if not tenant.locked_datacenter:
        raise HTTPException(status_code=400, detail="No datacenter configured. Run server discovery first.")

    datacenter = tenant.locked_datacenter

    # 1. Create VM in CloudWM
    cloudwm = CloudWMClient(
        api_url=tenant.cloudwm_api_url,
        client_id=tenant.cloudwm_client_id,
        secret=decrypt_value(tenant.cloudwm_secret_encrypted),
    )

    # Get the Kamatera account userId for VM naming
    try:
        account_id = await cloudwm.get_account_user_id()
    except Exception:
        account_id = tenant.slug

    vm_name = f"cwmvdi-{account_id}-{req.display_name.lower().replace(' ', '-')}"

    # Get the traffic package ID for this datacenter
    traffic_id = await cloudwm.get_traffic_id(datacenter)

    # Resolve network: use request value, tenant default, or "wan" fallback
    network_name = req.network_name
    if not network_name:
        if tenant.nat_gateway_enabled and tenant.default_network_name:
            network_name = tenant.default_network_name
        else:
            network_name = "wan"

    # Build server params
    server_params = {
        "name": vm_name,
        "password": req.password,
        "datacenter": datacenter,
        "disk_src_0": req.image_id,
        "disk_size_0": req.disk_size,
        "cpu": req.cpu,
        "ram": req.ram,
        "network_name_0": network_name,
        "network_ip_0": "auto",
        "billing": "hourly",
        "traffic": traffic_id,
        "power": True,
    }

    # If NAT gateway enabled, add gateway IP for the VM
    if tenant.nat_gateway_enabled and tenant.gateway_lan_ip and network_name != "wan":
        server_params["network_gateway_0"] = tenant.gateway_lan_ip

    try:
        create_result = await cloudwm.create_server(server_params)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"CloudWM API error: {str(e)}")

    command_id = create_result.get("command_id")
    if not command_id:
        raise HTTPException(status_code=500, detail="Failed to create VM — no command ID returned")

    # 2. Create desktop assignment immediately as "provisioning"
    desktop = DesktopAssignment(
        user_id=user.id,
        tenant_id=tenant.id,
        cloudwm_server_id=str(command_id),
        display_name=req.display_name,
        current_state="provisioning",
        vm_cpu=req.cpu,
        vm_ram_mb=req.ram,
        vm_disk_gb=req.disk_size,
    )
    db.add(desktop)
    await db.commit()
    await db.refresh(desktop)

    # 3. Fire background task to wait for completion and update record
    asyncio.create_task(
        _provision_desktop_background(
            desktop_id=desktop.id,
            tenant_id=tenant.id,
            cloudwm_api_url=tenant.cloudwm_api_url,
            cloudwm_client_id=tenant.cloudwm_client_id,
            cloudwm_secret=decrypt_value(tenant.cloudwm_secret_encrypted),
            command_id=command_id,
            vm_name=vm_name,
            vm_password=req.password,
        )
    )

    return {
        "id": str(desktop.id),
        "display_name": desktop.display_name,
        "cloudwm_server_id": str(command_id),
        "current_state": "provisioning",
        "message": "VM creation started. This may take a few minutes.",
    }


@router.patch("/desktops/{desktop_id}")
async def update_desktop(
    desktop_id: str,
    req: UpdateDesktopRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Update desktop assignment — reassign to another user or unassign."""
    result = await db.execute(
        select(DesktopAssignment).where(
            DesktopAssignment.id == uuid.UUID(desktop_id),
            DesktopAssignment.tenant_id == admin.tenant_id,
        )
    )
    desktop = result.scalar_one_or_none()
    if not desktop:
        raise HTTPException(status_code=404, detail="Desktop not found")

    if req.user_id is not None:
        # Reassign to a different user
        user_result = await db.execute(
            select(User).where(
                User.id == uuid.UUID(req.user_id),
                User.tenant_id == admin.tenant_id,
            )
        )
        user = user_result.scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        desktop.user_id = user.id
    else:
        # Unassign
        desktop.user_id = None

    await db.commit()
    return {"message": "Desktop updated"}


@router.delete("/desktops/{desktop_id}")
async def unregister_desktop(
    desktop_id: str,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Remove a desktop from the VDI system without terminating the server."""
    result = await db.execute(
        select(DesktopAssignment).where(
            DesktopAssignment.id == uuid.UUID(desktop_id),
            DesktopAssignment.tenant_id == admin.tenant_id,
        )
    )
    desktop = result.scalar_one_or_none()
    if not desktop:
        raise HTTPException(status_code=404, detail="Desktop not found")

    # Delete all sessions for this desktop
    all_sessions = await db.execute(
        select(Session).where(Session.desktop_id == desktop.id)
    )
    for s in all_sessions.scalars().all():
        await db.delete(s)

    await db.delete(desktop)
    await db.commit()
    return {"message": "Desktop unregistered"}


class TerminateDesktopRequest(BaseModel):
    mfa_code: str


@router.post("/desktops/{desktop_id}/terminate")
async def terminate_desktop(
    desktop_id: str,
    req: TerminateDesktopRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Terminate (destroy) the server and remove the desktop. Requires MFA."""
    await _verify_admin_mfa(admin, req.mfa_code, db)

    result = await db.execute(
        select(DesktopAssignment).where(
            DesktopAssignment.id == uuid.UUID(desktop_id),
            DesktopAssignment.tenant_id == admin.tenant_id,
        )
    )
    desktop = result.scalar_one_or_none()
    if not desktop:
        raise HTTPException(status_code=404, detail="Desktop not found")

    # Terminate the server via CloudWM
    tenant = await db.execute(select(Tenant).where(Tenant.id == admin.tenant_id))
    tenant = tenant.scalar_one()
    cloudwm = CloudWMClient(
        api_url=tenant.cloudwm_api_url,
        client_id=tenant.cloudwm_client_id,
        secret=decrypt_value(tenant.cloudwm_secret_encrypted),
    )
    try:
        await cloudwm.terminate_server(desktop.cloudwm_server_id)
        logger.info("Terminated server %s for desktop %s", desktop.cloudwm_server_id, desktop.display_name)
    except Exception as e:
        logger.exception("Failed to terminate server %s", desktop.cloudwm_server_id)
        raise HTTPException(status_code=502, detail="Failed to terminate server. Please try again.")

    # Delete all sessions for this desktop
    all_sessions = await db.execute(
        select(Session).where(Session.desktop_id == desktop.id)
    )
    for s in all_sessions.scalars().all():
        await db.delete(s)

    await db.delete(desktop)
    await db.commit()
    return {"message": "Server terminated and desktop removed"}


@router.post("/desktops/{desktop_id}/activate")
async def activate_desktop(
    desktop_id: str,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(DesktopAssignment).where(
            DesktopAssignment.id == uuid.UUID(desktop_id),
            DesktopAssignment.tenant_id == admin.tenant_id,
        )
    )
    desktop = result.scalar_one_or_none()
    if not desktop:
        raise HTTPException(status_code=404, detail="Desktop not found")

    desktop.is_active = True
    await db.commit()
    return {"message": "Desktop activated"}


class PowerActionRequest(BaseModel):
    action: str = Field(..., pattern=r"^(suspend|resume|power_on|power_off|restart)$")


@router.post("/desktops/{desktop_id}/power")
async def desktop_power_action(
    desktop_id: str,
    req: PowerActionRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Manual power control for a desktop VM."""
    valid_actions = ("suspend", "resume", "power_on", "power_off", "restart")
    if req.action not in valid_actions:
        raise HTTPException(status_code=400, detail=f"Invalid action. Must be one of: {', '.join(valid_actions)}")

    result = await db.execute(
        select(DesktopAssignment).where(
            DesktopAssignment.id == uuid.UUID(desktop_id),
            DesktopAssignment.tenant_id == admin.tenant_id,
        )
    )
    desktop = result.scalar_one_or_none()
    if not desktop:
        raise HTTPException(status_code=404, detail="Desktop not found")

    tenant = (await db.execute(select(Tenant).where(Tenant.id == admin.tenant_id))).scalar_one()
    cloudwm = CloudWMClient(
        api_url=tenant.cloudwm_api_url,
        client_id=tenant.cloudwm_client_id,
        secret=decrypt_value(tenant.cloudwm_secret_encrypted),
    )

    # Refresh actual state from CloudWM before acting
    actual_state = await cloudwm.get_server_state(desktop.cloudwm_server_id)

    # Check if the action is redundant (VM already in desired state)
    no_op_map = {
        "suspend": "suspended",
        "resume": "on",
        "power_on": "on",
        "power_off": "off",
    }
    if req.action in no_op_map and actual_state == no_op_map[req.action]:
        desktop.current_state = actual_state
        desktop.last_state_check = datetime.utcnow()
        await db.commit()
        return {"message": f"VM is already {actual_state}", "state": desktop.current_state}

    try:
        if req.action == "suspend":
            await cloudwm.suspend(desktop.cloudwm_server_id)
            desktop.current_state = "suspended"
        elif req.action == "resume":
            await cloudwm.resume(desktop.cloudwm_server_id)
            desktop.current_state = "on"
        elif req.action == "power_on":
            await cloudwm.power_on(desktop.cloudwm_server_id)
            desktop.current_state = "on"
        elif req.action == "power_off":
            await cloudwm.power_off(desktop.cloudwm_server_id)
            desktop.current_state = "off"
        elif req.action == "restart":
            async with await cloudwm._get_client() as client:
                headers = await cloudwm._auth_headers()
                headers["Content-Type"] = "application/x-www-form-urlencoded"
                resp = await client.put(
                    f"{cloudwm.base_url}/server/{desktop.cloudwm_server_id}/power",
                    headers=headers,
                    content="power=restart",
                )
                resp.raise_for_status()
            desktop.current_state = "on"
    except Exception as e:
        # On failure, sync state from CloudWM so UI reflects reality
        fallback_state = await cloudwm.get_server_state(desktop.cloudwm_server_id)
        if fallback_state != "unknown":
            desktop.current_state = fallback_state
            desktop.last_state_check = datetime.utcnow()
            await db.commit()
        logger.exception("Power action %s failed for %s", req.action, desktop.cloudwm_server_id)
        raise HTTPException(status_code=502, detail="Power action failed. Please try again.")

    desktop.last_state_check = datetime.utcnow()
    await db.commit()
    return {"message": f"Power action '{req.action}' executed", "state": desktop.current_state}


# ── Sessions ──


@router.get("/sessions")
async def list_active_sessions(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Session)
        .join(Session.desktop)
        .where(
            DesktopAssignment.tenant_id == admin.tenant_id,
            Session.ended_at == None,
        )
        .order_by(Session.started_at.desc())
    )
    sessions = result.scalars().all()

    return [
        {
            "id": str(s.id),
            "user_id": str(s.user_id),
            "desktop_id": str(s.desktop_id),
            "started_at": s.started_at.isoformat() + "Z",
            "last_heartbeat": s.last_heartbeat.isoformat() + "Z" if s.last_heartbeat else None,
            "connection_type": s.connection_type or "browser",
            "proxy_port": s.proxy_port,
            "client_ip": s.client_ip,
        }
        for s in sessions
    ]


@router.delete("/sessions/{session_id}")
async def force_terminate_session(
    session_id: str,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Session)
        .join(Session.desktop)
        .where(
            Session.id == uuid.UUID(session_id),
            DesktopAssignment.tenant_id == admin.tenant_id,
            Session.ended_at == None,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Active session not found")

    session.ended_at = datetime.utcnow()
    session.end_reason = "admin_terminate"

    # Clean up TCP proxy if this was a native session
    if session.proxy_pid:
        from app.services.rdp_proxy import RDPProxyManager
        proxy_mgr = RDPProxyManager()
        await proxy_mgr.stop_proxy(session.proxy_pid, port=session.proxy_port)

    await db.commit()
    return {"message": "Session terminated"}


# ── Audit ──


@router.get("/audit")
async def get_audit_log(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    limit: int = 100,
):
    """Return recent session history as audit log."""
    result = await db.execute(
        select(Session)
        .join(Session.desktop)
        .where(DesktopAssignment.tenant_id == admin.tenant_id)
        .order_by(Session.started_at.desc())
        .limit(limit)
    )
    sessions = result.scalars().all()

    # Get user emails
    user_ids = list(set(s.user_id for s in sessions))
    users_result = await db.execute(select(User).where(User.id.in_(user_ids)))
    users_map = {u.id: u.username for u in users_result.scalars().all()}

    return [
        {
            "session_id": str(s.id),
            "user_email": users_map.get(s.user_id, "unknown"),
            "desktop_id": str(s.desktop_id),
            "started_at": s.started_at.isoformat() + "Z",
            "ended_at": s.ended_at.isoformat() + "Z" if s.ended_at else None,
            "end_reason": s.end_reason,
            "client_ip": s.client_ip,
        }
        for s in sessions
    ]


# ── Settings ──


@router.put("/settings")
async def update_settings(
    req: UpdateSettingsRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    tenant = await _get_tenant(db, admin.tenant_id)

    if req.suspend_threshold_minutes is not None:
        tenant.suspend_threshold_minutes = req.suspend_threshold_minutes
    if req.max_session_hours is not None:
        tenant.max_session_hours = req.max_session_hours
    if req.nat_gateway_enabled is not None:
        tenant.nat_gateway_enabled = req.nat_gateway_enabled
    if req.gateway_lan_ip is not None:
        tenant.gateway_lan_ip = req.gateway_lan_ip
    if req.default_network_name is not None:
        tenant.default_network_name = req.default_network_name

    await db.commit()
    return {
        "suspend_threshold_minutes": tenant.suspend_threshold_minutes,
        "max_session_hours": tenant.max_session_hours,
        "nat_gateway_enabled": tenant.nat_gateway_enabled,
        "gateway_lan_ip": tenant.gateway_lan_ip,
        "default_network_name": tenant.default_network_name,
    }


@router.get("/settings")
async def get_settings_endpoint(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    tenant = await _get_tenant(db, admin.tenant_id)
    return {
        "suspend_threshold_minutes": tenant.suspend_threshold_minutes,
        "max_session_hours": tenant.max_session_hours,
        "tenant_name": tenant.name,
        "tenant_slug": tenant.slug,
        "cloudwm_api_url": tenant.cloudwm_api_url,
        "cloudwm_client_id": tenant.cloudwm_client_id,
        "cloudwm_configured": bool(tenant.cloudwm_client_id),
        "cloudwm_setup_required": tenant.cloudwm_setup_required,
        "system_server_id": tenant.system_server_id,
        "system_server_name": tenant.system_server_name,
        "locked_datacenter": tenant.locked_datacenter,
        "last_sync_at": tenant.last_sync_at.isoformat() if tenant.last_sync_at else None,
        "nat_gateway_enabled": tenant.nat_gateway_enabled,
        "gateway_lan_ip": tenant.gateway_lan_ip,
        "default_network_name": tenant.default_network_name,
        "duo_enabled": tenant.duo_enabled,
        "duo_ikey": (tenant.duo_ikey[:4] + "***" + tenant.duo_ikey[-4:]) if tenant.duo_ikey and len(tenant.duo_ikey) > 8 else ("***" if tenant.duo_ikey else ""),
        "duo_api_host": tenant.duo_api_host or "",
        "duo_auth_mode": tenant.duo_auth_mode,
        "duo_configured": bool(tenant.duo_ikey and tenant.duo_skey_encrypted and tenant.duo_api_host),
    }


# ── CloudWM API Settings ──


class CloudWMSettingsRequest(BaseModel):
    api_url: str = Field(..., max_length=500)
    client_id: str = Field(..., min_length=1, max_length=255)
    secret: str = Field(..., min_length=1, max_length=255)


@router.put("/settings/cloudwm")
async def update_cloudwm_settings(
    req: CloudWMSettingsRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    _validate_url_not_internal(req.api_url, "CloudWM API URL")
    tenant = await _get_tenant(db, admin.tenant_id)
    tenant.cloudwm_api_url = req.api_url
    tenant.cloudwm_client_id = req.client_id
    tenant.cloudwm_secret_encrypted = encrypt_value(req.secret)
    await db.commit()

    # Auto-trigger discover + sync after saving credentials
    discover_result = await _discover_system_server(tenant, req.api_url, req.client_id, req.secret, db)
    return {
        "message": "CloudWM credentials saved",
        **discover_result,
    }


@router.post("/settings/cloudwm/test")
async def test_cloudwm_connection(
    req: CloudWMSettingsRequest,
    admin: User = Depends(require_admin),
):
    """Test CloudWM API credentials without saving."""
    _validate_url_not_internal(req.api_url, "CloudWM API URL")
    try:
        client = CloudWMClient(
            api_url=req.api_url,
            client_id=req.client_id,
            secret=req.secret,
        )
        token = await client.authenticate()
        return {"status": "ok", "message": "Authentication successful"}
    except Exception as e:
        logger.warning("CloudWM connection test failed: %s", str(e))
        raise HTTPException(status_code=400, detail="Connection failed. Check your credentials and API URL.")


async def _discover_system_server(
    tenant: Tenant, api_url: str, client_id: str, secret: str, db: AsyncSession,
) -> dict:
    """Discover servers tagged cwmvdi-{userId} via /svc/serversRuntime."""
    try:
        cloudwm = CloudWMClient(api_url=api_url, client_id=client_id, secret=secret)

        # Get the account userId to build the expected tag
        account_id = await cloudwm.get_account_user_id()
        expected_tag = f"cwmvdi-{account_id}"

        # Use /svc/serversRuntime to get servers with tags
        matches = await cloudwm.find_servers_by_tag(expected_tag)

        if len(matches) == 0:
            return {
                "discover_status": "no_match",
                "servers": [],
                "expected_tag": expected_tag,
            }
        elif len(matches) == 1:
            server = matches[0]
            tenant.system_server_id = server["id"]
            tenant.system_server_name = server["name"]
            tenant.locked_datacenter = server.get("datacenter", "")
            tenant.cloudwm_setup_required = False
            await db.commit()
            # Auto-sync images and networks
            await _sync_cached_data(tenant, cloudwm, db)
            return {
                "discover_status": "found",
                "system_server_id": server["id"],
                "system_server_name": server["name"],
                "locked_datacenter": server.get("datacenter", ""),
            }
        else:
            return {
                "discover_status": "multiple",
                "servers": [
                    {"id": s["id"], "name": s["name"], "datacenter": s.get("datacenter", ""), "power": s.get("state", "")}
                    for s in matches
                ],
            }
    except Exception as e:
        logger.warning("Server discovery failed: %s", str(e))
        return {"discover_status": "error", "detail": str(e)}


async def _sync_cached_data(tenant: Tenant, cloudwm: CloudWMClient, db: AsyncSession) -> None:
    """Sync images and networks from CloudWM to local cache."""
    dc = tenant.locked_datacenter
    if not dc:
        return

    # Fetch from Kamatera
    images = await cloudwm.list_images(datacenter=dc)
    networks = await cloudwm.list_networks(datacenter=dc)

    # Clear old cached data for this tenant
    await db.execute(
        CachedImage.__table__.delete().where(CachedImage.tenant_id == tenant.id)
    )
    await db.execute(
        CachedNetwork.__table__.delete().where(CachedNetwork.tenant_id == tenant.id)
    )

    # Insert images
    now = datetime.utcnow()
    for img in images:
        db.add(CachedImage(
            tenant_id=tenant.id,
            image_id=img["id"],
            description=img.get("description", ""),
            size_gb=img.get("size_gb", 0),
            datacenter=dc,
            synced_at=now,
        ))

    # Insert networks
    for net in networks:
        db.add(CachedNetwork(
            tenant_id=tenant.id,
            name=net["name"],
            subnet=net.get("subnet", ""),
            datacenter=dc,
            synced_at=now,
        ))

    tenant.last_sync_at = now
    await db.commit()
    logger.info("Synced %d images and %d networks for tenant %s (dc: %s)",
                len(images), len(networks), tenant.id, dc)


@router.post("/settings/cloudwm/discover")
async def discover_system_server(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Discover cwmvdi-* servers in Kamatera."""
    tenant = await _get_tenant(db, admin.tenant_id)
    if not tenant.cloudwm_client_id:
        raise HTTPException(status_code=400, detail="CloudWM API not configured")

    result = await _discover_system_server(
        tenant,
        tenant.cloudwm_api_url,
        tenant.cloudwm_client_id,
        decrypt_value(tenant.cloudwm_secret_encrypted),
        db,
    )
    return result


class SelectServerRequest(BaseModel):
    server_id: str


@router.post("/settings/cloudwm/select-server")
async def select_system_server(
    req: SelectServerRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Select a specific cwmvdi-* server when multiple matches found."""
    tenant = await _get_tenant(db, admin.tenant_id)
    if not tenant.cloudwm_client_id:
        raise HTTPException(status_code=400, detail="CloudWM API not configured")

    cloudwm = CloudWMClient(
        api_url=tenant.cloudwm_api_url,
        client_id=tenant.cloudwm_client_id,
        secret=decrypt_value(tenant.cloudwm_secret_encrypted),
    )

    # Verify the server exists and has a cwmvdi- tag
    account_id = await cloudwm.get_account_user_id()
    expected_tag = f"cwmvdi-{account_id}"
    matches = await cloudwm.find_servers_by_tag(expected_tag)
    server = next((s for s in matches if s["id"] == req.server_id), None)
    if not server:
        raise HTTPException(status_code=404, detail="Server not found or not tagged with " + expected_tag)

    tenant.system_server_id = server["id"]
    tenant.system_server_name = server["name"]
    tenant.locked_datacenter = server.get("datacenter", "")
    tenant.cloudwm_setup_required = False
    await db.commit()

    # Auto-sync
    await _sync_cached_data(tenant, cloudwm, db)

    return {
        "system_server_id": server["id"],
        "system_server_name": server["name"],
        "locked_datacenter": server.get("datacenter", ""),
    }


@router.post("/settings/cloudwm/sync")
async def sync_from_console(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Re-sync images and networks from Kamatera to local cache."""
    tenant = await _get_tenant(db, admin.tenant_id)
    if not tenant.cloudwm_client_id:
        raise HTTPException(status_code=400, detail="CloudWM API not configured")
    if not tenant.locked_datacenter:
        raise HTTPException(status_code=400, detail="No system server discovered yet. Run discover first.")

    cloudwm = CloudWMClient(
        api_url=tenant.cloudwm_api_url,
        client_id=tenant.cloudwm_client_id,
        secret=decrypt_value(tenant.cloudwm_secret_encrypted),
    )
    await _sync_cached_data(tenant, cloudwm, db)
    return {"message": "Sync complete", "last_sync_at": tenant.last_sync_at.isoformat()}


# ── Images & Networks (from local cache) ──


@router.get("/images")
async def list_images(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """List cached OS images for the tenant's locked datacenter."""
    tenant = await _get_tenant(db, admin.tenant_id)
    if not tenant.locked_datacenter:
        raise HTTPException(status_code=400, detail="No datacenter configured. Run server discovery first.")

    result = await db.execute(
        select(CachedImage)
        .where(CachedImage.tenant_id == tenant.id)
        .order_by(CachedImage.description)
    )
    images = result.scalars().all()
    return [
        {"id": img.image_id, "description": img.description, "size_gb": img.size_gb}
        for img in images
    ]


# ── Networks ──


@router.get("/networks")
async def list_networks(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """List cached networks for the tenant's locked datacenter."""
    tenant = await _get_tenant(db, admin.tenant_id)
    if not tenant.locked_datacenter:
        raise HTTPException(status_code=400, detail="No datacenter configured. Run server discovery first.")

    result = await db.execute(
        select(CachedNetwork)
        .where(CachedNetwork.tenant_id == tenant.id)
        .order_by(CachedNetwork.name)
    )
    networks = result.scalars().all()
    return [
        {"name": net.name, "subnet": net.subnet}
        for net in networks
    ]


# ── DUO Security Settings ──


class DuoSettingsRequest(BaseModel):
    duo_enabled: bool
    duo_ikey: str = Field("", max_length=255)
    duo_skey: str = Field("", max_length=255)
    duo_api_host: str = Field("", max_length=255)
    duo_auth_mode: str = Field("password_duo", pattern=r"^(password_duo|duo_only)$")


@router.put("/settings/duo")
async def update_duo_settings(
    req: DuoSettingsRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Save DUO Security settings."""
    tenant = await _get_tenant(db, admin.tenant_id)

    if req.duo_enabled:
        if not req.duo_ikey or not req.duo_api_host:
            raise HTTPException(status_code=400, detail="Integration key and API hostname are required")
        if not req.duo_skey and not tenant.duo_skey_encrypted:
            raise HTTPException(status_code=400, detail="Secret key is required")
        # Validate DUO host to prevent SSRF
        from app.services.duo import validate_duo_host, DuoAuthError
        try:
            validate_duo_host(req.duo_api_host)
        except DuoAuthError as e:
            raise HTTPException(status_code=400, detail=e.message)

    tenant.duo_enabled = req.duo_enabled
    tenant.duo_ikey = req.duo_ikey or None
    tenant.duo_api_host = req.duo_api_host or None
    tenant.duo_auth_mode = req.duo_auth_mode

    if req.duo_skey:
        tenant.duo_skey_encrypted = encrypt_value(req.duo_skey)

    await db.commit()
    return {
        "message": "DUO settings saved",
        "duo_enabled": tenant.duo_enabled,
        "duo_ikey": tenant.duo_ikey,
        "duo_api_host": tenant.duo_api_host,
        "duo_auth_mode": tenant.duo_auth_mode,
        "duo_configured": bool(tenant.duo_ikey and tenant.duo_skey_encrypted and tenant.duo_api_host),
    }


@router.post("/settings/duo/test")
async def test_duo_connection(
    req: DuoSettingsRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Test DUO API credentials without saving."""
    from app.services.duo import DuoClient, DuoAuthError, validate_duo_host

    # Validate host first
    try:
        validate_duo_host(req.duo_api_host)
    except DuoAuthError as e:
        raise HTTPException(status_code=400, detail=e.message)

    skey = req.duo_skey
    if not skey:
        tenant = await _get_tenant(db, admin.tenant_id)
        if tenant.duo_skey_encrypted:
            skey = decrypt_value(tenant.duo_skey_encrypted)

    if not skey or not req.duo_ikey or not req.duo_api_host:
        raise HTTPException(status_code=400, detail="All DUO credentials are required for testing")

    try:
        client = DuoClient(req.duo_ikey, skey, req.duo_api_host)
        await client.check()
        return {"status": "ok", "message": "DUO connection successful"}
    except DuoAuthError:
        raise HTTPException(status_code=400, detail="DUO connection failed. Check your credentials.")
    except Exception:
        raise HTTPException(status_code=400, detail="DUO connection failed. Check your credentials and API hostname.")


# ── System Status ──


async def _check_postgres(db: AsyncSession) -> dict:
    try:
        await db.execute(select(func.count()).select_from(User))
        return {"name": "postgres", "status": "running", "healthy": True}
    except Exception:
        return {"name": "postgres", "status": "down", "healthy": False}


async def _check_redis() -> dict:
    import redis as redis_lib
    try:
        r = redis_lib.from_url(settings.redis_url, socket_timeout=2)
        r.ping()
        return {"name": "redis", "status": "running", "healthy": True}
    except Exception:
        return {"name": "redis", "status": "down", "healthy": False}


async def _check_guacamole() -> dict:
    import httpx
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            resp = await client.get("http://guacamole:8080/guacamole/api/languages")
            return {"name": "guacamole", "status": "running" if resp.status_code == 200 else "unhealthy", "healthy": resp.status_code == 200}
    except Exception:
        return {"name": "guacamole", "status": "down", "healthy": False}


async def _check_guacd() -> dict:
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection("guacd", 4822), timeout=3
        )
        writer.close()
        await writer.wait_closed()
        return {"name": "guacd", "status": "running", "healthy": True}
    except Exception:
        return {"name": "guacd", "status": "down", "healthy": False}


@router.get("/system-status")
async def get_system_status(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Return system metrics (CPU, RAM, Disk, Network) and service statuses."""
    loop = asyncio.get_event_loop()

    # CPU (run in executor since it blocks for interval)
    cpu_percent = await loop.run_in_executor(None, lambda: psutil.cpu_percent(interval=0.5))
    cpu_count = psutil.cpu_count()

    # RAM
    mem = psutil.virtual_memory()
    ram = {
        "total_gb": round(mem.total / (1024 ** 3), 1),
        "used_gb": round(mem.used / (1024 ** 3), 1),
        "available_gb": round(mem.available / (1024 ** 3), 1),
        "percent": mem.percent,
    }

    # Disk
    disk = psutil.disk_usage("/")
    disk_info = {
        "total_gb": round(disk.total / (1024 ** 3), 1),
        "used_gb": round(disk.used / (1024 ** 3), 1),
        "free_gb": round(disk.free / (1024 ** 3), 1),
        "percent": disk.percent,
    }

    # Network
    net = psutil.net_io_counters()
    network = {
        "bytes_sent": net.bytes_sent,
        "bytes_recv": net.bytes_recv,
        "bytes_sent_mb": round(net.bytes_sent / (1024 ** 2), 1),
        "bytes_recv_mb": round(net.bytes_recv / (1024 ** 2), 1),
        "packets_sent": net.packets_sent,
        "packets_recv": net.packets_recv,
    }

    # Services — check actual connectivity
    services = await asyncio.gather(
        _check_postgres(db),
        _check_redis(),
        _check_guacamole(),
        _check_guacd(),
    )
    # Backend is obviously running if we got here
    services_list = list(services) + [{"name": "backend", "status": "running", "healthy": True}]

    # Uptime
    boot_time = datetime.fromtimestamp(psutil.boot_time())
    uptime_seconds = (datetime.now() - boot_time).total_seconds()
    days = int(uptime_seconds // 86400)
    hours = int((uptime_seconds % 86400) // 3600)
    minutes = int((uptime_seconds % 3600) // 60)
    uptime_str = f"{days}d {hours}h {minutes}m"

    return {
        "cpu": {"percent": cpu_percent, "cores": cpu_count},
        "ram": ram,
        "disk": disk_info,
        "network": network,
        "services": services_list,
        "uptime": uptime_str,
    }


