import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, Response
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
from app.services.mfa import verify_totp
from app.services.rdp_proxy import RDPProxyManager

router = APIRouter()
settings = get_settings()


def _get_client_ip(request: Request) -> str | None:
    """Extract the real client IP, respecting X-Real-IP / X-Forwarded-For from nginx."""
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


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


class ConnectRequest(BaseModel):
    mfa_code: str | None = None


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


async def _verify_connection_mfa(user: User, mfa_code: str | None, db: AsyncSession) -> None:
    """Verify MFA code for desktop connections. Uses DUO if enabled, TOTP otherwise."""
    tenant = await _get_tenant(db, user.tenant_id)

    duo_active = (
        tenant.duo_enabled
        and tenant.duo_ikey and tenant.duo_skey_encrypted and tenant.duo_api_host
    )

    if duo_active:
        # DUO path
        from app.services.duo import verify_duo, DuoAuthError
        try:
            duo_skey = decrypt_value(tenant.duo_skey_encrypted)
            if mfa_code:
                await verify_duo(
                    tenant.duo_ikey, duo_skey, tenant.duo_api_host,
                    user.username, factor="passcode", passcode=mfa_code,
                )
            else:
                await verify_duo(
                    tenant.duo_ikey, duo_skey, tenant.duo_api_host,
                    user.username, factor="push",
                )
        except DuoAuthError:
            raise HTTPException(status_code=401, detail="MFA verification failed")
    else:
        # TOTP path
        if user.mfa_required and not user.mfa_enabled:
            raise HTTPException(status_code=403, detail="MFA setup required before connecting. Please set up MFA first.")
        if user.mfa_enabled and user.mfa_secret:
            if not mfa_code:
                raise HTTPException(status_code=403, detail="MFA code required to connect")
            if not verify_totp(user.mfa_secret, mfa_code):
                raise HTTPException(status_code=401, detail="Invalid MFA code")


# ── Endpoints ──


@router.get("/rdp-setup")
async def download_rdp_setup():
    """Download the .reg file to register the cwmvdi:// protocol handler."""
    reg_path = Path(__file__).resolve().parent.parent / "static" / "cwmvdi-rdp-handler.reg"
    return FileResponse(
        reg_path,
        media_type="application/octet-stream",
        filename="cwmvdi-rdp-handler.reg",
    )


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
    request: Request,
    req: ConnectRequest = ConnectRequest(),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Power on VM if needed, create Guacamole session token."""
    await _verify_connection_mfa(user, req.mfa_code, db)

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
    connection_name = f"cwmvdi-{desktop.id}"

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
    client_ip = _get_client_ip(request)
    session = Session(
        user_id=user.id,
        desktop_id=desktop.id,
        connection_type="browser",
        guacamole_connection_id=connection_name,
        client_ip=client_ip,
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
    request: Request,
    req: ConnectRequest = ConnectRequest(),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Power on VM, start TCP proxy, return .rdp file for native RDP client."""
    await _verify_connection_mfa(user, req.mfa_code, db)

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

    # 2. Start socat proxy (restricted to client IP)
    proxy_mgr = RDPProxyManager()
    client_ip = _get_client_ip(request)
    port, pid = await proxy_mgr.start_proxy(desktop.vm_private_ip, client_ip=client_ip)

    # 3. Create session record
    public_ip = settings.server_public_ip or settings.portal_domain
    session = Session(
        user_id=user.id,
        desktop_id=desktop.id,
        connection_type="native",
        proxy_port=port,
        proxy_pid=pid,
        client_ip=client_ip,
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


@router.post("/{desktop_id}/native-rdp")
async def native_rdp(
    desktop_id: str,
    request: Request,
    req: ConnectRequest = ConnectRequest(),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Power on VM, start TCP proxy, return connection details for ms-rd: URI."""
    await _verify_connection_mfa(user, req.mfa_code, db)

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

    # 2. Start socat proxy (restricted to client IP)
    proxy_mgr = RDPProxyManager()
    client_ip = _get_client_ip(request)
    port, pid = await proxy_mgr.start_proxy(desktop.vm_private_ip, client_ip=client_ip)

    # 3. Create session record
    public_ip = settings.server_public_ip or settings.portal_domain
    session = Session(
        user_id=user.id,
        desktop_id=desktop.id,
        connection_type="native",
        proxy_port=port,
        proxy_pid=pid,
        client_ip=client_ip,
    )
    db.add(session)
    await db.commit()

    # 4. Return connection details for ms-rd: URI
    return {
        "hostname": public_ip,
        "port": port,
        "username": desktop.vm_rdp_username or "Administrator",
        "display_name": desktop.display_name,
    }


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

    # Clean up TCP proxy and iptables rules if this was a native session
    if session.proxy_pid:
        proxy_mgr = RDPProxyManager()
        await proxy_mgr.stop_proxy(session.proxy_pid, port=session.proxy_port)

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
