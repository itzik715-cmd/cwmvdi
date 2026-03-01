import uuid
from datetime import datetime

from sqlalchemy import String, Integer, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class DesktopAssignment(Base):
    __tablename__ = "desktop_assignments"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False
    )
    cloudwm_server_id: Mapped[str] = mapped_column(String(100), nullable=False)
    boundary_target_id: Mapped[str | None] = mapped_column(String(100))
    boundary_host_id: Mapped[str | None] = mapped_column(String(100))
    vm_private_ip: Mapped[str | None] = mapped_column(String(45))
    display_name: Mapped[str] = mapped_column(String(100), default="My Desktop")
    current_state: Mapped[str] = mapped_column(String(20), default="unknown")
    # states: on | off | suspended | starting | suspending | unknown
    last_state_check: Mapped[datetime | None] = mapped_column(DateTime)
    vm_rdp_username: Mapped[str | None] = mapped_column(String(100))
    vm_rdp_password_encrypted: Mapped[str | None] = mapped_column(Text)
    vm_cpu: Mapped[str | None] = mapped_column(String(10))  # e.g. "2B", "4A"
    vm_ram_mb: Mapped[int | None] = mapped_column(Integer)    # e.g. 4096
    vm_disk_gb: Mapped[int | None] = mapped_column(Integer)   # e.g. 50
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    user: Mapped["User"] = relationship(back_populates="desktops")
    tenant: Mapped["Tenant"] = relationship(back_populates="desktops")
    sessions: Mapped[list["Session"]] = relationship(back_populates="desktop")
