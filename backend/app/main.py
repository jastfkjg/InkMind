from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect, text

from app.config import settings
from app.database import Base, engine
from app.observability.otel_setup import setup_otel
from app.routers import auth, chapters, characters, memos, meta, novels, usage


def _migrate_sqlite() -> None:
    if not settings.database_url.startswith("sqlite"):
        return
    try:
        insp = inspect(engine)
        tables = insp.get_table_names()
        if "users" not in tables:
            return
        with engine.begin() as conn:
            cols_users = {c["name"] for c in insp.get_columns("users")}
            if "preferred_llm_provider" not in cols_users:
                conn.execute(
                    text("ALTER TABLE users ADD COLUMN preferred_llm_provider VARCHAR(128)")
                )
            if "llm_call_count" not in cols_users:
                conn.execute(text("ALTER TABLE users ADD COLUMN llm_call_count INTEGER NOT NULL DEFAULT 0"))
            if "novels" in tables:
                ncols = {c["name"] for c in insp.get_columns("novels")}
                if "outline" in ncols and "background" not in ncols:
                    conn.execute(text("ALTER TABLE novels RENAME COLUMN outline TO background"))
            if "characters" in tables:
                cols = {c["name"] for c in insp.get_columns("characters")}
                if "relationships" in cols:
                    try:
                        conn.execute(text("ALTER TABLE characters DROP COLUMN relationships"))
                    except Exception:
                        pass
            if "character_relationships" in tables:
                conn.execute(text("DROP TABLE IF EXISTS character_relationships"))
    except Exception:
        pass


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    _migrate_sqlite()
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)

origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(auth.router)
app.include_router(novels.router)
app.include_router(chapters.router)
app.include_router(characters.router)
app.include_router(memos.router)
app.include_router(meta.router)
app.include_router(usage.router)

setup_otel(app)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
