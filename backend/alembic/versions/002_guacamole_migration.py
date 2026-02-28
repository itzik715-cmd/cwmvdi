"""Guacamole migration - add connection fields

Revision ID: 002
Revises: 001
Create Date: 2026-02-28

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Sessions: new connection tracking fields
    op.add_column("sessions", sa.Column("connection_type", sa.String(20), server_default="'browser'"))
    op.add_column("sessions", sa.Column("guacamole_connection_id", sa.String(255), nullable=True))
    op.add_column("sessions", sa.Column("proxy_port", sa.Integer, nullable=True))
    op.add_column("sessions", sa.Column("proxy_pid", sa.Integer, nullable=True))

    # Desktop assignments: VM RDP credentials for Guacamole auto-login
    op.add_column("desktop_assignments", sa.Column("vm_rdp_username", sa.String(100), nullable=True))
    op.add_column("desktop_assignments", sa.Column("vm_rdp_password_encrypted", sa.Text, nullable=True))


def downgrade() -> None:
    op.drop_column("desktop_assignments", "vm_rdp_password_encrypted")
    op.drop_column("desktop_assignments", "vm_rdp_username")
    op.drop_column("sessions", "proxy_pid")
    op.drop_column("sessions", "proxy_port")
    op.drop_column("sessions", "guacamole_connection_id")
    op.drop_column("sessions", "connection_type")
