from celery import Celery
from celery.schedules import crontab

from app.config import get_settings

settings = get_settings()

celery_app = Celery(
    "cwmvdi",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["app.workers.auto_suspend"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    beat_schedule={
        "check-idle-sessions": {
            "task": "app.workers.auto_suspend.check_idle_sessions",
            "schedule": 300.0,  # every 5 minutes
        },
    },
)
