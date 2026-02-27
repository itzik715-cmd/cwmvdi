"""Initial schema

Revision ID: 001
Revises:
Create Date: 2026-02-27

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "tenants",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("slug", sa.String(50), unique=True, nullable=False),
        sa.Column("cloudwm_api_url", sa.String(255), nullable=False),
        sa.Column("cloudwm_client_id", sa.String(255), nullable=False),
        sa.Column("cloudwm_secret_encrypted", sa.Text, nullable=False),
        sa.Column("boundary_org_id", sa.String(100)),
        sa.Column("boundary_project_id", sa.String(100)),
        sa.Column("boundary_host_catalog_id", sa.String(100)),
        sa.Column("boundary_host_set_id", sa.String(100)),
        sa.Column("suspend_threshold_minutes", sa.Integer, server_default="30"),
        sa.Column("max_session_hours", sa.Integer, server_default="8"),
        sa.Column("created_at", sa.DateTime, server_default=sa.text("NOW()")),
        sa.Column("is_active", sa.Boolean, server_default=sa.text("TRUE")),
    )

    op.create_table(
        "users",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("mfa_secret", sa.String(255)),
        sa.Column("mfa_enabled", sa.Boolean, server_default=sa.text("FALSE")),
        sa.Column("role", sa.String(20), server_default="'user'"),
        sa.Column("is_active", sa.Boolean, server_default=sa.text("TRUE")),
        sa.Column("created_at", sa.DateTime, server_default=sa.text("NOW()")),
        sa.UniqueConstraint("tenant_id", "email", name="uq_tenant_email"),
    )

    op.create_table(
        "desktop_assignments",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("cloudwm_server_id", sa.String(100), nullable=False),
        sa.Column("boundary_target_id", sa.String(100)),
        sa.Column("boundary_host_id", sa.String(100)),
        sa.Column("vm_private_ip", sa.String(45)),
        sa.Column("display_name", sa.String(100), server_default="'My Desktop'"),
        sa.Column("current_state", sa.String(20), server_default="'unknown'"),
        sa.Column("last_state_check", sa.DateTime),
        sa.Column("created_at", sa.DateTime, server_default=sa.text("NOW()")),
        sa.Column("is_active", sa.Boolean, server_default=sa.text("TRUE")),
    )

    op.create_table(
        "sessions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("desktop_id", UUID(as_uuid=True), sa.ForeignKey("desktop_assignments.id"), nullable=False),
        sa.Column("boundary_session_id", sa.String(100)),
        sa.Column("boundary_auth_token", sa.Text),
        sa.Column("started_at", sa.DateTime, server_default=sa.text("NOW()")),
        sa.Column("ended_at", sa.DateTime),
        sa.Column("last_heartbeat", sa.DateTime, server_default=sa.text("NOW()")),
        sa.Column("end_reason", sa.String(50)),
        sa.Column("client_ip", sa.String(45)),
        sa.Column("agent_version", sa.String(20)),
    )

    op.create_index("ix_sessions_active", "sessions", ["ended_at"], postgresql_where=sa.text("ended_at IS NULL"))
    op.create_index("ix_desktop_assignments_user", "desktop_assignments", ["user_id"])
    op.create_index("ix_users_tenant", "users", ["tenant_id"])


def downgrade() -> None:
    op.drop_table("sessions")
    op.drop_table("desktop_assignments")
    op.drop_table("users")
    op.drop_table("tenants")
