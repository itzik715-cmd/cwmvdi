import time
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, status, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.dependencies import get_current_user
from app.models.tenant import Tenant
from app.models.user import User
from app.services.auth import verify_password, create_access_token
from app.services.mfa import (
    generate_mfa_secret,
    get_totp_uri,
    generate_qr_code_base64,
    verify_totp,
)

router = APIRouter()
settings = get_settings()

# Simple in-memory rate limiter
_login_attempts: dict[str, list[float]] = defaultdict(list)


def _check_rate_limit(key: str) -> None:
    now = time.time()
    attempts = _login_attempts[key]
    _login_attempts[key] = [t for t in attempts if now - t < 60]
    if len(_login_attempts[key]) >= settings.login_rate_limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts. Try again in 1 minute.",
        )
    _login_attempts[key].append(now)


# ── Schemas ──


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    requires_mfa: bool
    mfa_token: str | None = None  # temporary token for MFA step
    access_token: str | None = None
    token_type: str = "bearer"


class MFAVerifyRequest(BaseModel):
    mfa_token: str
    code: str


class MFASetupResponse(BaseModel):
    secret: str
    qr_code: str  # base64 PNG
    provisioning_uri: str


# ── Endpoints ──


@router.post("/login", response_model=LoginResponse)
async def login(req: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)):
    client_ip = request.client.host if request.client else "unknown"
    _check_rate_limit(client_ip)

    result = await db.execute(
        select(User).where(
            User.username == req.username,
            User.is_active == True,
        )
    )
    user = result.scalar_one_or_none()

    if user is None or not verify_password(req.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

    if user.mfa_enabled and user.mfa_secret:
        # Issue a temporary MFA token (short-lived, limited scope)
        mfa_token = create_access_token(
            user_id=user.id,
            tenant_id=user.tenant_id,
            role="mfa_pending",
        )
        return LoginResponse(requires_mfa=True, mfa_token=mfa_token)

    # No MFA — issue full access token
    access_token = create_access_token(
        user_id=user.id, tenant_id=user.tenant_id, role=user.role
    )
    return LoginResponse(requires_mfa=False, access_token=access_token)


@router.post("/verify-mfa", response_model=LoginResponse)
async def verify_mfa(req: MFAVerifyRequest, db: AsyncSession = Depends(get_db)):
    from app.services.auth import decode_access_token
    import uuid

    payload = decode_access_token(req.mfa_token)
    if payload is None or payload.get("role") != "mfa_pending":
        raise HTTPException(status_code=401, detail="Invalid MFA token")

    user_id = uuid.UUID(payload["sub"])
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if user is None or not user.mfa_secret:
        raise HTTPException(status_code=401, detail="Invalid user")

    if not verify_totp(user.mfa_secret, req.code):
        raise HTTPException(status_code=401, detail="Invalid MFA code")

    access_token = create_access_token(
        user_id=user.id, tenant_id=user.tenant_id, role=user.role
    )
    return LoginResponse(requires_mfa=False, access_token=access_token)


@router.post("/logout")
async def logout():
    # JWT is stateless; client discards the token.
    return {"message": "Logged out"}


@router.get("/me")
async def get_me(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    data = {
        "id": str(user.id),
        "username": user.username,
        "email": user.email,
        "role": user.role,
        "mfa_enabled": user.mfa_enabled,
        "must_change_password": user.must_change_password,
        "tenant_id": str(user.tenant_id),
    }
    # For admin users, include cloudwm_setup_required from tenant
    if user.role in ("admin", "superadmin"):
        result = await db.execute(select(Tenant).where(Tenant.id == user.tenant_id))
        tenant = result.scalar_one_or_none()
        if tenant:
            data["cloudwm_setup_required"] = tenant.cloudwm_setup_required
    return data


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@router.post("/change-password")
async def change_password(
    req: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.services.auth import hash_password as do_hash

    if not verify_password(req.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    if len(req.new_password) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters")

    user.password_hash = do_hash(req.new_password)
    user.must_change_password = False
    await db.commit()
    return {"message": "Password changed successfully"}


@router.post("/setup-mfa", response_model=MFASetupResponse)
async def setup_mfa(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.mfa_enabled:
        raise HTTPException(status_code=400, detail="MFA already enabled")

    secret = generate_mfa_secret()
    uri = get_totp_uri(secret, user.username)
    qr = generate_qr_code_base64(uri)

    user.mfa_secret = secret
    await db.commit()

    return MFASetupResponse(secret=secret, qr_code=qr, provisioning_uri=uri)


@router.post("/confirm-mfa")
async def confirm_mfa(
    code: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Confirm MFA setup by verifying the first code."""
    if not user.mfa_secret:
        raise HTTPException(status_code=400, detail="MFA not set up yet")

    if not verify_totp(user.mfa_secret, code):
        raise HTTPException(status_code=400, detail="Invalid code — scan the QR and try again")

    user.mfa_enabled = True
    await db.commit()
    return {"message": "MFA enabled successfully"}
