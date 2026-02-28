"""Add DUO Security MFA fields to tenants

Revision ID: 005
Revises: 004
"""
from alembic import op
import sqlalchemy as sa

revision = "005"
down_revision = "004"


def upgrade():
    op.add_column("tenants", sa.Column("duo_enabled", sa.Boolean(), nullable=False, server_default="false"))
    op.alter_column("tenants", "duo_enabled", server_default=None)

    op.add_column("tenants", sa.Column("duo_ikey", sa.String(255), nullable=True))
    op.add_column("tenants", sa.Column("duo_skey_encrypted", sa.Text(), nullable=True))
    op.add_column("tenants", sa.Column("duo_api_host", sa.String(255), nullable=True))

    op.add_column("tenants", sa.Column("duo_auth_mode", sa.String(20), nullable=False, server_default="password_duo"))
    op.alter_column("tenants", "duo_auth_mode", server_default=None)


def downgrade():
    op.drop_column("tenants", "duo_auth_mode")
    op.drop_column("tenants", "duo_api_host")
    op.drop_column("tenants", "duo_skey_encrypted")
    op.drop_column("tenants", "duo_ikey")
    op.drop_column("tenants", "duo_enabled")
