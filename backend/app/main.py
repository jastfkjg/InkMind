from contextlib import asynccontextmanager
import logging
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect, text

from app.config import settings
from app.database import Base, engine
from app.deployment import MaintenanceMiddleware
from app.observability.otel_setup import setup_otel
from app.llm.agent_billing_proxy import router as agent_billing_router
from app.routers import admin, agent, auth, background_tasks, billing, chapters, characters, custom_llms, memos, meta, novels, usage, workflow


def _migrate_sqlite() -> None:
    if not settings.database_url.startswith("sqlite"):
        return
    try:
        insp = inspect(engine)
        tables = insp.get_table_names()
        if "users" not in tables:
            return
        table_names = {t["name"] for t in tables} if isinstance(tables, list) and tables and isinstance(tables[0], dict) else set(tables)
        with engine.begin() as conn:
            # Inspect on this transaction so SQLite metadata reads cannot roll back data migrations.
            insp = inspect(conn)
            if "user_custom_llms" not in table_names:
                conn.execute(text("""
                    CREATE TABLE user_custom_llms (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        provider VARCHAR(64) NOT NULL,
                        claude_auth_mode VARCHAR(32) NOT NULL DEFAULT 'auto',
                        api_key VARCHAR(512) NOT NULL,
                        base_url VARCHAR(512),
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                """))
                conn.execute(text("CREATE INDEX ix_user_custom_llms_user_id ON user_custom_llms(user_id)"))
            custom_columns = {c["name"] for c in insp.get_columns("user_custom_llms")}
            if "protocol" not in custom_columns:
                conn.execute(text("ALTER TABLE user_custom_llms ADD COLUMN protocol VARCHAR(32)"))
                conn.execute(text("UPDATE user_custom_llms SET protocol = CASE WHEN provider = 'anthropic' THEN 'anthropic' ELSE 'openai' END"))
            if "default_model" not in custom_columns:
                conn.execute(text("ALTER TABLE user_custom_llms ADD COLUMN default_model VARCHAR(256)"))
            if "claude_auth_mode" not in custom_columns:
                conn.execute(text("ALTER TABLE user_custom_llms ADD COLUMN claude_auth_mode VARCHAR(32) NOT NULL DEFAULT 'auto'"))
            cols_users = {c["name"] for c in insp.get_columns("users")}
            if "preferred_llm_provider" not in cols_users:
                conn.execute(
                    text("ALTER TABLE users ADD COLUMN preferred_llm_provider VARCHAR(128)")
                )
            if "llm_call_count" not in cols_users:
                conn.execute(text("ALTER TABLE users ADD COLUMN llm_call_count INTEGER NOT NULL DEFAULT 0"))
            if "agent_mode" not in cols_users:
                conn.execute(text("ALTER TABLE users ADD COLUMN agent_mode VARCHAR(32) NOT NULL DEFAULT 'flexible'"))
            if "max_llm_iterations" not in cols_users:
                conn.execute(text("ALTER TABLE users ADD COLUMN max_llm_iterations INTEGER NOT NULL DEFAULT 10"))
            if "max_tokens_per_task" not in cols_users:
                conn.execute(text("ALTER TABLE users ADD COLUMN max_tokens_per_task INTEGER NOT NULL DEFAULT 50000"))
            if "enable_auto_audit" not in cols_users:
                conn.execute(text("ALTER TABLE users ADD COLUMN enable_auto_audit BOOLEAN NOT NULL DEFAULT 1"))
            if "preview_before_save" not in cols_users:
                conn.execute(text("ALTER TABLE users ADD COLUMN preview_before_save BOOLEAN NOT NULL DEFAULT 1"))
            if "auto_audit_min_score" not in cols_users:
                conn.execute(text("ALTER TABLE users ADD COLUMN auto_audit_min_score INTEGER NOT NULL DEFAULT 60"))
            if "ai_language" not in cols_users:
                conn.execute(text("ALTER TABLE users ADD COLUMN ai_language VARCHAR(8)"))
            if "is_admin" not in cols_users:
                conn.execute(text("ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT 0"))
            if "token_quota" not in cols_users:
                conn.execute(text("ALTER TABLE users ADD COLUMN token_quota INTEGER"))
            if "token_quota_used" not in cols_users:
                conn.execute(text("ALTER TABLE users ADD COLUMN token_quota_used INTEGER NOT NULL DEFAULT 0"))
            if "token_quota_reset_at" not in cols_users:
                conn.execute(text("ALTER TABLE users ADD COLUMN token_quota_reset_at DATETIME"))
            if "token_quota_reserved" not in cols_users:
                conn.execute(text("ALTER TABLE users ADD COLUMN token_quota_reserved INTEGER NOT NULL DEFAULT 0"))
            if "agent_api_key" not in cols_users:
                conn.execute(text("ALTER TABLE users ADD COLUMN agent_api_key VARCHAR(512)"))
            if "agent_base_url" not in cols_users:
                conn.execute(text("ALTER TABLE users ADD COLUMN agent_base_url VARCHAR(512)"))
            if "agent_model" not in cols_users:
                conn.execute(text("ALTER TABLE users ADD COLUMN agent_model VARCHAR(128)"))
            if "generation_provider" not in cols_users:
                conn.execute(text("ALTER TABLE users ADD COLUMN generation_provider VARCHAR(64)"))
            if "generation_api_key" not in cols_users:
                conn.execute(text("ALTER TABLE users ADD COLUMN generation_api_key VARCHAR(512)"))
            if "generation_base_url" not in cols_users:
                conn.execute(text("ALTER TABLE users ADD COLUMN generation_base_url VARCHAR(512)"))
            if "generation_model" not in cols_users:
                conn.execute(text("ALTER TABLE users ADD COLUMN generation_model VARCHAR(128)"))
            if "preferred_llm_model" not in cols_users:
                conn.execute(text("ALTER TABLE users ADD COLUMN preferred_llm_model VARCHAR(128)"))
            if "generation_use_custom" not in cols_users:
                conn.execute(text("ALTER TABLE users ADD COLUMN generation_use_custom BOOLEAN NOT NULL DEFAULT 0"))
            if "agent_use_custom" not in cols_users:
                conn.execute(text("ALTER TABLE users ADD COLUMN agent_use_custom BOOLEAN NOT NULL DEFAULT 0"))
            if "agent_custom_llm_id" not in cols_users:
                conn.execute(text("ALTER TABLE users ADD COLUMN agent_custom_llm_id INTEGER REFERENCES user_custom_llms(id) ON DELETE SET NULL"))
            if "generation_custom_llm_id" not in cols_users:
                conn.execute(text("ALTER TABLE users ADD COLUMN generation_custom_llm_id INTEGER REFERENCES user_custom_llms(id) ON DELETE SET NULL"))
            if "background_tasks" in table_names:
                task_columns = {c["name"] for c in insp.get_columns("background_tasks")}
                if "request_json" not in task_columns:
                    conn.execute(text("ALTER TABLE background_tasks ADD COLUMN request_json TEXT"))
            if "novels" in table_names:
                ncols = {c["name"] for c in insp.get_columns("novels")}
                if "outline" in ncols and "background" not in ncols:
                    conn.execute(text("ALTER TABLE novels RENAME COLUMN outline TO background"))
                if "is_pinned" not in ncols:
                    conn.execute(text("ALTER TABLE novels ADD COLUMN is_pinned BOOLEAN NOT NULL DEFAULT 0"))
                if "is_archived" not in ncols:
                    conn.execute(text("ALTER TABLE novels ADD COLUMN is_archived BOOLEAN NOT NULL DEFAULT 0"))
            if "characters" in table_names:
                cols = {c["name"] for c in insp.get_columns("characters")}
                if "relationships" in cols:
                    conn.execute(text("ALTER TABLE characters DROP COLUMN relationships"))
            if "character_relationships" in table_names:
                conn.execute(text("DROP TABLE IF EXISTS character_relationships"))
            if "llm_usage_events" in table_names:
                cols_usage = {c["name"] for c in insp.get_columns("llm_usage_events")}
                if "source" not in cols_usage:
                    conn.execute(text("ALTER TABLE llm_usage_events ADD COLUMN source VARCHAR(16) NOT NULL DEFAULT 'builtin'"))
                if "billing_credits" not in cols_usage:
                    conn.execute(text("ALTER TABLE llm_usage_events ADD COLUMN billing_credits INTEGER"))
            if "payment_orders" in table_names:
                payment_columns = {c["name"] for c in insp.get_columns("payment_orders")}
                if "refund_requested_at" not in payment_columns:
                    conn.execute(text("ALTER TABLE payment_orders ADD COLUMN refund_requested_at DATETIME"))
    except Exception:
        logging.getLogger(__name__).exception("Database migration failed")
        raise RuntimeError("数据库迁移失败，请检查服务日志并恢复备份后重试。") from None


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.database_url.startswith("sqlite:///./"):
        db_path = settings.database_url.replace("sqlite:///", "")
        db_dir = os.path.dirname(os.path.abspath(db_path))
        os.makedirs(db_dir, exist_ok=True)
    try:
        Base.metadata.create_all(bind=engine, checkfirst=True)
    except Exception as e:
        if "already exists" in str(e):
            pass
        else:
            raise
    _migrate_sqlite()
    from app.services.billing import recover_reservations, validate_configuration
    validate_configuration()
    if settings.billing_enabled and not settings.desktop_mode:
        from app.database import SessionLocal
        with SessionLocal() as billing_db:
            recover_reservations(billing_db)
    from app.agent.task_queue import get_task_queue
    queue = get_task_queue()
    await queue.start()
    yield
    await queue.stop()


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
app.include_router(billing.router)
app.include_router(agent_billing_router)
app.include_router(background_tasks.router)
app.include_router(admin.router)
app.include_router(workflow.router)
app.include_router(agent.router)
app.include_router(custom_llms.router)

maintenance = MaintenanceMiddleware(app, os.getenv("INKMIND_MAINTENANCE_FILE", ""))
# Wrap the ASGI app without BaseHTTPMiddleware so SSE stays counted until its stream closes.
app.add_middleware(MaintenanceMiddleware, state=maintenance)

setup_otel(app)


@app.get("/health", response_model=None)
def health() -> dict | JSONResponse:
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except Exception:
        return JSONResponse(status_code=503, content={"status": "unavailable", "service": "inkmind"})
    from app.agent.task_queue import get_task_queue
    from app.services.task_manager import task_manager
    return {
        "status": "ok", "service": "inkmind", "revision": os.getenv("INKMIND_REVISION", "development"),
        "mode": "desktop" if settings.desktop_mode else "web",
        "maintenance": maintenance.enabled(), "active_requests": maintenance.active_requests,
        "active_tasks": get_task_queue().active_count() + task_manager.active_count(),
    }


if settings.desktop_mode and settings.desktop_frontend_dir:
    _desktop_frontend = Path(settings.desktop_frontend_dir).resolve()
    _desktop_index = _desktop_frontend / "index.html"

    @app.get("/{asset_path:path}", include_in_schema=False)
    def desktop_frontend(asset_path: str) -> FileResponse:
        """Serve the built React app and fall back to its client-side router."""
        candidate = (_desktop_frontend / asset_path).resolve()
        if (
            asset_path
            and candidate.is_relative_to(_desktop_frontend)
            and candidate.is_file()
        ):
            return FileResponse(candidate)
        if not _desktop_index.is_file():
            raise RuntimeError(f"Desktop frontend is missing: {_desktop_index}")
        return FileResponse(_desktop_index)
