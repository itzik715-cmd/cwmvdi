import logging

import httpx

logger = logging.getLogger(__name__)


class BoundaryClient:
    """
    Client for HashiCorp Boundary Controller API.
    Each tenant is managed in a separate Project within Boundary.
    """

    def __init__(self, controller_url: str, tls_insecure: bool = True):
        self.base_url = controller_url.rstrip("/")
        self.tls_insecure = tls_insecure
        self._token: str | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            timeout=30.0,
            verify=not self.tls_insecure,
        )

    async def authenticate(self, auth_method_id: str, login_name: str, password: str) -> str:
        """Authenticate to Boundary and store the token."""
        async with await self._get_client() as client:
            resp = await client.post(
                f"{self.base_url}/v1/auth-methods/{auth_method_id}:authenticate",
                json={
                    "command": "login",
                    "attributes": {
                        "login_name": login_name,
                        "password": password,
                    },
                },
            )
            resp.raise_for_status()
            data = resp.json()
            self._token = data["attributes"]["token"]
            return self._token

    def _auth_headers(self) -> dict:
        if not self._token:
            raise RuntimeError("Not authenticated — call authenticate() first")
        return {"Authorization": f"Bearer {self._token}"}

    # ── Scope Management ──

    async def create_org(self, name: str, description: str = "") -> dict:
        """Create an org scope."""
        async with await self._get_client() as client:
            resp = await client.post(
                f"{self.base_url}/v1/scopes",
                headers=self._auth_headers(),
                json={
                    "scope_id": "global",
                    "name": name,
                    "description": description,
                    "type": "org",
                },
            )
            resp.raise_for_status()
            return resp.json()["item"]

    async def create_project(self, org_id: str, name: str, description: str = "") -> dict:
        """Create a project scope within an org."""
        async with await self._get_client() as client:
            resp = await client.post(
                f"{self.base_url}/v1/scopes",
                headers=self._auth_headers(),
                json={
                    "scope_id": org_id,
                    "name": name,
                    "description": description,
                    "type": "project",
                },
            )
            resp.raise_for_status()
            return resp.json()["item"]

    # ── Host Management ──

    async def create_host_catalog(self, project_id: str, name: str) -> dict:
        """Create a static host catalog in a project."""
        async with await self._get_client() as client:
            resp = await client.post(
                f"{self.base_url}/v1/host-catalogs",
                headers=self._auth_headers(),
                json={
                    "scope_id": project_id,
                    "name": name,
                    "type": "static",
                },
            )
            resp.raise_for_status()
            return resp.json()["item"]

    async def create_host_set(self, host_catalog_id: str, name: str) -> dict:
        """Create a host set in a host catalog."""
        async with await self._get_client() as client:
            resp = await client.post(
                f"{self.base_url}/v1/host-sets",
                headers=self._auth_headers(),
                json={
                    "host_catalog_id": host_catalog_id,
                    "name": name,
                    "type": "static",
                },
            )
            resp.raise_for_status()
            return resp.json()["item"]

    async def create_host(
        self, host_catalog_id: str, name: str, ip: str
    ) -> str:
        """Create a host in a catalog. Returns host_id."""
        async with await self._get_client() as client:
            resp = await client.post(
                f"{self.base_url}/v1/hosts",
                headers=self._auth_headers(),
                json={
                    "host_catalog_id": host_catalog_id,
                    "name": name,
                    "type": "static",
                    "attributes": {"address": ip},
                },
            )
            resp.raise_for_status()
            host = resp.json()["item"]
            return host["id"]

    async def add_host_to_set(self, host_set_id: str, host_id: str, version: int) -> dict:
        """Add a host to a host set."""
        async with await self._get_client() as client:
            resp = await client.post(
                f"{self.base_url}/v1/host-sets/{host_set_id}:add-hosts",
                headers=self._auth_headers(),
                json={
                    "host_ids": [host_id],
                    "version": version,
                },
            )
            resp.raise_for_status()
            return resp.json()["item"]

    # ── Target Management ──

    async def create_target(
        self, project_id: str, name: str, host_set_id: str, port: int = 3389
    ) -> str:
        """Create a TCP target for RDP. Returns target_id."""
        async with await self._get_client() as client:
            resp = await client.post(
                f"{self.base_url}/v1/targets",
                headers=self._auth_headers(),
                json={
                    "scope_id": project_id,
                    "name": name,
                    "type": "tcp",
                    "attributes": {"default_port": port},
                    "session_max_seconds": 28800,
                    "session_connection_limit": 1,
                },
            )
            resp.raise_for_status()
            target = resp.json()["item"]
            target_id = target["id"]

            # Add host sources to target
            await client.post(
                f"{self.base_url}/v1/targets/{target_id}:add-host-sources",
                headers=self._auth_headers(),
                json={
                    "host_source_ids": [host_set_id],
                    "version": target["version"],
                },
            )
            return target_id

    async def authorize_session(self, target_id: str) -> str:
        """
        POST /v1/targets/{target_id}:authorize-session
        Returns the one-time auth_token for the Agent to use.
        """
        async with await self._get_client() as client:
            resp = await client.post(
                f"{self.base_url}/v1/targets/{target_id}:authorize-session",
                headers=self._auth_headers(),
                json={},
            )
            resp.raise_for_status()
            data = resp.json()["item"]
            return data["authorization_token"]

    async def cancel_session(self, session_id: str) -> bool:
        """Cancel an active Boundary session."""
        try:
            async with await self._get_client() as client:
                resp = await client.post(
                    f"{self.base_url}/v1/sessions/{session_id}:cancel",
                    headers=self._auth_headers(),
                    json={},
                )
                resp.raise_for_status()
                return True
        except Exception:
            logger.exception("Failed to cancel Boundary session %s", session_id)
            return False

    async def get_session(self, session_id: str) -> dict:
        """Get session info from Boundary."""
        async with await self._get_client() as client:
            resp = await client.get(
                f"{self.base_url}/v1/sessions/{session_id}",
                headers=self._auth_headers(),
            )
            resp.raise_for_status()
            return resp.json()["item"]

    # ── Tenant Setup ──

    async def setup_tenant_project(self, tenant_name: str, org_id: str) -> dict:
        """
        Create Project + Host Catalog + Host Set for a new tenant.
        Returns: {project_id, host_catalog_id, host_set_id}
        """
        project = await self.create_project(
            org_id=org_id,
            name=f"kamvdi-{tenant_name}",
            description=f"KamVDI project for tenant {tenant_name}",
        )
        project_id = project["id"]

        catalog = await self.create_host_catalog(
            project_id=project_id,
            name=f"{tenant_name}-hosts",
        )
        catalog_id = catalog["id"]

        host_set = await self.create_host_set(
            host_catalog_id=catalog_id,
            name=f"{tenant_name}-desktops",
        )
        host_set_id = host_set["id"]

        return {
            "project_id": project_id,
            "host_catalog_id": catalog_id,
            "host_set_id": host_set_id,
        }

    async def setup_desktop_target(
        self,
        project_id: str,
        host_catalog_id: str,
        host_set_id: str,
        desktop_name: str,
        vm_ip: str,
    ) -> dict:
        """
        Create a host + target for a specific desktop VM.
        Returns: {host_id, target_id}
        """
        host_id = await self.create_host(
            host_catalog_id=host_catalog_id,
            name=f"desktop-{desktop_name}",
            ip=vm_ip,
        )

        # Get host set version for adding host
        async with await self._get_client() as client:
            resp = await client.get(
                f"{self.base_url}/v1/host-sets/{host_set_id}",
                headers=self._auth_headers(),
            )
            resp.raise_for_status()
            hs_version = resp.json()["item"]["version"]

        await self.add_host_to_set(host_set_id, host_id, hs_version)

        # Each desktop gets its own target for isolation
        # Create a dedicated host set for this desktop
        dedicated_hs = await self.create_host_set(
            host_catalog_id=host_catalog_id,
            name=f"hs-{desktop_name}",
        )
        dedicated_hs_id = dedicated_hs["id"]

        await self.add_host_to_set(dedicated_hs_id, host_id, dedicated_hs["version"])

        target_id = await self.create_target(
            project_id=project_id,
            name=f"rdp-{desktop_name}",
            host_set_id=dedicated_hs_id,
            port=3389,
        )

        return {"host_id": host_id, "target_id": target_id}
