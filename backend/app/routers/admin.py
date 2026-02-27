import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.dependencies import require_admin
from app.models.desktop import DesktopAssignment
from app.models.session import Session
from app.models.tenant import Tenant
from app.models.user import User
from app.services.auth import hash_password
from app.services.boundary import BoundaryClient
from app.services.cloudwm import CloudWMClient
from app.services.encryption import encrypt_value, decrypt_value

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
    datacenter: str = "IL-PT"
    password: str = "KamVDI2026Desk!"
    network_name: str = "wan"


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
    result = await db.execute(
        select(DesktopAssignment)
        .where(DesktopAssignment.tenant_id == admin.tenant_id)
        .order_by(DesktopAssignment.created_at)
    )
    desktops = result.scalars().all()

    # Get user emails for display
    user_ids = [d.user_id for d in desktops]
    users_result = await db.execute(select(User).where(User.id.in_(user_ids)))
    users_map = {u.id: u.email for u in users_result.scalars().all()}

    return [
        {
            "id": str(d.id),
            "display_name": d.display_name,
            "user_email": users_map.get(d.user_id, "unknown"),
            "user_id": str(d.user_id),
            "cloudwm_server_id": d.cloudwm_server_id,
            "current_state": d.current_state,
            "boundary_target_id": d.boundary_target_id,
            "is_active": d.is_active,
            "created_at": d.created_at.isoformat(),
        }
        for d in desktops
    ]


@router.post("/desktops")
async def create_desktop(
    req: CreateDesktopRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Create a new Windows VM and configure it in Boundary."""
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

    # 1. Create VM in CloudWM
    cloudwm = CloudWMClient(
        api_url=tenant.cloudwm_api_url,
        client_id=tenant.cloudwm_client_id,
        secret=decrypt_value(tenant.cloudwm_secret_encrypted),
    )

    vm_name = f"kamvdi-{tenant.slug}-{req.display_name.lower().replace(' ', '-')}"

    # Get the traffic package ID for this datacenter
    traffic_id = await cloudwm.get_traffic_id(req.datacenter)

    # Build server params
    server_params = {
        "name": vm_name,
        "password": req.password,
        "datacenter": req.datacenter,
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

    # Wait for VM creation (up to 5 minutes)
    queue_result = await cloudwm.wait_for_command(command_id, timeout=300)
    if not queue_result:
        raise HTTPException(status_code=500, detail="VM creation timed out or failed. Check CloudWM console.")

    # Extract server ID from queue log
    server_id = ""
    log_text = queue_result.get("log", "")
    if log_text:
        # The log usually contains the server ID/name
        for line in log_text.split("\n"):
            if "server" in line.lower() and ("id" in line.lower() or "created" in line.lower()):
                server_id = line.strip()
                break
    if not server_id:
        # Use command_id as fallback reference
        server_id = str(command_id)

    # Try to get the VM's IP address
    vm_ip = None
    try:
        server_data = await cloudwm.get_server(server_id)
        networks = server_data.get("networks", [])
        if isinstance(networks, list) and networks:
            for net in networks:
                if isinstance(net, dict):
                    ip = net.get("ip", net.get("ips", ""))
                    if ip:
                        vm_ip = ip if isinstance(ip, str) else str(ip)
                        break
    except Exception:
        pass  # Server might not be queryable by command_id

    # 2. Register in Boundary (if configured)
    if tenant.boundary_project_id and tenant.boundary_host_catalog_id:
        try:
            boundary = await _get_boundary()
            boundary_result = await boundary.setup_desktop_target(
                project_id=tenant.boundary_project_id,
                host_catalog_id=tenant.boundary_host_catalog_id,
                host_set_id=tenant.boundary_host_set_id,
                desktop_name=vm_name,
                vm_ip=vm_ip or "10.0.0.1",
            )
            boundary_target_id = boundary_result["target_id"]
            boundary_host_id = boundary_result["host_id"]
        except Exception:
            boundary_target_id = None
            boundary_host_id = None
    else:
        boundary_target_id = None
        boundary_host_id = None

    # 3. Create desktop assignment
    desktop = DesktopAssignment(
        user_id=user.id,
        tenant_id=tenant.id,
        cloudwm_server_id=server_id,
        vm_private_ip=vm_ip,
        boundary_target_id=boundary_target_id,
        boundary_host_id=boundary_host_id,
        display_name=req.display_name,
        current_state="on",
    )
    db.add(desktop)
    await db.commit()
    await db.refresh(desktop)

    return {
        "id": str(desktop.id),
        "display_name": desktop.display_name,
        "cloudwm_server_id": desktop.cloudwm_server_id,
        "boundary_target_id": desktop.boundary_target_id,
        "current_state": desktop.current_state,
    }


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
    return {"message": "CloudWM credentials saved"}


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


# ── Images & Datacenters ──


@router.get("/datacenters")
async def list_datacenters(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """List available datacenters from CloudWM."""
    tenant = await _get_tenant(db, admin.tenant_id)
    if not tenant.cloudwm_client_id:
        raise HTTPException(status_code=400, detail="CloudWM API not configured")

    cloudwm = CloudWMClient(
        api_url=tenant.cloudwm_api_url,
        client_id=tenant.cloudwm_client_id,
        secret=decrypt_value(tenant.cloudwm_secret_encrypted),
    )
    return await cloudwm.get_datacenters()


@router.get("/images")
async def list_images(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    datacenter: str = "IL-PT",
):
    """List available OS images from CloudWM for a datacenter."""
    tenant = await _get_tenant(db, admin.tenant_id)
    if not tenant.cloudwm_client_id:
        raise HTTPException(status_code=400, detail="CloudWM API not configured")

    cloudwm = CloudWMClient(
        api_url=tenant.cloudwm_api_url,
        client_id=tenant.cloudwm_client_id,
        secret=decrypt_value(tenant.cloudwm_secret_encrypted),
    )
    return await cloudwm.list_images(datacenter=datacenter)


# ── Networks ──


@router.get("/networks")
async def list_networks(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    datacenter: str = "IL-PT",
):
    """List available private networks from CloudWM."""
    tenant = await _get_tenant(db, admin.tenant_id)
    if not tenant.cloudwm_client_id:
        raise HTTPException(status_code=400, detail="CloudWM API not configured")

    cloudwm = CloudWMClient(
        api_url=tenant.cloudwm_api_url,
        client_id=tenant.cloudwm_client_id,
        secret=decrypt_value(tenant.cloudwm_secret_encrypted),
    )
    return await cloudwm.list_networks(datacenter=datacenter)


class CreateNetworkRequest(BaseModel):
    name: str
    datacenter: str = "IL"


@router.post("/networks")
async def create_network(
    req: CreateNetworkRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Create a new private VLAN network in CloudWM."""
    tenant = await _get_tenant(db, admin.tenant_id)
    if not tenant.cloudwm_client_id:
        raise HTTPException(status_code=400, detail="CloudWM API not configured")

    cloudwm = CloudWMClient(
        api_url=tenant.cloudwm_api_url,
        client_id=tenant.cloudwm_client_id,
        secret=decrypt_value(tenant.cloudwm_secret_encrypted),
    )
    try:
        result = await cloudwm.create_network(req.name, req.datacenter)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create network: {str(e)}")
