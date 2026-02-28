import io
import re
import base64
import time
import logging

import pyotp
import qrcode

logger = logging.getLogger(__name__)

# In-memory TOTP replay prevention (used codes within window)
_used_codes: dict[str, float] = {}
_REPLAY_WINDOW = 90  # seconds — matches valid_window=1 (±30s)


def _cleanup_used_codes() -> None:
    """Remove expired entries from the used-codes cache."""
    now = time.time()
    expired = [k for k, ts in _used_codes.items() if now - ts > _REPLAY_WINDOW]
    for k in expired:
        del _used_codes[k]


def generate_mfa_secret() -> str:
    """Generate a new TOTP secret."""
    return pyotp.random_base32()


def get_totp_uri(secret: str, email: str, issuer: str = "CwmVDI") -> str:
    """Generate a TOTP provisioning URI for QR code scanning."""
    totp = pyotp.TOTP(secret)
    return totp.provisioning_uri(name=email, issuer_name=issuer)


def generate_qr_code_base64(uri: str) -> str:
    """Generate a QR code as base64-encoded PNG."""
    img = qrcode.make(uri)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return base64.b64encode(buf.read()).decode("utf-8")


def verify_totp(secret: str, code: str) -> bool:
    """Verify a TOTP code with replay prevention.

    Validates code format (6 digits), checks it hasn't been used recently,
    and allows 1 period of drift (±30s).
    """
    # Validate code format
    if not code or not re.match(r"^\d{6}$", code):
        return False

    # Check replay prevention
    _cleanup_used_codes()
    replay_key = f"{secret}:{code}"
    if replay_key in _used_codes:
        logger.warning("TOTP code replay attempt detected")
        return False

    totp = pyotp.TOTP(secret)
    if totp.verify(code, valid_window=1):
        _used_codes[replay_key] = time.time()
        return True
    return False
