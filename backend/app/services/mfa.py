import io
import base64

import pyotp
import qrcode


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
    """Verify a TOTP code. Allows 1 period of drift."""
    totp = pyotp.TOTP(secret)
    return totp.verify(code, valid_window=1)
