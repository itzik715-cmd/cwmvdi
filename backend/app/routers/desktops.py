import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
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
from app.services.cloudwm import CloudWMClient
from app.services.encryption import decrypt_value
from app.services.guacamole import GuacamoleTokenService
from app.services.power_manager import PowerManager
from app.services.rdp_proxy import RDPProxyManager

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
    session_id: str
    desktop_name: str
    connection_type: str
    guacamole_token: str | None = None
    guacamole_url: str | None = None


class HeartbeatRequest(BaseModel):
    session_id: str


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
    """Power on VM if needed, create Guacamole session token."""
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

    if not desktop.vm_private_ip:
        raise HTTPException(status_code=400, detail="Desktop has no IP address configured")

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

    # 2. Create Guacamole token
    guac_service = GuacamoleTokenService(settings.guacamole_json_secret)
    connection_name = f"kamvdi-{desktop.id}"

    rdp_password = ""
    if desktop.vm_rdp_password_encrypted:
        rdp_password = decrypt_value(desktop.vm_rdp_password_encrypted)

    token = guac_service.create_connection_token(
        username=user.email,
        connection_name=connection_name,
        protocol="rdp",
        parameters={
            "hostname": desktop.vm_private_ip,
            "port": "3389",
            "username": desktop.vm_rdp_username or "Administrator",
            "password": rdp_password,
            "security": "any",
            "ignore-cert": "true",
            "resize-method": "display-update",
            "enable-wallpaper": "true",
        },
        expires_minutes=tenant.max_session_hours * 60,
    )

    # 3. Create session record
    session = Session(
        user_id=user.id,
        desktop_id=desktop.id,
        connection_type="browser",
        guacamole_connection_id=connection_name,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    return ConnectResponse(
        session_id=str(session.id),
        desktop_name=desktop.display_name,
        connection_type="browser",
        guacamole_token=token,
        guacamole_url=settings.guacamole_public_path,
    )


@router.post("/{desktop_id}/rdp-file")
async def download_rdp_file(
    desktop_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Power on VM, start TCP proxy, return .rdp file for native RDP client."""
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

    if not desktop.vm_private_ip:
        raise HTTPException(status_code=400, detail="Desktop has no IP address configured")

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

    # 2. Start socat proxy
    proxy_mgr = RDPProxyManager()
    port, pid = await proxy_mgr.start_proxy(desktop.vm_private_ip)

    # 3. Create session record
    public_ip = settings.server_public_ip or settings.portal_domain
    session = Session(
        user_id=user.id,
        desktop_id=desktop.id,
        connection_type="native",
        proxy_port=port,
        proxy_pid=pid,
    )
    db.add(session)
    await db.commit()

    # 4. Generate and return .rdp file
    rdp_content = proxy_mgr.generate_rdp_file(
        hostname=public_ip,
        port=port,
        username=desktop.vm_rdp_username or "Administrator",
        display_name=desktop.display_name,
    )

    filename = f"{desktop.display_name.replace(' ', '_')}.rdp"
    return Response(
        content=rdp_content,
        media_type="application/x-rdp",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
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

    # Clean up TCP proxy if this was a native session
    if session.proxy_pid:
        proxy_mgr = RDPProxyManager()
        await proxy_mgr.stop_proxy(session.proxy_pid)

    await db.commit()
    return {"message": "Disconnected"}


@router.post("/heartbeat")
async def heartbeat(
    req: HeartbeatRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Browser sends heartbeat every 60 seconds to keep session alive."""
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
    await db.commit()
    return {"status": "ok"}
