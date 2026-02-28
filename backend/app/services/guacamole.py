import hashlib
import hmac
import json
import time
from base64 import b64encode

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives import padding as sym_padding


class GuacamoleTokenService:
    """Creates encrypted JSON auth tokens for guacamole-auth-json extension."""

    def __init__(self, secret_key_hex: str):
        self.secret_key = bytes.fromhex(secret_key_hex)

    def create_connection_token(
        self,
        username: str,
        connection_name: str,
        protocol: str,
        parameters: dict,
        expires_minutes: int = 480,
    ) -> str:
        """Build signed+encrypted JSON token for Guacamole.

        Flow: JSON → HMAC-SHA256 sign → prepend sig → PKCS7 pad → AES-128-CBC (IV=0) → base64
        """
        expires_ms = int((time.time() + expires_minutes * 60) * 1000)

        payload = {
            "username": username,
            "expires": str(expires_ms),
            "connections": {
                connection_name: {
                    "protocol": protocol,
                    "parameters": parameters,
                }
            },
        }

        json_bytes = json.dumps(payload, separators=(",", ":")).encode("utf-8")

        # HMAC-SHA256 signature
        signature = hmac.new(self.secret_key, json_bytes, hashlib.sha256).digest()

        # Prepend signature to JSON
        signed = signature + json_bytes

        # PKCS7 pad to 16-byte boundary
        padder = sym_padding.PKCS7(128).padder()
        padded = padder.update(signed) + padder.finalize()

        # AES-128-CBC with IV of all zeros
        iv = b"\x00" * 16
        cipher = Cipher(algorithms.AES128(self.secret_key), modes.CBC(iv))
        encryptor = cipher.encryptor()
        encrypted = encryptor.update(padded) + encryptor.finalize()

        return b64encode(encrypted).decode("ascii")
