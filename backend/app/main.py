from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect, text

from app.config import settings
from app.database import Base, engine
from app.routers import auth, chapters, characters, meta, novels


def _migrate_sqlite() -> None:
    if not settings.database_url.startswith("sqlite"):
        return
    try:
        insp = inspect(engine)
        tables = insp.get_table_names()
        if "users" not in tables:
            return
        cols = {c["name"] for c in insp.get_columns("users")}
        if "preferred_llm_provider" not in cols:
            with engine.begin() as conn:
                conn.execute(
                    text("ALTER TABLE users ADD COLUMN preferred_llm_provider VARCHAR(128)")
                )
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
app.include_router(meta.router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
