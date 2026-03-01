import uuid
from datetime import datetime

from sqlalchemy import String, Integer, Boolean, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Tenant(Base):
    __tablename__ = "tenants"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    slug: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    cloudwm_api_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    cloudwm_client_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    cloudwm_secret_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    boundary_org_id: Mapped[str | None] = mapped_column(String(100))
    boundary_project_id: Mapped[str | None] = mapped_column(String(100))
    boundary_host_catalog_id: Mapped[str | None] = mapped_column(String(100))
    boundary_host_set_id: Mapped[str | None] = mapped_column(String(100))
    system_server_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    system_server_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    locked_datacenter: Mapped[str | None] = mapped_column(String(20), nullable=True)
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cloudwm_setup_required: Mapped[bool] = mapped_column(Boolean, default=True)
    nat_gateway_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    gateway_lan_ip: Mapped[str | None] = mapped_column(String(45), nullable=True)
    default_network_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    suspend_threshold_minutes: Mapped[int] = mapped_column(Integer, default=30)
    max_session_hours: Mapped[int] = mapped_column(Integer, default=8)

    # DUO Security MFA
    duo_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    duo_ikey: Mapped[str | None] = mapped_column(String(255), nullable=True)
    duo_skey_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    duo_api_host: Mapped[str | None] = mapped_column(String(255), nullable=True)
    duo_auth_mode: Mapped[str] = mapped_column(String(20), default="password_duo")

    # Branding
    brand_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    brand_logo: Mapped[str | None] = mapped_column(Text, nullable=True)
    brand_favicon: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    users: Mapped[list["User"]] = relationship(back_populates="tenant")
    desktops: Mapped[list["DesktopAssignment"]] = relationship(back_populates="tenant")
