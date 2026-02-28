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

        # Any other state (off, unknown) — power on and wait
        logger.info("Powering on VM %s (was %s)", desktop.cloudwm_server_id, state)
        await cloudwm.power_on(desktop.cloudwm_server_id)
        return await cloudwm.wait_until_ready(
            desktop.cloudwm_server_id, timeout=180
        )
