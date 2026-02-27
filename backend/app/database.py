from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings

settings = get_settings()

engine = create_async_engine(settings.database_url, echo=False)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()


def get_db_sync():
    """Synchronous DB session for scripts and CLI tools."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session as SyncSession, sessionmaker

    sync_url = settings.database_url.replace("+asyncpg", "")
    sync_engine = create_engine(sync_url, echo=False)

    SyncSessionLocal = sessionmaker(bind=sync_engine, class_=SyncSession)
    return SyncSessionLocal()
