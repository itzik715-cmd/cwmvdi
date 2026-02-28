"""One-time script to re-encrypt values after salt change.

Run inside the backend container:
  docker compose exec -e PYTHONPATH=/app backend python scripts/migrate_encryption.py
"""
import asyncio
import base64
import hashlib
import sys
import os

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC


def get_fernet_old(key_material: str) -> Fernet:
    """Get Fernet instance with the OLD hardcoded salt."""
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=b"cwmvdi-encryption-salt",
        iterations=100_000,
    )
    key = base64.urlsafe_b64encode(kdf.derive(key_material.encode()))
    return Fernet(key)


def get_fernet_new(key_material: str) -> Fernet:
    """Get Fernet instance with the NEW derived salt."""
    salt = hashlib.sha256(
        (key_material + "-cwmvdi-salt").encode()
    ).digest()[:16]
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=100_000,
    )
    key = base64.urlsafe_b64encode(kdf.derive(key_material.encode()))
    return Fernet(key)


async def main():
    encryption_key = os.environ.get("ENCRYPTION_KEY", "")
    if not encryption_key:
        print("ERROR: ENCRYPTION_KEY not set")
        sys.exit(1)

    f_old = get_fernet_old(encryption_key)
    f_new = get_fernet_new(encryption_key)

    # Test if old and new are the same (shouldn't be after the fix)
    test_data = b"test"
    old_encrypted = f_old.encrypt(test_data)
    try:
        f_new.decrypt(old_encrypted)
        print("Old and new encryption are compatible — no migration needed.")
        return
    except InvalidToken:
        print("Encryption salt changed — migrating encrypted values...")

    # Connect to database
    from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy import text

    database_url = os.environ.get("DATABASE_URL", "")
    if not database_url:
        print("ERROR: DATABASE_URL not set")
        sys.exit(1)

    engine = create_async_engine(database_url)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        # Get all tenants with encrypted values
        result = await session.execute(text(
            "SELECT id, cloudwm_secret_encrypted, duo_skey_encrypted FROM tenants"
        ))
        rows = result.fetchall()

        migrated = 0
        for row in rows:
            tid, cwm_secret, duo_skey = row
            updates = {}

            if cwm_secret:
                try:
                    plaintext = f_old.decrypt(cwm_secret.encode()).decode()
                    updates["cloudwm_secret_encrypted"] = f_new.encrypt(plaintext.encode()).decode()
                    print(f"  Tenant {tid}: re-encrypted cloudwm_secret")
                except InvalidToken:
                    # Try with new key — maybe already migrated
                    try:
                        f_new.decrypt(cwm_secret.encode())
                        print(f"  Tenant {tid}: cloudwm_secret already uses new encryption")
                    except InvalidToken:
                        print(f"  WARNING: Tenant {tid}: could not decrypt cloudwm_secret with either key!")

            if duo_skey:
                try:
                    plaintext = f_old.decrypt(duo_skey.encode()).decode()
                    updates["duo_skey_encrypted"] = f_new.encrypt(plaintext.encode()).decode()
                    print(f"  Tenant {tid}: re-encrypted duo_skey")
                except InvalidToken:
                    try:
                        f_new.decrypt(duo_skey.encode())
                        print(f"  Tenant {tid}: duo_skey already uses new encryption")
                    except InvalidToken:
                        print(f"  WARNING: Tenant {tid}: could not decrypt duo_skey with either key!")

            if updates:
                set_clause = ", ".join(f"{k} = :v_{k}" for k in updates)
                params = {f"v_{k}": v for k, v in updates.items()}
                params["tid"] = tid
                await session.execute(
                    text(f"UPDATE tenants SET {set_clause} WHERE id = :tid"),
                    params,
                )
                migrated += 1

        await session.commit()
        print(f"\nMigration complete. {migrated} tenant(s) updated.")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
