import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.dependencies import get_current_user
from app.models.desktop import DesktopAssignment
from app.models.session import Session
from app.models.tenant import Tenant
from app.models.user import User
from app.services.boundary import BoundaryClient
from app.services.cloudwm import CloudWMClient
from app.services.encryption import decrypt_value
from app.services.power_manager import PowerManager

router = APIRouter()
settings = get_settings()


# ── Schemas ──


class DesktopResponse(BaseModel):
    id: str
    display_name: str
    current_state: str
    cloudwm_server_id: str
    last_state_check: str | None


class ConnectResponse(BaseModel):
    uri: str
    session_id: str
    desktop_name: str


class HeartbeatRequest(BaseModel):
    session_id: str
    agent_version: str | None = None


# ── Helpers ──


async def _get_tenant(db: AsyncSession, tenant_id: uuid.UUID) -> Tenant:
    result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return tenant


def _get_cloudwm(tenant: Tenant) -> CloudWMClient:
    return CloudWMClient(
        api_url=tenant.cloudwm_api_url,
        client_id=tenant.cloudwm_client_id,
        secret=decrypt_value(tenant.cloudwm_secret_encrypted),
    )


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


# ── Endpoints ──


@router.get("", response_model=list[DesktopResponse])
async def list_desktops(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all desktops assigned to the current user with current state."""
    result = await db.execute(
        select(DesktopAssignment).where(
            DesktopAssignment.user_id == user.id,
            DesktopAssignment.is_active == True,
        )
    )
    desktops = result.scalars().all()

    # Optionally refresh state from CloudWM
    tenant = await _get_tenant(db, user.tenant_id)
    cloudwm = _get_cloudwm(tenant)

    response = []
    for d in desktops:
        # Refresh state if stale (> 30 seconds)
        if (
            d.last_state_check is None
            or (datetime.utcnow() - d.last_state_check).total_seconds() > 30
        ):
            state = await cloudwm.get_server_state(d.cloudwm_server_id)
            d.current_state = state
            d.last_state_check = datetime.utcnow()

        response.append(
            DesktopResponse(
                id=str(d.id),
                display_name=d.display_name,
                current_state=d.current_state,
                cloudwm_server_id=d.cloudwm_server_id,
                last_state_check=d.last_state_check.isoformat() if d.last_state_check else None,
            )
        )

    await db.commit()
    return response


@router.post("/{desktop_id}/connect", response_model=ConnectResponse)
async def connect_desktop(
    desktop_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Power on VM if needed, authorize Boundary session, return kamvdi:// URI."""
    result = await db.execute(
        select(DesktopAssignment).where(
            DesktopAssignment.id == uuid.UUID(desktop_id),
            DesktopAssignment.user_id == user.id,
            DesktopAssignment.is_active == True,
        )
    )
    desktop = result.scalar_one_or_none()
    if not desktop:
        raise HTTPException(status_code=404, detail="Desktop not found")

    if not desktop.boundary_target_id:
        raise HTTPException(status_code=400, detail="Desktop not configured in Boundary")

    tenant = await _get_tenant(db, user.tenant_id)
    cloudwm = _get_cloudwm(tenant)

    # 1. Power on VM if needed
    power_mgr = PowerManager()
    desktop.current_state = "starting"
    await db.commit()

    vm_ready = await power_mgr.ensure_vm_running(desktop, cloudwm)
    if not vm_ready:
        desktop.current_state = "unknown"
        await db.commit()
        raise HTTPException(status_code=503, detail="Failed to start desktop")

    desktop.current_state = "on"
    desktop.last_state_check = datetime.utcnow()

    # 2. Authorize Boundary session
    boundary = await _get_boundary()
    auth_token = await boundary.authorize_session(desktop.boundary_target_id)

    # 3. Create session record
    session = Session(
        user_id=user.id,
        desktop_id=desktop.id,
        boundary_auth_token=auth_token,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    # 4. Return URI for agent with Boundary token and worker address
    # Worker address must be the Boundary controller URL (agent uses it with -addr flag)
    boundary_addr = settings.boundary_url.replace("boundary", settings.portal_domain)
    kamvdi_uri = (
        f"kamvdi://connect"
        f"?token={auth_token}"
        f"&worker={boundary_addr}"
        f"&session={session.id}"
        f"&name={desktop.display_name}"
        f"&portal={settings.portal_url}"
    )

    return ConnectResponse(
        uri=kamvdi_uri,
        session_id=str(session.id),
        desktop_name=desktop.display_name,
    )


@router.post("/{desktop_id}/disconnect")
async def disconnect_desktop(
    desktop_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Disconnect from a desktop — end the active session."""
    result = await db.execute(
        select(Session).where(
            Session.desktop_id == uuid.UUID(desktop_id),
            Session.user_id == user.id,
            Session.ended_at == None,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="No active session found")

    session.ended_at = datetime.utcnow()
    session.end_reason = "user_disconnect"

    if session.boundary_session_id:
        boundary = await _get_boundary()
        await boundary.cancel_session(session.boundary_session_id)

    await db.commit()
    return {"message": "Disconnected"}


@router.post("/heartbeat")
async def heartbeat(
    req: HeartbeatRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Agent sends heartbeat every 60 seconds to keep session alive."""
    result = await db.execute(
        select(Session).where(
            Session.id == uuid.UUID(req.session_id),
            Session.user_id == user.id,
            Session.ended_at == None,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found or ended")

    session.last_heartbeat = datetime.utcnow()
    if req.agent_version:
        session.agent_version = req.agent_version
    await db.commit()
    return {"status": "ok"}
