import asyncio
import logging
import time

import httpx

logger = logging.getLogger(__name__)


class CloudWMClient:
    """Client for Kamatera CloudWM API. Supports per-tenant API URLs."""

    def __init__(self, api_url: str, client_id: str, secret: str):
        self.base_url = api_url.rstrip("/")
        self.client_id = client_id
        self.secret = secret
        self._token: str | None = None
        self._token_expires: float = 0

    async def _get_client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=30.0, verify=True)

    async def authenticate(self) -> str:
        """POST /authenticate — returns a session token."""
        if self._token and time.time() < self._token_expires - 60:
            return self._token

        async with await self._get_client() as client:
            resp = await client.post(
                f"{self.base_url}/authenticate",
                json={"clientId": self.client_id, "secret": self.secret},
            )
            resp.raise_for_status()
            data = resp.json()
            self._token = data["authentication"]
            self._token_expires = data.get("expires", time.time() + 3600)
            return self._token

    async def _auth_headers(self) -> dict:
        token = await self.authenticate()
        return {"Authorization": f"Bearer {token}"}

    async def get_server(self, server_id: str) -> dict:
        """GET /server/{server_id}"""
        async with await self._get_client() as client:
            resp = await client.get(
                f"{self.base_url}/server/{server_id}",
                headers=await self._auth_headers(),
            )
            resp.raise_for_status()
            return resp.json()

    async def get_server_state(self, server_id: str) -> str:
        """Returns: 'on' | 'off' | 'suspended' | 'unknown'"""
        try:
            data = await self.get_server(server_id)
            power = data.get("power", "").lower()
            if power == "on":
                return "on"
            elif power == "off":
                return "off"
            elif power in ("suspended", "paused"):
                return "suspended"
            return "unknown"
        except Exception:
            logger.exception("Failed to get server state for %s", server_id)
            return "unknown"

    async def power_on(self, server_id: str) -> dict:
        """POST /server/{server_id}/power — power on."""
        async with await self._get_client() as client:
            resp = await client.post(
                f"{self.base_url}/server/{server_id}/power",
                headers=await self._auth_headers(),
                json={"power": "on"},
            )
            resp.raise_for_status()
            return resp.json()

    async def power_off(self, server_id: str) -> dict:
        """POST /server/{server_id}/power — power off."""
        async with await self._get_client() as client:
            resp = await client.post(
                f"{self.base_url}/server/{server_id}/power",
                headers=await self._auth_headers(),
                json={"power": "off"},
            )
            resp.raise_for_status()
            return resp.json()

    async def suspend(self, server_id: str) -> dict:
        """Suspend a VM. Falls back to power off if suspend endpoint doesn't exist."""
        try:
            async with await self._get_client() as client:
                resp = await client.post(
                    f"{self.base_url}/server/{server_id}/power",
                    headers=await self._auth_headers(),
                    json={"power": "suspend"},
                )
                resp.raise_for_status()
                return resp.json()
        except httpx.HTTPStatusError:
            logger.warning("Suspend not supported for %s, falling back to power off", server_id)
            return await self.power_off(server_id)

    async def resume(self, server_id: str) -> dict:
        """Resume a suspended VM. Falls back to power on."""
        try:
            async with await self._get_client() as client:
                resp = await client.post(
                    f"{self.base_url}/server/{server_id}/power",
                    headers=await self._auth_headers(),
                    json={"power": "resume"},
                )
                resp.raise_for_status()
                return resp.json()
        except httpx.HTTPStatusError:
            logger.warning("Resume not supported for %s, falling back to power on", server_id)
            return await self.power_on(server_id)

    async def wait_until_ready(self, server_id: str, timeout: int = 180) -> bool:
        """Poll every 5 seconds until the server is 'on'. Returns False on timeout."""
        start = time.time()
        while time.time() - start < timeout:
            state = await self.get_server_state(server_id)
            if state == "on":
                return True
            await asyncio.sleep(5)
        return False

    async def wait_for_command(self, command_id: int, timeout: int = 300) -> bool:
        """Poll a queue command until complete."""
        start = time.time()
        while time.time() - start < timeout:
            async with await self._get_client() as client:
                resp = await client.get(
                    f"{self.base_url}/queue/{command_id}",
                    headers=await self._auth_headers(),
                )
                resp.raise_for_status()
                data = resp.json()
                status = data.get("status", "")
                if status == "complete":
                    return True
                if status == "error":
                    logger.error("Command %d failed: %s", command_id, data.get("log", ""))
                    return False
            await asyncio.sleep(10)
        return False

    async def create_server(self, params: dict) -> dict:
        """
        POST /server — create a new Windows VM.
        params should include: name, datacenter, disk_src_0, disk_size_0, cpu, ram,
        network_name_0, billing, traffic, password
        """
        async with await self._get_client() as client:
            resp = await client.post(
                f"{self.base_url}/server",
                headers=await self._auth_headers(),
                json=params,
            )
            resp.raise_for_status()
            data = resp.json()
            # Returns a list with command ID(s)
            if isinstance(data, list) and data:
                command_id = data[0]
                logger.info("Server creation started, command ID: %d", command_id)
                return {"command_id": command_id}
            return data

    async def list_images(self, datacenter: str = "IL-PT") -> list[dict]:
        """Get available OS images, filtered to Windows images."""
        async with await self._get_client() as client:
            resp = await client.get(
                f"{self.base_url}/server",
                headers=await self._auth_headers(),
            )
            resp.raise_for_status()
            data = resp.json()

        images = []
        disk_images = data.get("diskImages", data.get("disk_images", []))
        if isinstance(disk_images, dict):
            # Images grouped by datacenter
            dc_images = disk_images.get(datacenter, [])
        elif isinstance(disk_images, list):
            dc_images = disk_images
        else:
            dc_images = []

        for img in dc_images:
            desc = img.get("description", "")
            img_id = img.get("id", "")
            if datacenter in img_id or not img_id.startswith(("AS:", "EU:", "US:", "CA:", "AU:")):
                images.append({
                    "id": img_id,
                    "description": desc,
                    "size_gb": img.get("sizeGB", 0),
                })
        return images

    async def list_networks(self, datacenter: str = "IL-PT") -> list[dict]:
        """List available VLAN/private networks."""
        async with await self._get_client() as client:
            resp = await client.get(
                f"{self.base_url}/server",
                headers=await self._auth_headers(),
            )
            resp.raise_for_status()
            data = resp.json()

        networks = []
        raw_networks = data.get("networks", {})
        if isinstance(raw_networks, dict):
            for name, info in raw_networks.items():
                if name.startswith("wan"):
                    continue
                networks.append({
                    "name": name,
                    "subnet": info if isinstance(info, str) else str(info),
                    "gateway": "",
                    "datacenter": datacenter,
                })
        return networks

    async def create_network(self, name: str, subnet: str) -> dict:
        """Create a new VLAN network."""
        async with await self._get_client() as client:
            resp = await client.post(
                f"{self.base_url}/network",
                headers=await self._auth_headers(),
                json={
                    "name": name,
                    "subnet": subnet,
                    "datacenter": "IL-PT",
                },
            )
            resp.raise_for_status()
            data = resp.json()
            return {"status": "ok", "data": data}

    async def get_datacenters(self) -> list[dict]:
        """GET server options — list available datacenters."""
        async with await self._get_client() as client:
            resp = await client.get(
                f"{self.base_url}/server",
                headers=await self._auth_headers(),
            )
            resp.raise_for_status()
            data = resp.json()

        dcs = data.get("datacenters", {})
        return [{"id": k, "name": v} for k, v in dcs.items()]
