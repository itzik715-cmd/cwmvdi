"""
Bootstrap script: creates the initial tenant and admin user.
Run inside the backend container after DB migration.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy import select

from app.config import get_settings
from app.models.tenant import Tenant
from app.models.user import User
from app.services.auth import hash_password
from app.services.encryption import encrypt_value


async def main():
    settings = get_settings()
    engine = create_async_engine(settings.database_url)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with session_factory() as db:
        # Check if default tenant exists
        result = await db.execute(select(Tenant).where(Tenant.slug == "default"))
        tenant = result.scalar_one_or_none()

        if not tenant:
            tenant = Tenant(
                name="Default Tenant",
                slug="default",
                cloudwm_api_url=settings.cloudwm_api_url,
                cloudwm_client_id=settings.cloudwm_client_id,
                cloudwm_secret_encrypted=encrypt_value(settings.cloudwm_secret),
                boundary_org_id="o_b406dByd62",
                boundary_project_id="p_MqPFb6Z6hc",
                suspend_threshold_minutes=settings.default_suspend_threshold,
                max_session_hours=settings.default_max_session_hours,
            )
            db.add(tenant)
            await db.flush()
            print(f"Created tenant: {tenant.name} (slug: {tenant.slug})")
        else:
            print(f"Tenant already exists: {tenant.name}")

        # Check if admin user exists
        admin_username = os.environ.get("ADMIN_USERNAME", "vdiadmin")
        result = await db.execute(
            select(User).where(User.tenant_id == tenant.id, User.username == admin_username)
        )
        admin = result.scalar_one_or_none()

        if not admin:
            # Also check by old email field for backwards compatibility
            result = await db.execute(
                select(User).where(User.tenant_id == tenant.id, User.email == settings.admin_email)
            )
            admin = result.scalar_one_or_none()
            if admin and not getattr(admin, "username", None):
                admin.username = admin_username
                print(f"Updated existing admin with username: {admin_username}")
            elif not admin:
                admin = User(
                    tenant_id=tenant.id,
                    username=admin_username,
                    email=settings.admin_email,
                    password_hash=hash_password(settings.admin_password),
                    role="admin",
                    is_active=True,
                )
                db.add(admin)
                print(f"Created admin user: {admin_username}")
        else:
            print(f"Admin user already exists: {admin_username}")

        await db.commit()

    await engine.dispose()
    print("Bootstrap complete.")


if __name__ == "__main__":
    asyncio.run(main())
