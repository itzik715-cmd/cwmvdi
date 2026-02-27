import asyncio
import logging
import time

import httpx

logger = logging.getLogger(__name__)

# Module-level cache shared across all CloudWMClient instances
# Key: (api_url, client_id) → {"data": dict, "expires": float, "token": str, "token_expires": float}
_shared_cache: dict[tuple[str, str], dict] = {}


class CloudWMClient:
    """Client for Kamatera CloudWM API. Supports per-tenant API URLs."""

    def __init__(self, api_url: str, client_id: str, secret: str):
        self.base_url = api_url.rstrip("/")
        self.client_id = client_id
        self.secret = secret
        self._cache_key = (self.base_url, self.client_id)
        # Restore token from shared cache
        cached = _shared_cache.get(self._cache_key, {})
        self._token: str | None = cached.get("token")
        self._token_expires: float = cached.get("token_expires", 0)

    async def _get_client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=120.0, verify=True)

    async def _get_server_options(self) -> dict:
        """GET /server — cached for 30 minutes across all requests."""
        cached = _shared_cache.get(self._cache_key, {})
        if cached.get("data") and time.time() < cached.get("options_expires", 0):
            return cached["data"]

        async with await self._get_client() as client:
            resp = await client.get(
                f"{self.base_url}/server",
                headers=await self._auth_headers(),
            )
            resp.raise_for_status()
            data = resp.json()

        # Store in shared cache
        entry = _shared_cache.setdefault(self._cache_key, {})
        entry["data"] = data
        entry["options_expires"] = time.time() + 1800  # 30 minutes
        return data

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
            # Persist token in shared cache
            entry = _shared_cache.setdefault(self._cache_key, {})
            entry["token"] = self._token
            entry["token_expires"] = self._token_expires
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

    async def list_servers(self) -> list[dict]:
        """GET /servers — list all servers."""
        async with await self._get_client() as client:
            resp = await client.get(
                f"{self.base_url}/servers",
                headers=await self._auth_headers(),
            )
            resp.raise_for_status()
            return resp.json()

    async def list_servers_runtime(self) -> list[dict]:
        """GET /svc/serversRuntime — list servers with full details including tags.

        First fetches server IDs from /servers, then calls /svc/serversRuntime
        with those IDs to get tags and other runtime info.
        """
        servers = await self.list_servers()
        if not servers:
            return []

        server_ids = [s["id"] for s in servers]
        base = self.base_url.rsplit("/service", 1)[0]
        params = "&".join(f"ids[]={sid}" for sid in server_ids)
        url = f"{base}/svc/serversRuntime?{params}"

        async with await self._get_client() as client:
            resp = await client.get(url, headers=await self._auth_headers())
            resp.raise_for_status()
            return resp.json()

    async def find_servers_by_tag(self, tag: str) -> list[dict]:
        """Find servers that have a specific tag."""
        servers = await self.list_servers_runtime()
        return [s for s in servers if tag in s.get("tags", [])]

    async def find_server_by_name(self, name: str) -> dict | None:
        """Find a server by its name, return {id, name, power}."""
        servers = await self.list_servers()
        for s in servers:
            if s.get("name") == name:
                return s
        return None

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

    async def wait_for_command(self, command_id: int, timeout: int = 300) -> dict | None:
        """Poll a queue command until complete. Returns the queue data on success, None on failure/timeout."""
        start = time.time()
        while time.time() - start < timeout:
            try:
                async with await self._get_client() as client:
                    resp = await client.get(
                        f"{self.base_url}/queue/{command_id}",
                        headers=await self._auth_headers(),
                    )
                    if resp.status_code >= 500:
                        logger.warning("Queue poll returned %d for command %d, retrying...", resp.status_code, command_id)
                        await asyncio.sleep(10)
                        continue
                    resp.raise_for_status()
                    data = resp.json()
                    status = data.get("status", "")
                    logger.info("Command %d status: %s", command_id, status)
                    if status == "complete":
                        return data
                    if status == "error":
                        logger.error("Command %d failed: %s", command_id, data.get("log", ""))
                        return None
            except httpx.HTTPStatusError as e:
                logger.warning("Queue poll error for command %d: %s", command_id, str(e))
            except Exception as e:
                logger.warning("Queue poll exception for command %d: %s", command_id, str(e))
            await asyncio.sleep(10)
        return None

    async def get_traffic_id(self, datacenter: str) -> int:
        """Get the default traffic package ID (t5000) for a datacenter."""
        data = await self._get_server_options()
        traffic = data.get("traffic", {})
        dc_traffic = traffic.get(datacenter, [])
        if isinstance(dc_traffic, list):
            # Prefer t5000 (5000GB), fallback to first available
            for t in dc_traffic:
                if isinstance(t, dict) and t.get("name") == "t5000":
                    return t["id"]
            if dc_traffic and isinstance(dc_traffic[0], dict):
                return dc_traffic[0]["id"]
        return 9  # fallback

    async def create_server(self, params: dict) -> dict:
        """
        POST /server — create a new Windows VM.
        params should include: name, datacenter, disk_src_0, disk_size_0, cpu, ram,
        network_name_0, billing, traffic, password
        """
        logger.info("Creating server with params: %s", {k: v for k, v in params.items() if k != "password"})
        async with await self._get_client() as client:
            resp = await client.post(
                f"{self.base_url}/server",
                headers=await self._auth_headers(),
                json=params,
            )
            if resp.status_code >= 400:
                error_body = resp.text
                logger.error("Server creation failed (%d): %s", resp.status_code, error_body)
                resp.raise_for_status()
            data = resp.json()
            # Returns a list with command ID(s)
            if isinstance(data, list) and data:
                command_id = data[0]
                logger.info("Server creation started, command ID: %d", command_id)
                return {"command_id": command_id}
            return data

    async def list_images(self, datacenter: str = "IL-PT") -> list[dict]:
        """Get available OS images for a datacenter."""
        data = await self._get_server_options()

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
        """List available VLAN/private networks for a specific datacenter."""
        data = await self._get_server_options()

        networks = []
        raw_networks = data.get("networks", {})
        if isinstance(raw_networks, dict):
            # Networks are keyed by datacenter ID, each value is a list of network objects
            dc_nets = raw_networks.get(datacenter, [])
            if isinstance(dc_nets, list):
                for net in dc_nets:
                    if isinstance(net, dict):
                        name = net.get("name", "")
                        if name == "wan":
                            continue
                        ips = net.get("ips", [])
                        subnet = ""
                        if isinstance(ips, list) and ips:
                            subnet = f"{ips[0]}/{len(ips)} IPs"
                        networks.append({
                            "name": name,
                            "subnet": subnet,
                            "datacenter": datacenter,
                        })
        return networks

    async def create_network(self, name: str, datacenter: str = "IL") -> dict:
        """Create a new VLAN network via POST /server/network."""
        async with await self._get_client() as client:
            resp = await client.post(
                f"{self.base_url}/server/network",
                headers=await self._auth_headers(),
                json={
                    "name": name,
                    "datacenter": datacenter,
                },
            )
            if resp.status_code >= 400:
                error_body = resp.text
                logger.error("Network creation failed (%d): %s", resp.status_code, error_body)
                resp.raise_for_status()
            data = resp.json()
            return {"status": "ok", "data": data}

    async def get_account_user_id(self) -> str:
        """Get the Kamatera account userId from /svc/ga."""
        cached = _shared_cache.get(self._cache_key, {})
        if cached.get("account_user_id"):
            return cached["account_user_id"]

        # /svc/ga is at the console root, not under /service
        base = self.base_url.rsplit("/service", 1)[0]
        async with await self._get_client() as client:
            resp = await client.get(
                f"{base}/svc/ga",
                headers=await self._auth_headers(),
            )
            resp.raise_for_status()
            data = resp.json()
            user_id = str(data.get("userId", ""))

        entry = _shared_cache.setdefault(self._cache_key, {})
        entry["account_user_id"] = user_id
        return user_id

    async def get_datacenters(self) -> list[dict]:
        """List available datacenters."""
        data = await self._get_server_options()

        dcs = data.get("datacenters", {})
        return [{"id": k, "name": v} for k, v in dcs.items()]
