"""Add branding columns to tenants

Revision ID: 008
Revises: 007
"""
from alembic import op
import sqlalchemy as sa

revision = "008"
down_revision = "007"


def upgrade():
    op.add_column("tenants", sa.Column("brand_name", sa.String(100), nullable=True))
    op.add_column("tenants", sa.Column("brand_logo", sa.Text(), nullable=True))
    op.add_column("tenants", sa.Column("brand_favicon", sa.Text(), nullable=True))


def downgrade():
    op.drop_column("tenants", "brand_favicon")
    op.drop_column("tenants", "brand_logo")
    op.drop_column("tenants", "brand_name")
