import asyncio
import logging
import os
import random
import signal

logger = logging.getLogger(__name__)

PROXY_PORT_MIN = 33890
PROXY_PORT_MAX = 33990


class RDPProxyManager:
    """Manages temporary TCP proxies (socat) for native RDP file downloads."""

    async def start_proxy(self, vm_ip: str, vm_port: int = 3389) -> tuple[int, int]:
        """Start a socat TCP forwarder. Returns (local_port, pid)."""
        port = random.randint(PROXY_PORT_MIN, PROXY_PORT_MAX)

        proc = await asyncio.create_subprocess_exec(
            "socat",
            f"TCP-LISTEN:{port},fork,reuseaddr",
            f"TCP:{vm_ip}:{vm_port}",
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )

        logger.info("Started RDP proxy on port %d -> %s:%d (PID %d)", port, vm_ip, vm_port, proc.pid)
        return port, proc.pid

    async def stop_proxy(self, pid: int) -> None:
        """Kill the socat process by PID."""
        try:
            os.kill(pid, signal.SIGTERM)
            logger.info("Stopped RDP proxy PID %d", pid)
        except ProcessLookupError:
            logger.debug("RDP proxy PID %d already gone", pid)

    def generate_rdp_file(
        self,
        hostname: str,
        port: int,
        username: str = "",
        display_name: str = "KamVDI Desktop",
    ) -> str:
        """Generate .rdp file content."""
        lines = [
            f"full address:s:{hostname}:{port}",
            "prompt for credentials:i:1",
            "screen mode id:i:2",
            "desktopwidth:i:1920",
            "desktopheight:i:1080",
            "session bpp:i:32",
            "compression:i:1",
            "keyboardhook:i:2",
            "audiocapturemode:i:0",
            "videoplaybackmode:i:1",
            "connection type:i:7",
            "networkautodetect:i:1",
            "bandwidthautodetect:i:1",
            "autoreconnection enabled:i:1",
        ]
        if username:
            lines.append(f"username:s:{username}")
        return "\r\n".join(lines) + "\r\n"
