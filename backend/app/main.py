from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import auth, desktops, admin, sessions


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    yield
    # Shutdown


app = FastAPI(
    title="KamVDI API",
    description="Virtual Desktop Infrastructure for Kamatera CloudWM",
    version="1.0.0",
    lifespan=lifespan,
)

settings = get_settings()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.portal_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(desktops.router, prefix="/api/desktops", tags=["desktops"])
app.include_router(admin.router, prefix="/api/admin", tags=["admin"])
app.include_router(sessions.router, prefix="/api/sessions", tags=["sessions"])


@app.get("/api/health")
async def health_check():
    checks = {"database": "error", "redis": "error", "guacamole": "error", "cloudwm": "error"}

    # Database
    try:
        from app.database import async_session
        from sqlalchemy import text

        async with async_session() as session:
            await session.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception:
        pass

    # Redis
    try:
        import redis.asyncio as aioredis

        r = aioredis.from_url(settings.redis_url)
        await r.ping()
        await r.aclose()
        checks["redis"] = "ok"
    except Exception:
        pass

    # Guacamole
    try:
        import httpx

        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{settings.guacamole_url}/api/languages")
            if resp.status_code == 200:
                checks["guacamole"] = "ok"
    except Exception:
        pass

    # CloudWM
    try:
        import httpx

        async with httpx.AsyncClient(timeout=5) as client:
            auth_resp = await client.post(
                f"{settings.cloudwm_api_url}/authenticate",
                json={"clientId": settings.cloudwm_client_id, "secret": settings.cloudwm_secret},
            )
            if auth_resp.status_code == 200 and "authentication" in auth_resp.json():
                checks["cloudwm"] = "ok"
    except Exception:
        pass

    overall = "ok" if all(v == "ok" for v in checks.values()) else "degraded"
    return {"status": overall, "version": "1.0.0", **checks}


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
