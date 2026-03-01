import re
import time
import uuid
from collections import defaultdict
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.dependencies import get_current_user
from app.models.tenant import Tenant
from app.models.user import User
from app.services.auth import (
    verify_password,
    create_access_token,
    decode_access_token,
    validate_password_strength,
)
from app.services.mfa import (
    generate_mfa_secret,
    get_totp_uri,
    generate_qr_code_base64,
    verify_totp,
)
from app.services.token_blacklist import blacklist_token

router = APIRouter()
settings = get_settings()

# Rate limiter (login + MFA verification)
_rate_attempts: dict[str, list[float]] = defaultdict(list)

# Account lockout tracking
_failed_attempts: dict[str, int] = defaultdict(int)
_lockout_until: dict[str, float] = {}


def _check_rate_limit(key: str, max_attempts: int | None = None, window: int = 60) -> None:
    now = time.time()
    limit = max_attempts or settings.login_rate_limit

    # Check account lockout
    if key in _lockout_until and now < _lockout_until[key]:
        remaining = int(_lockout_until[key] - now)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Account locked. Try again in {remaining} seconds.",
        )

    attempts = _rate_attempts[key]
    _rate_attempts[key] = [t for t in attempts if now - t < window]
    if len(_rate_attempts[key]) >= limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many attempts. Try again in {window} seconds.",
        )
    _rate_attempts[key].append(now)


def _record_failed_attempt(key: str) -> None:
    """Track failed attempts for progressive lockout."""
    _failed_attempts[key] += 1
    count = _failed_attempts[key]
    if count >= 15:
        _lockout_until[key] = time.time() + 1800  # 30 minutes
    elif count >= 10:
        _lockout_until[key] = time.time() + 300  # 5 minutes
    elif count >= 7:
        _lockout_until[key] = time.time() + 60  # 1 minute


def _clear_failed_attempts(key: str) -> None:
    _failed_attempts.pop(key, None)
    _lockout_until.pop(key, None)


# ── Schemas ──


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=150)
    password: str | None = Field(None, max_length=256)


class LoginResponse(BaseModel):
    requires_mfa: bool = False
    mfa_token: str | None = None
    access_token: str | None = None
    token_type: str = "bearer"
    # DUO fields
    requires_duo: bool = False
    duo_token: str | None = None
    duo_factors: list[str] | None = None
    duo_devices: list[dict] | None = None
    mfa_type: str | None = None


class MFAVerifyRequest(BaseModel):
    mfa_token: str
    code: str = Field(..., min_length=6, max_length=6, pattern=r"^\d{6}$")


class DuoVerifyRequest(BaseModel):
    duo_token: str
    factor: str = Field("push", pattern=r"^(push|passcode)$")
    passcode: str | None = Field(None, max_length=20)
    device: str = Field("auto", max_length=50)


class MFASetupResponse(BaseModel):
    secret: str
    qr_code: str  # base64 PNG
    provisioning_uri: str


class ConfirmMFARequest(BaseModel):
    code: str = Field(..., min_length=6, max_length=6, pattern=r"^\d{6}$")


# ── Endpoints ──


_MFA_TOKEN_EXPIRY = timedelta(minutes=5)


def _get_client_ip(request: Request) -> str:
    """Extract real client IP, respecting X-Real-IP / X-Forwarded-For from nginx."""
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


@router.post("/login")
async def login(req: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)):
    client_ip = _get_client_ip(request)
    _check_rate_limit(client_ip)

    result = await db.execute(
        select(User).where(
            User.username == req.username,
            User.is_active == True,
        )
    )
    user = result.scalar_one_or_none()

    # Load tenant to check DUO settings
    tenant = None
    if user:
        t_result = await db.execute(select(Tenant).where(Tenant.id == user.tenant_id))
        tenant = t_result.scalar_one_or_none()

    is_admin = user.role in ("admin", "superadmin") if user else False
    lockout_key = f"user:{req.username}"

    # Check per-user lockout
    _check_rate_limit(lockout_key, max_attempts=10, window=300)

    # === DUO ENABLED PATH ===
    duo_active = (
        tenant and tenant.duo_enabled
        and tenant.duo_ikey and tenant.duo_skey_encrypted and tenant.duo_api_host
    )
    if duo_active:
        from app.services.duo import DuoClient, DuoAuthError
        from app.services.encryption import decrypt_value

        # Admin always needs password; regular users depend on auth_mode
        password_required = is_admin or tenant.duo_auth_mode == "password_duo"

        if password_required:
            if not req.password:
                raise HTTPException(status_code=400, detail="Password is required")
            if user is None or not verify_password(req.password, user.password_hash):
                _record_failed_attempt(lockout_key)
                raise HTTPException(status_code=401, detail="Invalid username or password")
        else:
            # duo_only mode for regular users
            if user is None:
                raise HTTPException(status_code=401, detail="Invalid username or password")

        _clear_failed_attempts(lockout_key)

        # DUO preauth
        duo_skey = decrypt_value(tenant.duo_skey_encrypted)
        duo_client = DuoClient(tenant.duo_ikey, duo_skey, tenant.duo_api_host)

        try:
            preauth_result = await duo_client.preauth(user.username)
        except DuoAuthError:
            raise HTTPException(status_code=401, detail="MFA verification failed")

        preauth_status = preauth_result.get("result")

        if preauth_status == "allow":
            token_expiry = timedelta(hours=4) if is_admin else timedelta(hours=12)
            access_token = create_access_token(
                user_id=user.id, tenant_id=user.tenant_id, role=user.role,
                expires_delta=token_expiry,
            )
            return {"requires_mfa": False, "requires_duo": False, "access_token": access_token, "token_type": "bearer"}

        if preauth_status == "deny":
            raise HTTPException(status_code=401, detail="Access denied")

        if preauth_status == "enroll":
            raise HTTPException(status_code=401, detail="User not enrolled in MFA. Contact your administrator.")

        # preauth_status == "auth" — return available factors
        devices = preauth_result.get("devices", [])
        factors = set()
        for d in devices:
            factors.update(d.get("capabilities", []))

        duo_token = create_access_token(
            user_id=user.id, tenant_id=user.tenant_id, role="duo_pending",
            expires_delta=_MFA_TOKEN_EXPIRY,
        )
        return {
            "requires_mfa": False,
            "requires_duo": True,
            "duo_token": duo_token,
            "duo_factors": list(factors),
            "duo_devices": devices,
            "mfa_type": "duo",
            "token_type": "bearer",
        }

    # === TOTP PATH (DUO not enabled) ===
    if user is None or not req.password or not verify_password(req.password, user.password_hash):
        _record_failed_attempt(lockout_key)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

    _clear_failed_attempts(lockout_key)
    token_expiry = timedelta(hours=4) if is_admin else timedelta(hours=12)

    # MFA at login is only required for admins (unless bypassed)
    if is_admin and user.mfa_enabled and user.mfa_secret and not user.mfa_bypass:
        mfa_token = create_access_token(
            user_id=user.id, tenant_id=user.tenant_id, role="mfa_pending",
            expires_delta=_MFA_TOKEN_EXPIRY,
        )
        return LoginResponse(requires_mfa=True, mfa_token=mfa_token)

    access_token = create_access_token(
        user_id=user.id, tenant_id=user.tenant_id, role=user.role,
        expires_delta=token_expiry,
    )
    return LoginResponse(requires_mfa=False, access_token=access_token)


@router.post("/verify-mfa", response_model=LoginResponse)
async def verify_mfa(req: MFAVerifyRequest, request: Request, db: AsyncSession = Depends(get_db)):
    client_ip = request.client.host if request.client else "unknown"
    _check_rate_limit(f"mfa:{client_ip}", max_attempts=5, window=60)

    payload = decode_access_token(req.mfa_token)
    if payload is None or payload.get("role") != "mfa_pending":
        raise HTTPException(status_code=401, detail="Invalid or expired MFA token")

    user_id = uuid.UUID(payload["sub"])
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if user is None or not user.mfa_secret:
        raise HTTPException(status_code=401, detail="Invalid user")

    if not verify_totp(user.mfa_secret, req.code):
        raise HTTPException(status_code=401, detail="Invalid MFA code")

    is_admin = user.role in ("admin", "superadmin")
    token_expiry = timedelta(hours=4) if is_admin else timedelta(hours=12)

    access_token = create_access_token(
        user_id=user.id, tenant_id=user.tenant_id, role=user.role,
        expires_delta=token_expiry,
    )
    return LoginResponse(requires_mfa=False, access_token=access_token)


@router.post("/verify-duo")
async def verify_duo_endpoint(req: DuoVerifyRequest, request: Request, db: AsyncSession = Depends(get_db)):
    """Complete DUO authentication after preauth."""
    client_ip = request.client.host if request.client else "unknown"
    _check_rate_limit(f"duo:{client_ip}", max_attempts=5, window=60)

    from app.services.duo import DuoClient, DuoAuthError
    from app.services.encryption import decrypt_value

    payload = decode_access_token(req.duo_token)
    if payload is None or payload.get("role") != "duo_pending":
        raise HTTPException(status_code=401, detail="Invalid or expired DUO token")

    user_id = uuid.UUID(payload["sub"])
    tenant_id = uuid.UUID(payload["tenant_id"])

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid user")

    t_result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = t_result.scalar_one_or_none()
    if not tenant or not tenant.duo_enabled:
        raise HTTPException(status_code=401, detail="MFA not enabled")

    duo_skey = decrypt_value(tenant.duo_skey_encrypted)
    duo_client = DuoClient(tenant.duo_ikey, duo_skey, tenant.duo_api_host)

    try:
        if req.factor == "push":
            auth_result = await duo_client.auth_push(user.username, req.device)
        elif req.factor == "passcode":
            if not req.passcode:
                raise HTTPException(status_code=400, detail="Passcode required")
            auth_result = await duo_client.auth_passcode(user.username, req.passcode)
        else:
            raise HTTPException(status_code=400, detail="Unsupported factor")
    except DuoAuthError:
        raise HTTPException(status_code=401, detail="MFA verification failed")

    if auth_result.get("result") != "allow":
        raise HTTPException(status_code=401, detail="MFA verification failed")

    is_admin = user.role in ("admin", "superadmin")
    token_expiry = timedelta(hours=4) if is_admin else timedelta(hours=12)

    access_token = create_access_token(
        user_id=user.id, tenant_id=user.tenant_id, role=user.role,
        expires_delta=token_expiry,
    )
    return {"requires_mfa": False, "requires_duo": False, "access_token": access_token, "token_type": "bearer"}


@router.post("/logout")
async def logout(request: Request):
    """Revoke the current JWT token."""
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
        payload = decode_access_token(token)
        if payload and payload.get("jti"):
            await blacklist_token(payload["jti"])
    return {"message": "Logged out"}


@router.get("/me")
async def get_me(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    is_admin = user.role in ("admin", "superadmin")

    # Load tenant for DUO and setup checks
    result = await db.execute(select(Tenant).where(Tenant.id == user.tenant_id))
    tenant = result.scalar_one_or_none()

    duo_active = (
        tenant and tenant.duo_enabled
        and tenant.duo_ikey and tenant.duo_skey_encrypted and tenant.duo_api_host
    )

    if duo_active:
        # When DUO is enabled, skip TOTP setup requirement
        mfa_setup_required = False
        mfa_type = "duo"
    else:
        mfa_type = "totp"
        if is_admin:
            mfa_setup_required = not user.mfa_enabled
        else:
            mfa_setup_required = user.mfa_required and not user.mfa_enabled

    data = {
        "id": str(user.id),
        "username": user.username,
        "email": user.email,
        "role": user.role,
        "mfa_enabled": user.mfa_enabled,
        "mfa_setup_required": mfa_setup_required,
        "mfa_type": mfa_type,
        "mfa_bypass": user.mfa_bypass,
        "must_change_password": user.must_change_password,
        "tenant_id": str(user.tenant_id),
    }
    if duo_active:
        data["duo_auth_mode"] = tenant.duo_auth_mode
    if is_admin and tenant:
        data["cloudwm_setup_required"] = tenant.cloudwm_setup_required
    return data


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., max_length=256)
    new_password: str = Field(..., max_length=256)


@router.post("/change-password")
async def change_password(
    req: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.services.auth import hash_password as do_hash

    if not verify_password(req.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    pw_error = validate_password_strength(req.new_password)
    if pw_error:
        raise HTTPException(status_code=400, detail=pw_error)

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
    req: ConfirmMFARequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Confirm MFA setup by verifying the first code."""
    if not user.mfa_secret:
        raise HTTPException(status_code=400, detail="MFA not set up yet")

    if not verify_totp(user.mfa_secret, req.code):
        raise HTTPException(status_code=400, detail="Invalid code — scan the QR and try again")

    user.mfa_enabled = True
    await db.commit()
    return {"message": "MFA enabled successfully"}
