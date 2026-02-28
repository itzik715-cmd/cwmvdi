"""Add mfa_required column to users

Revision ID: 004
Revises: 003
"""
from alembic import op
import sqlalchemy as sa

revision = "004"
down_revision = "003"


def upgrade():
    op.add_column("users", sa.Column("mfa_required", sa.Boolean(), nullable=False, server_default="false"))
    op.alter_column("users", "mfa_required", server_default=None)


def downgrade():
    op.drop_column("users", "mfa_required")
