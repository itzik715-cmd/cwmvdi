"""Add mfa_bypass column to users

Revision ID: 007
Revises: 006
"""
from alembic import op
import sqlalchemy as sa

revision = "007"
down_revision = "006"


def upgrade():
    op.add_column("users", sa.Column("mfa_bypass", sa.Boolean(), nullable=False, server_default="false"))
    op.alter_column("users", "mfa_bypass", server_default=None)


def downgrade():
    op.drop_column("users", "mfa_bypass")
