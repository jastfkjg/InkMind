import logging

from app.database import SessionLocal
from app.llm.providers import list_available_providers, resolve_llm_for_user
from app.models import Chapter, User
from app.services.chapter_llm import summarize_chapter_body

logger = logging.getLogger(__name__)


def regenerate_chapter_summary_task(chapter_id: int, novel_id: int, user_id: int) -> None:
    """后台根据正文重写摘要；失败仅打日志，不抛到请求。"""
    db = SessionLocal()
    try:
        user = db.get(User, user_id)
        chapter = db.get(Chapter, chapter_id)
        if not user or not chapter or chapter.novel_id != novel_id:
            return
        if not list_available_providers():
            return
        try:
            llm = resolve_llm_for_user(user, None)
            chapter.summary = summarize_chapter_body(llm, chapter.title, chapter.content or "")
        except Exception:
            logger.exception("regenerate chapter summary failed chapter_id=%s", chapter_id)
            return
        db.add(chapter)
        db.commit()
    finally:
        db.close()
