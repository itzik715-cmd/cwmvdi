"""Add system server fields to tenants and cached images/networks tables

Revision ID: 003
Revises: 002
Create Date: 2026-02-27

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add new columns to tenants
    op.add_column("tenants", sa.Column("system_server_id", sa.String(100), nullable=True))
    op.add_column("tenants", sa.Column("system_server_name", sa.String(100), nullable=True))
    op.add_column("tenants", sa.Column("locked_datacenter", sa.String(20), nullable=True))
    op.add_column("tenants", sa.Column("last_sync_at", sa.DateTime, nullable=True))
    op.add_column(
        "tenants",
        sa.Column("cloudwm_setup_required", sa.Boolean, server_default=sa.text("TRUE"), nullable=False),
    )

    # Create cached_images table
    op.create_table(
        "cached_images",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("image_id", sa.String(255), nullable=False),
        sa.Column("description", sa.String(500)),
        sa.Column("size_gb", sa.Integer, server_default="0"),
        sa.Column("datacenter", sa.String(20), nullable=False),
        sa.Column("synced_at", sa.DateTime, server_default=sa.text("NOW()")),
    )
    op.create_index("ix_cached_images_tenant", "cached_images", ["tenant_id"])

    # Create cached_networks table
    op.create_table(
        "cached_networks",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("subnet", sa.String(100)),
        sa.Column("datacenter", sa.String(20), nullable=False),
        sa.Column("synced_at", sa.DateTime, server_default=sa.text("NOW()")),
    )
    op.create_index("ix_cached_networks_tenant", "cached_networks", ["tenant_id"])


def downgrade() -> None:
    op.drop_table("cached_networks")
    op.drop_table("cached_images")
    op.drop_column("tenants", "cloudwm_setup_required")
    op.drop_column("tenants", "last_sync_at")
    op.drop_column("tenants", "locked_datacenter")
    op.drop_column("tenants", "system_server_name")
    op.drop_column("tenants", "system_server_id")
