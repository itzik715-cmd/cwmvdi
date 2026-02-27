import logging

from app.models.desktop import DesktopAssignment
from app.services.cloudwm import CloudWMClient

logger = logging.getLogger(__name__)


class PowerManager:

    async def ensure_vm_running(
        self, desktop: DesktopAssignment, cloudwm: CloudWMClient
    ) -> bool:
        """
        Ensure the VM is powered on before connection.
        Returns True when the VM is ready.
        """
        state = await cloudwm.get_server_state(desktop.cloudwm_server_id)
        logger.info(
            "Desktop %s (server %s) state: %s",
            desktop.display_name,
            desktop.cloudwm_server_id,
            state,
        )

        if state == "on":
            return True

        if state == "suspended":
            logger.info("Resuming suspended VM %s", desktop.cloudwm_server_id)
            await cloudwm.resume(desktop.cloudwm_server_id)
            success = await cloudwm.wait_until_ready(
                desktop.cloudwm_server_id, timeout=60
            )
            if success:
                return True
            # Fallback — resume failed, try full power on
            logger.warning("Resume failed for %s, trying power on", desktop.cloudwm_server_id)
            await cloudwm.power_on(desktop.cloudwm_server_id)
            return await cloudwm.wait_until_ready(
                desktop.cloudwm_server_id, timeout=180
            )

        if state == "off":
            logger.info("Powering on VM %s", desktop.cloudwm_server_id)
            await cloudwm.power_on(desktop.cloudwm_server_id)
            return await cloudwm.wait_until_ready(
                desktop.cloudwm_server_id, timeout=180
            )

        # Unknown state — try power on
        logger.warning("Unknown state for %s, attempting power on", desktop.cloudwm_server_id)
        await cloudwm.power_on(desktop.cloudwm_server_id)
        return await cloudwm.wait_until_ready(
            desktop.cloudwm_server_id, timeout=180
        )

    async def suspend_vm(
        self, desktop: DesktopAssignment, cloudwm: CloudWMClient
    ) -> bool:
        """Send VM to suspend."""
        try:
            await cloudwm.suspend(desktop.cloudwm_server_id)
            logger.info("Suspended VM %s", desktop.cloudwm_server_id)
            return True
        except Exception:
            logger.exception("Failed to suspend VM %s", desktop.cloudwm_server_id)
            return False
