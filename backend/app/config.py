from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # Database
    database_url: str = "postgresql+asyncpg://kamvdi:changeme@localhost:5432/kamvdi"

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # JWT
    secret_key: str = "changeme-generate-with-openssl-rand-hex-32"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 480  # 8 hours

    # Encryption key for storing secrets (CloudWM API secret, etc.)
    encryption_key: str = "changeme-generate-with-openssl-rand-hex-32"

    # Boundary
    boundary_url: str = "https://103.45.244.158:9200"
    boundary_auth_method_id: str = "ampw_bRddZwbskJ"
    boundary_admin_login: str = "admin"
    boundary_admin_password: str = "changeme"
    boundary_tls_insecure: bool = True

    # CloudWM defaults
    cloudwm_api_url: str = "https://console.clubvps.com/service"
    cloudwm_client_id: str = ""
    cloudwm_secret: str = ""

    # Portal
    portal_url: str = "https://localhost"
    portal_domain: str = "localhost"

    # Settings defaults
    default_suspend_threshold: int = 30
    default_max_session_hours: int = 8

    # Admin bootstrap
    admin_email: str = "admin@kamvdi.io"
    admin_password: str = "changeme"

    # Rate limiting
    login_rate_limit: int = 5  # max attempts per minute

    model_config = {"env_file": ".env", "extra": "ignore"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
