import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import auth, desktops, admin, sessions

is_production = os.getenv("ENVIRONMENT", "production") != "development"


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
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
