"""Redis-based JWT token blacklist for logout/revocation."""
import logging

import redis.asyncio as aioredis

from app.config import get_settings

logger = logging.getLogger(__name__)

_BLACKLIST_PREFIX = "token:blacklist:"
_DEFAULT_TTL = 12 * 3600  # 12 hours (max token lifetime)


async def _get_redis():
    settings = get_settings()
    return aioredis.from_url(settings.redis_url)


async def blacklist_token(jti: str, ttl: int = _DEFAULT_TTL) -> None:
    """Add a token JTI to the blacklist with TTL."""
    try:
        r = await _get_redis()
        await r.setex(f"{_BLACKLIST_PREFIX}{jti}", ttl, "1")
        await r.aclose()
    except Exception:
        logger.warning("Failed to blacklist token %s (Redis unavailable)", jti)


async def is_token_blacklisted(jti: str) -> bool:
    """Check if a token JTI is blacklisted."""
    try:
        r = await _get_redis()
        result = await r.exists(f"{_BLACKLIST_PREFIX}{jti}")
        await r.aclose()
        return bool(result)
    except Exception:
        logger.warning("Failed to check token blacklist (Redis unavailable)")
        return False
