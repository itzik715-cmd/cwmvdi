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
            try:
                await cloudwm.resume(desktop.cloudwm_server_id)
                success = await cloudwm.wait_until_ready(
                    desktop.cloudwm_server_id, timeout=60
                )
                if success:
                    return True
            except Exception:
                logger.warning("Resume failed for %s, trying power on", desktop.cloudwm_server_id)

        # Any other state (off, unknown, or failed resume) — power on
        logger.info("Powering on VM %s (was %s)", desktop.cloudwm_server_id, state)
        await cloudwm.power_on(desktop.cloudwm_server_id)
        return await cloudwm.wait_until_ready(
            desktop.cloudwm_server_id, timeout=180
        )
