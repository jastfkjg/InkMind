import logging
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response, StreamingResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import CurrentUser
from app.llm.llm_errors import LLMRequestError
from app.llm.ndjson_stream import ndjson_line
from app.llm.providers import list_available_providers, resolve_llm_for_user
from app.models import Chapter, Novel
from app.schemas.ai import (
    NovelAiChatIn,
    NovelChapterSummaryInspireIn,
    NovelNamingIn,
)
from app.schemas.export import NovelExportPdfIn
from app.schemas.novel import NovelCreate, NovelOut, NovelUpdate
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


@router.get("", response_model=list[NovelOut])
def list_novels(user: CurrentUser, db: Annotated[Session, Depends(get_db)]) -> list[Novel]:
    return db.query(Novel).filter(Novel.user_id == user.id).order_by(Novel.updated_at.desc()).all()


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
):
    novel = _get_owned_novel(db, user.id, novel_id)
    if not list_available_providers():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="未配置任何 LLM API Key",
        )
    system, user_msg = novel_writing_chat_messages(novel, body.message, body.history)

    def gen():
        try:
            llm = resolve_llm_for_user(user, None)
        except ValueError as e:
            yield ndjson_line({"error": str(e)})
            return
        buf: list[str] = []
        try:
            with ai_span("novel.ai_chat.stream_complete", novel_id=novel_id):
                for part in llm.stream_complete(system, user_msg):
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
):
    novel = _get_owned_novel(db, user.id, novel_id)
    if not list_available_providers():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="未配置任何 LLM API Key",
        )
    system, user_msg = novel_naming_messages(novel, body)

    def gen():
        try:
            llm = resolve_llm_for_user(user, None)
        except ValueError as e:
            yield ndjson_line({"error": str(e)})
            return
        buf: list[str] = []
        try:
            with ai_span("novel.ai_naming.stream_complete", novel_id=novel_id):
                for part in llm.stream_complete(system, user_msg):
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
):
    novel = _get_owned_novel(db, user.id, novel_id)
    if not list_available_providers():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="未配置任何 LLM API Key",
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
        previous = chapters[:idx]
    else:
        previous = chapters
    system, user_msg = novel_chapter_summary_inspire_messages(novel, previous)

    def gen():
        try:
            llm = resolve_llm_for_user(user, None)
        except ValueError as e:
            yield ndjson_line({"error": str(e)})
            return
        buf: list[str] = []
        try:
            with ai_span("novel.chapter_summary_inspire.stream_complete", novel_id=novel_id):
                for part in llm.stream_complete(system, user_msg):
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
