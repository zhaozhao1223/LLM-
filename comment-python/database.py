from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.db.models import Base

SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./analyses.db"

engine = create_async_engine(SQLALCHEMY_DATABASE_URL, echo=False)
async_session = async_sessionmaker(engine, expire_on_commit=False)


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    # 兼容已有数据库：添加可能缺失的列
    async with engine.begin() as conn:
        for stmt in [
            "ALTER TABLE analyses ADD COLUMN request_hash VARCHAR(64) DEFAULT ''",
        ]:
            try:
                await conn.execute(text(stmt))
            except Exception:
                pass


async def get_db():
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()
