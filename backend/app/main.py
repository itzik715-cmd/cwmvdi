import base64
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from app.config import get_settings
from app.routers import auth, desktops, admin, sessions

is_production = os.getenv("ENVIRONMENT", "production") != "development"


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup — clean up orphaned socat proxies from previous runs
    from app.services.rdp_proxy import RDPProxyManager
    await RDPProxyManager.cleanup_orphan_proxies()
    yield
    # Shutdown


app = FastAPI(
    title="CwmVDI API",
    description="Virtual Desktop Infrastructure for Kamatera CloudWM",
    version="1.0.0",
    lifespan=lifespan,
    docs_url=None if is_production else "/docs",
    redoc_url=None if is_production else "/redoc",
    openapi_url=None if is_production else "/openapi.json",
)

settings = get_settings()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.portal_url],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
    allow_headers=["Content-Type", "Authorization"],
)

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(desktops.router, prefix="/api/desktops", tags=["desktops"])
app.include_router(admin.router, prefix="/api/admin", tags=["admin"])
app.include_router(sessions.router, prefix="/api/sessions", tags=["sessions"])


@app.get("/api/health")
async def health_check():
    """Lightweight health check — only confirms service is running.
    Detailed system status is behind /api/admin/system-status (requires auth).
    """
    return {"status": "ok", "version": "1.0.0"}


@app.get("/api/branding")
async def get_branding():
    """Public endpoint — returns branding info (no auth required)."""
    from sqlalchemy import select
    from app.database import async_session
    from app.models.tenant import Tenant

    async with async_session() as db:
        result = await db.execute(select(Tenant).where(Tenant.is_active == True).limit(1))
        tenant = result.scalar_one_or_none()

    if not tenant:
        return {"brand_name": None, "logo_url": None, "favicon_url": None}

    return {
        "brand_name": tenant.brand_name,
        "logo_url": tenant.brand_logo,
        "favicon_url": tenant.brand_favicon,
    }


@app.get("/api/branding/favicon")
async def get_favicon():
    """Public endpoint — serves favicon image."""
    from sqlalchemy import select
    from app.database import async_session
    from app.models.tenant import Tenant

    async with async_session() as db:
        result = await db.execute(select(Tenant).where(Tenant.is_active == True).limit(1))
        tenant = result.scalar_one_or_none()

    if tenant and tenant.brand_favicon:
        # Parse data URI: data:image/png;base64,AAAA...
        try:
            header, data = tenant.brand_favicon.split(",", 1)
            media_type = header.split(":")[1].split(";")[0]
            return Response(content=base64.b64decode(data), media_type=media_type)
        except Exception:
            pass

    # Default: return a simple SVG favicon
    svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#6366f1"/><text x="16" y="23" text-anchor="middle" fill="white" font-size="20" font-weight="bold" font-family="Arial">V</text></svg>'
    return Response(content=svg, media_type="image/svg+xml")


@app.get("/api/images")
async def list_images():
    """Proxy to CloudWM to list available Windows images."""
    from app.services.cloudwm import CloudWMClient

    client = CloudWMClient(
        api_url=settings.cloudwm_api_url,
        client_id=settings.cloudwm_client_id,
        secret=settings.cloudwm_secret,
    )
    return await client.list_images()
