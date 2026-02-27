"""Add NAT gateway fields to tenants

Revision ID: 004
Revises: 003
Create Date: 2026-02-27

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tenants",
        sa.Column("nat_gateway_enabled", sa.Boolean, server_default=sa.text("FALSE"), nullable=False),
    )
    op.add_column("tenants", sa.Column("gateway_lan_ip", sa.String(45), nullable=True))
    op.add_column("tenants", sa.Column("default_network_name", sa.String(100), nullable=True))


def downgrade() -> None:
    op.drop_column("tenants", "default_network_name")
    op.drop_column("tenants", "gateway_lan_ip")
    op.drop_column("tenants", "nat_gateway_enabled")
