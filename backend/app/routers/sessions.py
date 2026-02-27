from fastapi import APIRouter

router = APIRouter()


# Session endpoints are covered by:
# - /api/desktops/{id}/connect (creates session)
# - /api/desktops/{id}/disconnect (ends session)
# - /api/desktops/heartbeat (updates session)
# - /api/admin/sessions (lists/terminates sessions)
#
# This router is a placeholder for future session-specific endpoints.
