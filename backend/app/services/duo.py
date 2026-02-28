import base64
import email.utils
import hashlib
import hmac
import logging
import urllib.parse
from typing import Literal

import httpx

logger = logging.getLogger(__name__)


class DuoAuthError(Exception):
    """Raised when DUO API returns an error."""

    def __init__(self, message: str, detail: str = ""):
        self.message = message
        self.detail = detail
        super().__init__(message)


class DuoClient:
    """Client for DUO Auth API (server-side).

    Reference: https://duo.com/docs/authapi
    """

    def __init__(self, ikey: str, skey: str, api_host: str):
        self.ikey = ikey
        self.skey = skey
        self.api_host = api_host

    def _sign_request(
        self, method: str, path: str, params: dict[str, str], date: str,
    ) -> str:
        """Build HMAC-SHA1 signature per DUO Auth API spec."""
        param_string = urllib.parse.urlencode(sorted(params.items()))
        canon = "\n".join([
            date,
            method.upper(),
            self.api_host.lower(),
            path,
            param_string,
        ])
        sig = hmac.new(
            self.skey.encode("utf-8"),
            canon.encode("utf-8"),
            hashlib.sha1,
        ).hexdigest()
        return sig

    def _build_auth_header(
        self, method: str, path: str, params: dict[str, str], date: str,
    ) -> dict[str, str]:
        sig = self._sign_request(method, path, params, date)
        auth_str = f"{self.ikey}:{sig}"
        auth_b64 = base64.b64encode(auth_str.encode("utf-8")).decode("utf-8")
        return {
            "Date": date,
            "Authorization": f"Basic {auth_b64}",
        }

    async def _api_call(
        self, method: str, path: str, params: dict[str, str] | None = None,
    ) -> dict:
        params = params or {}
        date = email.utils.formatdate()
        headers = self._build_auth_header(method, path, params, date)
        url = f"https://{self.api_host}{path}"

        async with httpx.AsyncClient(timeout=65.0) as client:
            if method.upper() == "GET":
                resp = await client.get(url, params=params, headers=headers)
            else:
                headers["Content-Type"] = "application/x-www-form-urlencoded"
                resp = await client.post(url, data=params, headers=headers)

        data = resp.json()
        if data.get("stat") != "OK":
            msg = data.get("message", "Unknown DUO error")
            detail = data.get("message_detail", "")
            logger.error("DUO API error: %s (%s)", msg, detail)
            raise DuoAuthError(msg, detail)

        return data.get("response", {})

    async def ping(self) -> bool:
        """Verify API host is reachable (no auth needed)."""
        url = f"https://{self.api_host}/auth/v2/ping"
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url)
        data = resp.json()
        return data.get("stat") == "OK"

    async def check(self) -> bool:
        """Verify ikey/skey credentials work."""
        await self._api_call("GET", "/auth/v2/check")
        return True

    async def preauth(self, username: str) -> dict:
        """Check if user exists, get available factors."""
        return await self._api_call("POST", "/auth/v2/preauth", {
            "username": username,
        })

    async def auth_push(self, username: str, device: str = "auto") -> dict:
        """Send push notification. Blocking call (~60s until user responds)."""
        return await self._api_call("POST", "/auth/v2/auth", {
            "username": username,
            "factor": "push",
            "device": device,
        })

    async def auth_passcode(self, username: str, passcode: str) -> dict:
        """Verify a passcode from DUO Mobile or hardware token."""
        return await self._api_call("POST", "/auth/v2/auth", {
            "username": username,
            "factor": "passcode",
            "passcode": passcode,
        })


async def verify_duo(
    ikey: str,
    skey: str,
    api_host: str,
    username: str,
    factor: Literal["push", "passcode"] = "push",
    passcode: str | None = None,
    device: str = "auto",
) -> dict:
    """High-level helper: preauth + auth in one call."""
    client = DuoClient(ikey, skey, api_host)

    preauth_result = await client.preauth(username)
    result = preauth_result.get("result")

    if result == "allow":
        return {"result": "allow", "status_msg": "Bypass enabled for user"}

    if result == "deny":
        raise DuoAuthError("DUO denied access for this user")

    if result == "enroll":
        raise DuoAuthError(
            "User is not enrolled in DUO",
            "Please ask your administrator to enroll you in DUO Security.",
        )

    # result == "auth"
    if factor == "push":
        auth_result = await client.auth_push(username, device)
    elif factor == "passcode":
        if not passcode:
            raise DuoAuthError("Passcode required")
        auth_result = await client.auth_passcode(username, passcode)
    else:
        raise DuoAuthError(f"Unsupported factor: {factor}")

    if auth_result.get("result") != "allow":
        raise DuoAuthError(
            auth_result.get("status_msg", "DUO verification failed")
        )

    return auth_result
