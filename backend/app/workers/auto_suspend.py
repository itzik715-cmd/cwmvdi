import asyncio
import logging
from datetime import datetime, timedelta

from sqlalchemy import select
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


async def _check_idle_sessions_async():
    """Check for idle sessions and suspend their VMs."""
    engine = create_async_engine(settings.database_url, echo=False)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with session_factory() as db:
        # Get all active sessions
        result = await db.execute(
            select(Session)
            .where(Session.ended_at == None)
            .options()
        )
        active_sessions = result.scalars().all()

        if not active_sessions:
            logger.info("No active sessions to check")
            return

        logger.info("Checking %d active sessions for idle timeout", len(active_sessions))

        for session in active_sessions:
            try:
                # Get desktop and tenant info
                desktop_result = await db.execute(
                    select(DesktopAssignment).where(DesktopAssignment.id == session.desktop_id)
                )
                desktop = desktop_result.scalar_one_or_none()
                if not desktop:
                    continue

                tenant_result = await db.execute(
                    select(Tenant).where(Tenant.id == desktop.tenant_id)
                )
                tenant = tenant_result.scalar_one_or_none()
                if not tenant:
                    continue

                threshold = timedelta(minutes=tenant.suspend_threshold_minutes)
                last_hb = session.last_heartbeat or session.started_at

                if datetime.utcnow() - last_hb > threshold:
                    logger.info(
                        "Session %s idle for > %d min, suspending VM %s",
                        session.id,
                        tenant.suspend_threshold_minutes,
                        desktop.cloudwm_server_id,
                    )

                    # Suspend VM via CloudWM
                    cloudwm = CloudWMClient(
                        api_url=tenant.cloudwm_api_url,
                        client_id=tenant.cloudwm_client_id,
                        secret=decrypt_value(tenant.cloudwm_secret_encrypted),
                    )
                    await cloudwm.suspend(desktop.cloudwm_server_id)

                    # Clean up TCP proxy if this was a native session
                    if session.proxy_pid:
                        import os, signal
                        try:
                            os.kill(session.proxy_pid, signal.SIGTERM)
                        except ProcessLookupError:
                            pass

                    # Update DB
                    session.ended_at = datetime.utcnow()
                    session.end_reason = "idle_timeout"
                    desktop.current_state = "suspended"

                    logger.info("Session %s terminated due to idle timeout", session.id)

                # Check max session hours
                max_hours = timedelta(hours=tenant.max_session_hours)
                if datetime.utcnow() - session.started_at > max_hours:
                    logger.info(
                        "Session %s exceeded max duration of %d hours",
                        session.id,
                        tenant.max_session_hours,
                    )
                    session.ended_at = datetime.utcnow()
                    session.end_reason = "max_duration"

            except Exception:
                logger.exception("Error checking session %s", session.id)

        await db.commit()

    await engine.dispose()


@celery_app.task(name="app.workers.auto_suspend.check_idle_sessions")
def check_idle_sessions():
    """Celery task: check for idle sessions and suspend their VMs."""
    loop = _get_sync_loop()
    loop.run_until_complete(_check_idle_sessions_async())
