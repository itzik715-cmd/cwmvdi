"""Add VM spec columns to desktop_assignments

Revision ID: 006
Revises: 005
"""
from alembic import op
import sqlalchemy as sa

revision = "006"
down_revision = "005"


def upgrade():
    op.add_column("desktop_assignments", sa.Column("vm_cpu", sa.String(10), nullable=True))
    op.add_column("desktop_assignments", sa.Column("vm_ram_mb", sa.Integer(), nullable=True))
    op.add_column("desktop_assignments", sa.Column("vm_disk_gb", sa.Integer(), nullable=True))


def downgrade():
    op.drop_column("desktop_assignments", "vm_disk_gb")
    op.drop_column("desktop_assignments", "vm_ram_mb")
    op.drop_column("desktop_assignments", "vm_cpu")
