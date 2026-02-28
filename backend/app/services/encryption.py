import base64
import hashlib

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

from app.config import get_settings


def _derive_salt() -> bytes:
    """Derive a unique salt from the encryption key itself using SHA-256.

    This ensures each installation with a different encryption key gets a
    different salt, without requiring a separate salt config value.
    """
    settings = get_settings()
    return hashlib.sha256(
        (settings.encryption_key + "-cwmvdi-salt").encode()
    ).digest()[:16]


def _get_fernet() -> Fernet:
    settings = get_settings()
    key_material = settings.encryption_key.encode()
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=_derive_salt(),
        iterations=100_000,
    )
    key = base64.urlsafe_b64encode(kdf.derive(key_material))
    return Fernet(key)


def encrypt_value(plaintext: str) -> str:
    """Encrypt a string value (e.g., API secret)."""
    f = _get_fernet()
    return f.encrypt(plaintext.encode()).decode()


def decrypt_value(ciphertext: str) -> str:
    """Decrypt an encrypted string value."""
    f = _get_fernet()
    return f.decrypt(ciphertext.encode()).decode()
