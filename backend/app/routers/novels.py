import logging
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import func, update
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import CurrentUser
from app.language import Language
from app.llm.llm_errors import LLMRequestError
from app.llm.ndjson_stream import filter_think_chunks, ndjson_line
from app.llm.providers import has_generation_configuration, resolve_llm_for_user
from app.models import Chapter, Character, Novel
from app.schemas.ai import (
    NovelAiChatIn,
    NovelChapterSummaryInspireIn,
    NovelNamingIn,
)
from app.schemas.export import NovelExportPdfIn
from app.schemas.novel import NovelCreate, NovelListResponse, NovelOut, NovelUpdate
from app.services.novel_export_pdf import build_novel_pdf_bytes, safe_export_pdf_stem
from app.observability.otel_ai import ai_span
from app.services.novel_ai import (
    novel_chapter_summary_inspire_messages,
    novel_naming_messages,
    novel_writing_chat_messages,
)

router = APIRouter(prefix="/novels", tags=["novels"])

log = logging.getLogger(__name__)

_STREAM_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


@router.get("", response_model=list[NovelListResponse])
def list_novels(user: CurrentUser, db: Annotated[Session, Depends(get_db)]) -> list[NovelListResponse]:
    # Count non-whitespace characters, matching the editor. Keep chapter bodies in
    # SQLite instead of transferring every manuscript to the library page.
    body = func.coalesce(Chapter.content, "")
    for whitespace in " \t\n\r\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff":
        body = func.replace(body, whitespace, "")
    stats = (
        db.query(Chapter.novel_id, func.count(Chapter.id).label("chapter_count"),
                 func.sum(func.length(body)).label("total_words"))
        .join(Novel, Novel.id == Chapter.novel_id).filter(Novel.user_id == user.id)
        .group_by(Chapter.novel_id).subquery()
    )
    recent = (
        db.query(Chapter.novel_id, Chapter.id, Chapter.title, Chapter.updated_at,
                 func.row_number().over(partition_by=Chapter.novel_id,
                    order_by=(Chapter.updated_at.desc(), Chapter.id.desc())).label("rank"))
        .join(Novel, Novel.id == Chapter.novel_id).filter(Novel.user_id == user.id).subquery()
    )
    rows = (db.query(Novel, stats.c.chapter_count, stats.c.total_words,
                     recent.c.id, recent.c.title, recent.c.updated_at)
            .outerjoin(stats, stats.c.novel_id == Novel.id)
            .outerjoin(recent, (recent.c.novel_id == Novel.id) & (recent.c.rank == 1))
            .filter(Novel.user_id == user.id).all())
    result = []
    for novel, count, words, chapter_id, chapter_title, edited_at in rows:
        result.append(NovelListResponse(
            **NovelOut.model_validate(novel).model_dump(), chapter_count=count or 0,
            total_words=words or 0, last_chapter_id=chapter_id, last_chapter_title=chapter_title,
            last_edited_at=max(novel.updated_at, edited_at) if edited_at else novel.updated_at,
        ))
    return sorted(result, key=lambda item: (item.is_pinned, item.last_edited_at, item.id), reverse=True)


@router.post("", response_model=NovelOut, status_code=status.HTTP_201_CREATED)
def create_novel(
    body: NovelCreate,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> Novel:
    n = Novel(
        user_id=user.id,
        title=body.title,
        background=body.background,
        genre=body.genre,
        writing_style=body.writing_style,
    )
    db.add(n)
    if body.create_first_chapter:
        db.flush()
        db.add(Chapter(novel_id=n.id, title="", summary="", content="", sort_order=0))
    db.commit()
    db.refresh(n)
    return n


def _get_owned_novel(db: Session, user_id: int, novel_id: int) -> Novel:
    n = db.get(Novel, novel_id)
    if n is None or n.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="作品不存在")
    return n


@router.post("/{novel_id}/ai-chat")
def novel_ai_chat(
    novel_id: int,
    body: NovelAiChatIn,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
    language: Language,
):
    novel = _get_owned_novel(db, user.id, novel_id)
    if not has_generation_configuration(user, db):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="请在 AI 设置中配置并选择可用的正文生成模型",
        )
    chapters = db.query(Chapter).filter(Chapter.novel_id == novel_id).order_by(Chapter.sort_order).all()
    characters = db.query(Character).filter(Character.novel_id == novel_id).order_by(Character.id).all()
    system, user_msg = novel_writing_chat_messages(novel, body.message, body.history, language=language, chapters=chapters, characters=characters, db=db)

    def gen():
        try:
            llm = resolve_llm_for_user(user, None, db=db, action="AI提问")
        except ValueError as e:
            yield ndjson_line({"error": str(e)})
            return
        buf: list[str] = []
        try:
            with ai_span("novel.ai_chat.stream_complete", novel_id=novel_id):
                for part in filter_think_chunks(llm.stream_complete(system, user_msg)):
                    buf.append(part)
                    yield ndjson_line({"t": part})
            yield ndjson_line({"reply": "".join(buf).strip()})
        except LLMRequestError as e:
            yield ndjson_line({"error": e.message})
        except Exception as e:
            yield ndjson_line({"error": str(e) or "请求失败"})

    return StreamingResponse(gen(), media_type="application/x-ndjson", headers=_STREAM_HEADERS)


@router.post("/{novel_id}/ai-naming")
def novel_ai_naming(
    novel_id: int,
    body: NovelNamingIn,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
    language: Language,
):
    novel = _get_owned_novel(db, user.id, novel_id)
    if not has_generation_configuration(user, db):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="请在 AI 设置中配置并选择可用的正文生成模型",
        )
    system, user_msg = novel_naming_messages(novel, body, language=language)

    def gen():
        try:
            llm = resolve_llm_for_user(user, None, db=db, action="AI起名")
        except ValueError as e:
            yield ndjson_line({"error": str(e)})
            return
        buf: list[str] = []
        try:
            with ai_span("novel.ai_naming.stream_complete", novel_id=novel_id):
                for part in filter_think_chunks(llm.stream_complete(system, user_msg)):
                    buf.append(part)
                    yield ndjson_line({"t": part})
            yield ndjson_line({"text": "".join(buf).strip()})
        except LLMRequestError as e:
            yield ndjson_line({"error": e.message})
        except Exception as e:
            yield ndjson_line({"error": str(e) or "请求失败"})

    return StreamingResponse(gen(), media_type="application/x-ndjson", headers=_STREAM_HEADERS)


@router.post("/{novel_id}/ai-chapter-summary-inspire")
def novel_ai_chapter_summary_inspire_ep(
    novel_id: int,
    body: NovelChapterSummaryInspireIn,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
    language: Language,
):
    novel = _get_owned_novel(db, user.id, novel_id)
    if not has_generation_configuration(user, db):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="请在 AI 设置中配置并选择可用的正文生成模型",
        )
    chapters = (
        db.query(Chapter)
        .filter(Chapter.novel_id == novel_id)
        .order_by(Chapter.sort_order, Chapter.id)
        .all()
    )
    previous: list[Chapter]
    if body.chapter_id is not None:
        idx = next((i for i, c in enumerate(chapters) if c.id == body.chapter_id), None)
        if idx is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="章节不存在")
        current = chapters[idx]
        include_current = body.chapter_count > 1 and bool((current.content or "").strip())
        previous = chapters[: idx + 1] if include_current else chapters[:idx]
    else:
        previous = chapters
    system, user_msg = novel_chapter_summary_inspire_messages(
        novel,
        previous,
        chapter_count=body.chapter_count,
        language=language,
    )

    def gen():
        try:
            llm = resolve_llm_for_user(user, None, db=db, action="AI概要灵感")
        except ValueError as e:
            yield ndjson_line({"error": str(e)})
            return
        buf: list[str] = []
        try:
            with ai_span("novel.chapter_summary_inspire.stream_complete", novel_id=novel_id):
                for part in filter_think_chunks(llm.stream_complete(system, user_msg)):
                    buf.append(part)
                    yield ndjson_line({"t": part})
            yield ndjson_line({"summary": "".join(buf).strip()})
        except LLMRequestError as e:
            yield ndjson_line({"error": e.message})
        except Exception as e:
            yield ndjson_line({"error": str(e) or "请求失败"})

    return StreamingResponse(gen(), media_type="application/x-ndjson", headers=_STREAM_HEADERS)


@router.post("/{novel_id}/export/pdf")
def export_novel_pdf(
    novel_id: int,
    body: NovelExportPdfIn,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    """服务端将正文写成 PDF：优先本机或 fpdf2 自带字体，否则用核心字体（中文可能显示为 ?）。"""
    novel = _get_owned_novel(db, user.id, novel_id)
    rows = (
        db.query(Chapter)
        .filter(Chapter.novel_id == novel_id)
        .order_by(Chapter.sort_order, Chapter.id)
        .all()
    )
    want = body.chapter_ids
    if want:
        allow = {c.id for c in rows}
        missing = [i for i in want if i not in allow]
        if missing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"无效的章节 id: {missing}",
            )
        id_set = set(want)
        chapters = [c for c in rows if c.id in id_set]
    else:
        chapters = list(rows)
    try:
        raw = build_novel_pdf_bytes(novel, chapters)
    except Exception as e:
        log.exception("novel pdf export failed novel_id=%s", novel_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"PDF 生成失败：{e!s}",
        ) from e
    stem = safe_export_pdf_stem(novel.title)
    fname = f"{stem}.pdf"
    ascii_name = fname.encode("ascii", "replace").decode()
    cd = f'attachment; filename="{ascii_name}"; filename*=UTF-8\'\'{quote(fname)}'
    return Response(content=raw, media_type="application/pdf", headers={"Content-Disposition": cd})


@router.get("/{novel_id}", response_model=NovelOut)
def get_novel(
    novel_id: int,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> Novel:
    return _get_owned_novel(db, user.id, novel_id)


@router.patch("/{novel_id}", response_model=NovelOut)
def update_novel(
    novel_id: int,
    body: NovelUpdate,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> Novel:
    n = _get_owned_novel(db, user.id, novel_id)
    data = body.model_dump(exclude_unset=True)
    if data and not (data.keys() - {"is_pinned", "is_archived"}):
        # Library organization must not make an older manuscript look recently edited.
        db.execute(update(Novel).where(Novel.id == n.id).values(**data, updated_at=n.updated_at))
    else:
        for k, v in data.items():
            setattr(n, k, v)
    db.add(n)
    db.commit()
    db.refresh(n)
    return n


@router.delete("/{novel_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_novel(
    novel_id: int,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> None:
    n = _get_owned_novel(db, user.id, novel_id)
    db.delete(n)
    db.commit()
