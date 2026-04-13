from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import CurrentUser
from app.llm.llm_errors import LLMRequestError
from app.llm.providers import get_llm, list_available_providers
from app.models import Chapter
from app.routers.novels import _get_owned_novel
from app.schemas.chapter import ChapterCreate, ChapterGenerateIn, ChapterOut, ChapterUpdate
from app.services.chapter_gen import build_generation_prompt

router = APIRouter(prefix="/novels/{novel_id}/chapters", tags=["chapters"])


@router.post("/generate", response_model=ChapterOut)
def generate_chapter(
    novel_id: int,
    body: ChapterGenerateIn,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> Chapter:
    novel = _get_owned_novel(db, user.id, novel_id)
    available = list_available_providers()
    provider = (body.llm_provider or "").lower().strip() or None
    if provider and provider not in available:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"该模型未配置或不可用。当前可用: {', '.join(available) or '无'}",
        )
    if not available:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="未配置任何 LLM API Key，请在环境变量中设置 OPENAI_API_KEY 或 ANTHROPIC_API_KEY",
        )

    target: Chapter | None = None
    if body.chapter_id is not None:
        target = db.get(Chapter, body.chapter_id)
        if target is None or target.novel_id != novel_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="章节不存在")

    system, user_msg = build_generation_prompt(db, novel, body.summary.strip(), target)
    try:
        llm = get_llm(provider)
        text = llm.complete(system, user_msg)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    except LLMRequestError as e:
        status_map = {
            400: status.HTTP_400_BAD_REQUEST,
            401: status.HTTP_502_BAD_GATEWAY,
            403: status.HTTP_502_BAD_GATEWAY,
            404: status.HTTP_502_BAD_GATEWAY,
            408: status.HTTP_504_GATEWAY_TIMEOUT,
            429: status.HTTP_503_SERVICE_UNAVAILABLE,
            500: status.HTTP_502_BAD_GATEWAY,
            502: status.HTTP_502_BAD_GATEWAY,
            503: status.HTTP_503_SERVICE_UNAVAILABLE,
        }
        http_status = status_map.get(e.upstream_status or 0, status.HTTP_502_BAD_GATEWAY)
        raise HTTPException(status_code=http_status, detail=f"模型接口错误: {e.message}") from e

    if target is None:
        max_order = db.scalar(
            select(func.max(Chapter.sort_order)).where(Chapter.novel_id == novel_id)
        )
        next_order = (max_order or 0) + 1
        ch = Chapter(
            novel_id=novel_id,
            title="",
            summary=body.summary.strip(),
            content=text,
            sort_order=next_order,
        )
        db.add(ch)
    else:
        target.summary = body.summary.strip()
        target.content = text
        ch = target
        db.add(ch)

    db.commit()
    db.refresh(ch)
    return ch


@router.get("", response_model=list[ChapterOut])
def list_chapters(
    novel_id: int,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> list[Chapter]:
    _get_owned_novel(db, user.id, novel_id)
    return (
        db.query(Chapter)
        .filter(Chapter.novel_id == novel_id)
        .order_by(Chapter.sort_order, Chapter.id)
        .all()
    )


@router.post("", response_model=ChapterOut, status_code=status.HTTP_201_CREATED)
def create_chapter(
    novel_id: int,
    body: ChapterCreate,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> Chapter:
    _get_owned_novel(db, user.id, novel_id)
    ch = Chapter(
        novel_id=novel_id,
        title=body.title,
        summary=body.summary,
        content=body.content,
        sort_order=body.sort_order,
    )
    db.add(ch)
    db.commit()
    db.refresh(ch)
    return ch


@router.get("/{chapter_id}", response_model=ChapterOut)
def get_chapter(
    novel_id: int,
    chapter_id: int,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> Chapter:
    _get_owned_novel(db, user.id, novel_id)
    ch = db.get(Chapter, chapter_id)
    if ch is None or ch.novel_id != novel_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="章节不存在")
    return ch


@router.patch("/{chapter_id}", response_model=ChapterOut)
def update_chapter(
    novel_id: int,
    chapter_id: int,
    body: ChapterUpdate,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> Chapter:
    _get_owned_novel(db, user.id, novel_id)
    ch = db.get(Chapter, chapter_id)
    if ch is None or ch.novel_id != novel_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="章节不存在")
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(ch, k, v)
    db.add(ch)
    db.commit()
    db.refresh(ch)
    return ch


@router.delete("/{chapter_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_chapter(
    novel_id: int,
    chapter_id: int,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> None:
    _get_owned_novel(db, user.id, novel_id)
    ch = db.get(Chapter, chapter_id)
    if ch is None or ch.novel_id != novel_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="章节不存在")
    db.delete(ch)
    db.commit()
