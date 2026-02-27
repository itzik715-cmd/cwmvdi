import uuid
from datetime import datetime

from sqlalchemy import String, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    desktop_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("desktop_assignments.id"), nullable=False
    )
    boundary_session_id: Mapped[str | None] = mapped_column(String(100))
    boundary_auth_token: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_heartbeat: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    end_reason: Mapped[str | None] = mapped_column(String(50))
    # reasons: user_disconnect | idle_timeout | admin_terminate | error
    client_ip: Mapped[str | None] = mapped_column(String(45))
    agent_version: Mapped[str | None] = mapped_column(String(20))

    user: Mapped["User"] = relationship(back_populates="sessions")
    desktop: Mapped["DesktopAssignment"] = relationship(back_populates="sessions")
