import asyncio
import logging
import os
import random
import signal
import socket

logger = logging.getLogger(__name__)

PROXY_PORT_MIN = 33500
PROXY_PORT_MAX = 33999

# Idle timeout in seconds — socat auto-closes if no data flows
_SOCAT_IDLE_TIMEOUT = 600  # 10 minutes


def _is_port_in_use(port: int) -> bool:
    """Check if a port is already listening."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


class RDPProxyManager:
    """Manages temporary TCP proxies (socat) for native RDP connections.

    Security features:
    - IP restriction: socat range= limits connections to the requesting client IP
    - Idle timeout: socat -T closes proxy after 10 min of inactivity
    - Port conflict detection: retries if port is in use
    - iptables rules: defense-in-depth firewall allowlisting per port
    """

    async def start_proxy(
        self, vm_ip: str, client_ip: str | None = None, vm_port: int = 3389,
    ) -> tuple[int, int]:
        """Start a socat TCP forwarder with IP restriction and idle timeout.

        Returns (local_port, pid).
        """
        # Pick a port that is not already in use
        port = self._find_available_port()

        # Build socat listen options
        listen_opts = f"TCP-LISTEN:{port},fork,reuseaddr"
        if client_ip and client_ip not in ("127.0.0.1", "unknown"):
            listen_opts += f",range={client_ip}/32"

        proc = await asyncio.create_subprocess_exec(
            "socat",
            "-T", str(_SOCAT_IDLE_TIMEOUT),
            listen_opts,
            f"TCP:{vm_ip}:{vm_port}",
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )

        # Add iptables allow rule for this client IP + port
        if client_ip and client_ip not in ("127.0.0.1", "unknown"):
            await self._add_iptables_allow(port, client_ip)

        logger.info(
            "RDP proxy started: port=%d -> %s:%d, pid=%d, client_ip=%s",
            port, vm_ip, vm_port, proc.pid, client_ip or "any",
        )
        return port, proc.pid

    async def stop_proxy(self, pid: int, port: int | None = None) -> None:
        """Kill the socat process and clean up iptables rules."""
        try:
            os.kill(pid, signal.SIGTERM)
            logger.info("Stopped RDP proxy PID %d", pid)
        except ProcessLookupError:
            logger.debug("RDP proxy PID %d already gone", pid)

        # Clean up iptables rule for this port
        if port:
            await self._remove_iptables_rules(port)

    def _find_available_port(self, max_retries: int = 20) -> int:
        """Find a random port that is not currently in use."""
        for _ in range(max_retries):
            port = random.randint(PROXY_PORT_MIN, PROXY_PORT_MAX)
            if not _is_port_in_use(port):
                return port
        raise RuntimeError(
            f"Could not find an available port in range {PROXY_PORT_MIN}-{PROXY_PORT_MAX} "
            f"after {max_retries} attempts"
        )

    @staticmethod
    async def _add_iptables_allow(port: int, client_ip: str) -> None:
        """Add iptables rule to allow only this client IP on this port."""
        try:
            # Allow the specific client IP
            proc = await asyncio.create_subprocess_exec(
                "iptables", "-I", "INPUT", "-p", "tcp",
                "--dport", str(port), "-s", client_ip, "-j", "ACCEPT",
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await proc.communicate()
            if proc.returncode != 0:
                logger.warning("iptables allow rule failed: %s", stderr.decode().strip())
                return

            # Drop all other traffic to this port
            proc2 = await asyncio.create_subprocess_exec(
                "iptables", "-A", "INPUT", "-p", "tcp",
                "--dport", str(port), "-j", "DROP",
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr2 = await proc2.communicate()
            if proc2.returncode != 0:
                logger.warning("iptables drop rule failed: %s", stderr2.decode().strip())

            logger.info("iptables: port %d restricted to %s", port, client_ip)
        except Exception:
            logger.exception("Failed to add iptables rules for port %d", port)

    @staticmethod
    async def _remove_iptables_rules(port: int) -> None:
        """Remove all iptables rules for a specific port."""
        try:
            # Remove ACCEPT rules for this port
            for _ in range(5):  # remove up to 5 matching rules
                proc = await asyncio.create_subprocess_exec(
                    "iptables", "-D", "INPUT", "-p", "tcp",
                    "--dport", str(port), "-j", "ACCEPT",
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL,
                )
                await proc.communicate()
                if proc.returncode != 0:
                    break

            # Remove DROP rules for this port
            for _ in range(5):
                proc = await asyncio.create_subprocess_exec(
                    "iptables", "-D", "INPUT", "-p", "tcp",
                    "--dport", str(port), "-j", "DROP",
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL,
                )
                await proc.communicate()
                if proc.returncode != 0:
                    break

            logger.debug("iptables: cleaned up rules for port %d", port)
        except Exception:
            logger.exception("Failed to remove iptables rules for port %d", port)

    @staticmethod
    async def cleanup_orphan_proxies() -> None:
        """Kill any orphaned socat processes on startup."""
        try:
            proc = await asyncio.create_subprocess_exec(
                "pkill", "-f", "socat TCP-LISTEN",
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            await proc.communicate()
            if proc.returncode == 0:
                logger.info("Cleaned up orphaned socat proxy processes")
            else:
                logger.debug("No orphaned socat processes found")
        except Exception:
            logger.debug("pkill not available or no socat processes")

        # Clean up any leftover iptables rules in the proxy port range
        try:
            for port in range(PROXY_PORT_MIN, PROXY_PORT_MAX + 1):
                # Best-effort removal — most ports won't have rules
                for action in ("ACCEPT", "DROP"):
                    proc = await asyncio.create_subprocess_exec(
                        "iptables", "-D", "INPUT", "-p", "tcp",
                        "--dport", str(port), "-j", action,
                        stdout=asyncio.subprocess.DEVNULL,
                        stderr=asyncio.subprocess.DEVNULL,
                    )
                    await proc.communicate()
        except Exception:
            logger.debug("iptables cleanup skipped")

    @staticmethod
    def _sanitize_rdp_value(value: str) -> str:
        """Strip characters that could inject RDP file settings."""
        return value.replace("\r", "").replace("\n", "").replace(":", "")

    def generate_rdp_file(
        self,
        hostname: str,
        port: int,
        username: str = "",
        display_name: str = "CwmVDI Desktop",
    ) -> str:
        """Generate .rdp file content with sanitized values."""
        safe_hostname = self._sanitize_rdp_value(hostname)
        safe_username = self._sanitize_rdp_value(username)
        lines = [
            f"full address:s:{safe_hostname}:{port}",
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
        if safe_username:
            lines.append(f"username:s:{safe_username}")
        return "\r\n".join(lines) + "\r\n"
