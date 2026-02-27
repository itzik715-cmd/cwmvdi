import asyncio
import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
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
from app.services.auth import hash_password
from app.services.boundary import BoundaryClient
from app.services.cloudwm import CloudWMClient
from app.services.encryption import encrypt_value, decrypt_value

logger = logging.getLogger(__name__)

router = APIRouter()
settings = get_settings()


# ── Schemas ──


class CreateUserRequest(BaseModel):
    email: EmailStr
    password: str
    role: str = "user"


class CreateDesktopRequest(BaseModel):
    user_id: str
    display_name: str
    image_id: str
    cpu: str = "2B"
    ram: int = 4096
    disk_size: int = 50
    password: str = "KamVDI2026Desk!"
    network_name: str = "wan"


class UpdateDesktopRequest(BaseModel):
    user_id: str | None = None  # None = unassign


class UpdateSettingsRequest(BaseModel):
    suspend_threshold_minutes: int | None = None
    max_session_hours: int | None = None


# ── Helpers ──


async def _get_tenant(db: AsyncSession, tenant_id: uuid.UUID) -> Tenant:
    result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return tenant


async def _get_boundary() -> BoundaryClient:
    client = BoundaryClient(
        controller_url=settings.boundary_url,
        tls_insecure=settings.boundary_tls_insecure,
    )
    await client.authenticate(
        auth_method_id=settings.boundary_auth_method_id,
        login_name=settings.boundary_admin_login,
        password=settings.boundary_admin_password,
    )
    return client


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
            "email": u.email,
            "role": u.role,
            "mfa_enabled": u.mfa_enabled,
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
    # Check for existing user
    existing = await db.execute(
        select(User).where(
            User.tenant_id == admin.tenant_id, User.email == req.email
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="User with this email already exists")

    user = User(
        tenant_id=admin.tenant_id,
        email=req.email,
        password_hash=hash_password(req.password),
        role=req.role,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    return {"id": str(user.id), "email": user.email, "role": user.role}


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

            for d in desktops:
                if d.current_state == "provisioning":
                    continue  # don't override provisioning state
                power = server_map.get(d.cloudwm_server_id)
                if power:
                    new_state = "on" if power == "on" else "off" if power == "off" else d.current_state
                    if new_state != d.current_state:
                        d.current_state = new_state
                        d.last_state_check = datetime.utcnow()
            await db.commit()
        except Exception:
            logger.warning("Failed to refresh desktop states from CloudWM")

    # Get user emails for display
    user_ids = [d.user_id for d in desktops if d.user_id]
    users_map = {}
    if user_ids:
        users_result = await db.execute(select(User).where(User.id.in_(user_ids)))
        users_map = {u.id: u.email for u in users_result.scalars().all()}

    return [
        {
            "id": str(d.id),
            "display_name": d.display_name,
            "user_email": users_map.get(d.user_id, "Unassigned") if d.user_id else "Unassigned",
            "user_id": str(d.user_id) if d.user_id else None,
            "cloudwm_server_id": d.cloudwm_server_id,
            "current_state": d.current_state,
            "boundary_target_id": d.boundary_target_id,
            "is_active": d.is_active,
            "created_at": d.created_at.isoformat(),
        }
        for d in desktops
    ]


async def _provision_desktop_background(
    desktop_id: uuid.UUID,
    tenant_id: uuid.UUID,
    cloudwm_api_url: str,
    cloudwm_client_id: str,
    cloudwm_secret: str,
    command_id: int,
    vm_name: str,
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

    vm_name = f"kamvdi-{account_id}-{req.display_name.lower().replace(' ', '-')}"

    # Get the traffic package ID for this datacenter
    traffic_id = await cloudwm.get_traffic_id(datacenter)

    # Build server params
    server_params = {
        "name": vm_name,
        "password": req.password,
        "datacenter": datacenter,
        "disk_src_0": req.image_id,
        "disk_size_0": req.disk_size,
        "cpu": req.cpu,
        "ram": req.ram,
        "network_name_0": req.network_name,
        "network_ip_0": "auto",
        "billing": "hourly",
        "traffic": traffic_id,
        "power": True,
    }

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
async def delete_desktop(
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

    desktop.is_active = False
    await db.commit()
    return {"message": "Desktop deactivated"}


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
            "started_at": s.started_at.isoformat(),
            "last_heartbeat": s.last_heartbeat.isoformat() if s.last_heartbeat else None,
            "agent_version": s.agent_version,
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

    if session.boundary_session_id:
        boundary = await _get_boundary()
        await boundary.cancel_session(session.boundary_session_id)

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
    users_map = {u.id: u.email for u in users_result.scalars().all()}

    return [
        {
            "session_id": str(s.id),
            "user_email": users_map.get(s.user_id, "unknown"),
            "desktop_id": str(s.desktop_id),
            "started_at": s.started_at.isoformat(),
            "ended_at": s.ended_at.isoformat() if s.ended_at else None,
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

    await db.commit()
    return {
        "suspend_threshold_minutes": tenant.suspend_threshold_minutes,
        "max_session_hours": tenant.max_session_hours,
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
    }


# ── CloudWM API Settings ──


class CloudWMSettingsRequest(BaseModel):
    api_url: str
    client_id: str
    secret: str


@router.put("/settings/cloudwm")
async def update_cloudwm_settings(
    req: CloudWMSettingsRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
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
    try:
        client = CloudWMClient(
            api_url=req.api_url,
            client_id=req.client_id,
            secret=req.secret,
        )
        token = await client.authenticate()
        return {"status": "ok", "message": "Authentication successful"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Connection failed: {str(e)}")


async def _discover_system_server(
    tenant: Tenant, api_url: str, client_id: str, secret: str, db: AsyncSession,
) -> dict:
    """Discover servers tagged kamvdi-{userId} via /svc/serversRuntime."""
    try:
        cloudwm = CloudWMClient(api_url=api_url, client_id=client_id, secret=secret)

        # Get the account userId to build the expected tag
        account_id = await cloudwm.get_account_user_id()
        expected_tag = f"kamvdi-{account_id}"

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
    """Discover kamvdi-* servers in Kamatera."""
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
    """Select a specific kamvdi-* server when multiple matches found."""
    tenant = await _get_tenant(db, admin.tenant_id)
    if not tenant.cloudwm_client_id:
        raise HTTPException(status_code=400, detail="CloudWM API not configured")

    cloudwm = CloudWMClient(
        api_url=tenant.cloudwm_api_url,
        client_id=tenant.cloudwm_client_id,
        secret=decrypt_value(tenant.cloudwm_secret_encrypted),
    )

    # Verify the server exists and has a kamvdi- tag
    account_id = await cloudwm.get_account_user_id()
    expected_tag = f"kamvdi-{account_id}"
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


