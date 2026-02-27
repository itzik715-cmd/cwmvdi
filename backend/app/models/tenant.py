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
    cloudwm_api_url: Mapped[str] = mapped_column(String(255), nullable=False)
    cloudwm_client_id: Mapped[str] = mapped_column(String(255), nullable=False)
    cloudwm_secret_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    boundary_org_id: Mapped[str | None] = mapped_column(String(100))
    boundary_project_id: Mapped[str | None] = mapped_column(String(100))
    boundary_host_catalog_id: Mapped[str | None] = mapped_column(String(100))
    boundary_host_set_id: Mapped[str | None] = mapped_column(String(100))
    suspend_threshold_minutes: Mapped[int] = mapped_column(Integer, default=30)
    max_session_hours: Mapped[int] = mapped_column(Integer, default=8)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    users: Mapped[list["User"]] = relationship(back_populates="tenant")
    desktops: Mapped[list["DesktopAssignment"]] = relationship(back_populates="tenant")
