import asyncio
import logging
from datetime import datetime, timedelta

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

from app.config import get_settings
from app.models.desktop import DesktopAssignment
from app.models.session import Session
from app.models.tenant import Tenant
from app.services.cloudwm import CloudWMClient
from app.services.encryption import decrypt_value
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)
settings = get_settings()


def _get_sync_loop():
    """Get or create an event loop for running async code in Celery."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop


async def _check_idle_and_suspend_async():
    """Check for idle desktops and power them off.

    Covers all scenarios:
    1. Active session with stale heartbeat (user closed tab / went idle)
    2. Desktop is "on" but has no active session (user clicked Disconnect)
    3. Session exceeded max duration
    """
    engine = create_async_engine(settings.database_url, echo=False)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with session_factory() as db:
        # Get all tenants to know thresholds
        tenants_result = await db.execute(select(Tenant))
        tenants = {t.id: t for t in tenants_result.scalars().all()}

        if not tenants:
            return

        # ── 1. Check active sessions with stale heartbeat ──
        active_result = await db.execute(
            select(Session).where(Session.ended_at == None)
        )
        active_sessions = active_result.scalars().all()

        for session in active_sessions:
            try:
                desktop_result = await db.execute(
                    select(DesktopAssignment).where(DesktopAssignment.id == session.desktop_id)
                )
                desktop = desktop_result.scalar_one_or_none()
                if not desktop:
                    continue

                tenant = tenants.get(desktop.tenant_id)
                if not tenant:
                    continue

                threshold = timedelta(minutes=tenant.suspend_threshold_minutes)
                last_hb = session.last_heartbeat or session.started_at

                # Check max session hours first
                max_hours = timedelta(hours=tenant.max_session_hours)
                if datetime.utcnow() - session.started_at > max_hours:
                    logger.info(
                        "Session %s exceeded max duration of %d hours, suspending VM %s",
                        session.id, tenant.max_session_hours, desktop.cloudwm_server_id,
                    )
                    cloudwm = _get_cloudwm(tenant)
                    try:
                        await cloudwm.suspend(desktop.cloudwm_server_id)
                    except Exception:
                        pass  # best effort
                    session.ended_at = datetime.utcnow()
                    session.end_reason = "max_duration"
                    desktop.current_state = "suspended"
                    continue

                # Check idle heartbeat
                if datetime.utcnow() - last_hb > threshold:
                    logger.info(
                        "Session %s idle for > %d min, suspending VM %s",
                        session.id, tenant.suspend_threshold_minutes, desktop.cloudwm_server_id,
                    )
                    cloudwm = _get_cloudwm(tenant)
                    try:
                        await cloudwm.suspend(desktop.cloudwm_server_id)
                    except Exception:
                        # VM may already be suspended — check state
                        state = await cloudwm.get_server_state(desktop.cloudwm_server_id)
                        if state not in ("suspended", "off"):
                            raise
                        logger.info("VM %s already %s", desktop.cloudwm_server_id, state)

                    if session.proxy_pid:
                        import os, signal
                        try:
                            os.kill(session.proxy_pid, signal.SIGTERM)
                        except ProcessLookupError:
                            pass
                        # Clean up iptables rules for this port
                        if session.proxy_port:
                            from app.services.rdp_proxy import RDPProxyManager
                            await RDPProxyManager._remove_iptables_rules(session.proxy_port)

                    session.ended_at = datetime.utcnow()
                    session.end_reason = "idle_timeout"
                    desktop.current_state = "suspended"
                    logger.info("Session %s ended, VM suspended", session.id)

            except Exception:
                logger.exception("Error checking session %s", session.id)

        # ── 2. Check desktops that are "on" with no active session ──
        # (user clicked Disconnect — session ended but VM still running)
        all_desktops = await db.execute(
            select(DesktopAssignment).where(
                DesktopAssignment.is_active == True,
                DesktopAssignment.current_state.in_(["on", "starting"]),
            )
        )
        for desktop in all_desktops.scalars().all():
            try:
                # Check if there's an active session for this desktop
                active_count = await db.execute(
                    select(func.count()).select_from(Session).where(
                        Session.desktop_id == desktop.id,
                        Session.ended_at == None,
                    )
                )
                if active_count.scalar() > 0:
                    continue  # Has active session, handled above

                tenant = tenants.get(desktop.tenant_id)
                if not tenant:
                    continue

                threshold = timedelta(minutes=tenant.suspend_threshold_minutes)

                # Find the most recent ended session for this desktop
                last_session = await db.execute(
                    select(Session)
                    .where(Session.desktop_id == desktop.id)
                    .order_by(Session.ended_at.desc())
                    .limit(1)
                )
                last = last_session.scalar_one_or_none()

                if last and last.ended_at:
                    idle_since = last.ended_at
                else:
                    # No sessions ever — use desktop creation time
                    idle_since = desktop.created_at

                if datetime.utcnow() - idle_since > threshold:
                    logger.info(
                        "Desktop %s (%s) has no session and idle since %s, suspending",
                        desktop.display_name, desktop.cloudwm_server_id, idle_since,
                    )
                    cloudwm = _get_cloudwm(tenant)
                    try:
                        await cloudwm.suspend(desktop.cloudwm_server_id)
                    except Exception:
                        state = await cloudwm.get_server_state(desktop.cloudwm_server_id)
                        if state not in ("suspended", "off"):
                            raise
                        logger.info("VM %s already %s", desktop.cloudwm_server_id, state)
                    desktop.current_state = "suspended"
                    logger.info("VM %s suspended (no active session)", desktop.cloudwm_server_id)

            except Exception:
                logger.exception("Error checking idle desktop %s", desktop.id)

        await db.commit()

    await engine.dispose()


def _get_cloudwm(tenant: Tenant) -> CloudWMClient:
    return CloudWMClient(
        api_url=tenant.cloudwm_api_url,
        client_id=tenant.cloudwm_client_id,
        secret=decrypt_value(tenant.cloudwm_secret_encrypted),
    )


@celery_app.task(name="app.workers.auto_suspend.check_idle_sessions")
def check_idle_sessions():
    """Celery task: check for idle desktops and power them off."""
    loop = _get_sync_loop()
    loop.run_until_complete(_check_idle_and_suspend_async())
