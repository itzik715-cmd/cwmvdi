"""Add username column, make email nullable

Revision ID: 003
Revises: 002
"""
from alembic import op
import sqlalchemy as sa

revision = "003"
down_revision = "002"


def upgrade():
    # Add username column with a default so existing rows are valid
    op.add_column("users", sa.Column("username", sa.String(100), nullable=False, server_default=""))

    # Populate username from email (part before @) for existing users
    op.execute(
        "UPDATE users SET username = SPLIT_PART(email, '@', 1) WHERE username = ''"
    )

    # Remove the server default now that data is populated
    op.alter_column("users", "username", server_default=None)

    # Make email nullable
    op.alter_column("users", "email", nullable=True)

    # Drop old unique constraint and create new one
    op.drop_constraint("uq_tenant_email", "users", type_="unique")
    op.create_unique_constraint("uq_tenant_username", "users", ["tenant_id", "username"])


def downgrade():
    op.drop_constraint("uq_tenant_username", "users", type_="unique")
    op.create_unique_constraint("uq_tenant_email", "users", ["tenant_id", "email"])
    op.alter_column("users", "email", nullable=False)
    op.drop_column("users", "username")
