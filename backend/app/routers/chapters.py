from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import CurrentUser
from app.llm.llm_errors import LLMRequestError
from app.llm.ndjson_stream import ndjson_line
from app.llm.providers import list_available_providers, resolve_llm_for_user
from app.models import Chapter
from app.routers.novels import _get_owned_novel
from app.schemas.chapter import (
    ChapterCreate,
    ChapterGenerateIn,
    ChapterOut,
    ChapterReviseIn,
    ChapterSuggestTitleIn,
    ChapterUpdate,
)
from app.services.chapter_gen import build_generation_prompt, parse_chapter_generation_json
from app.services.chapter_llm import (
    finalize_suggested_title,
    messages_append_chapter_body,
    messages_revise_chapter_body,
    messages_suggest_chapter_title,
)

router = APIRouter(prefix="/novels/{novel_id}/chapters", tags=["chapters"])


def _llm_http_exc(e: LLMRequestError) -> HTTPException:
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
    return HTTPException(status_code=http_status, detail=f"模型接口错误: {e.message}")


_STREAM_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


@router.post("/generate")
def generate_chapter(
    novel_id: int,
    body: ChapterGenerateIn,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
):
    novel = _get_owned_novel(db, user.id, novel_id)
    available = list_available_providers()
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

    req_title = (body.title or "").strip()
    fixed_title = req_title or None
    need_model_title = fixed_title is None

    system, user_msg = build_generation_prompt(
        db, novel, body.summary.strip(), target, fixed_title=fixed_title
    )

    def gen():
        try:
            llm = resolve_llm_for_user(user, None)
        except ValueError as e:
            yield ndjson_line({"error": str(e)})
            return
        buf: list[str] = []
        try:
            for part in llm.stream_complete(system, user_msg):
                buf.append(part)
                yield ndjson_line({"t": part})

            raw = "".join(buf)
            gen_title, body_text = parse_chapter_generation_json(raw, need_title=need_model_title)

            if target is None:
                max_order = db.scalar(
                    select(func.max(Chapter.sort_order)).where(Chapter.novel_id == novel_id)
                )
                next_order = (max_order or 0) + 1
                title_out = fixed_title if fixed_title is not None else gen_title
                ch = Chapter(
                    novel_id=novel_id,
                    title=title_out,
                    summary=body.summary.strip(),
                    content=body_text,
                    sort_order=next_order,
                )
                db.add(ch)
            else:
                target.summary = body.summary.strip()
                target.content = body_text
                if fixed_title is not None:
                    target.title = fixed_title
                else:
                    if gen_title:
                        target.title = gen_title
                ch = target
                db.add(ch)

            db.commit()
            db.refresh(ch)
            yield ndjson_line({"chapter": ChapterOut.model_validate(ch).model_dump(mode="json")})
        except LLMRequestError as e:
            yield ndjson_line({"error": e.message})
        except Exception as e:
            db.rollback()
            yield ndjson_line({"error": str(e) or "生成失败"})

    return StreamingResponse(
        gen(),
        media_type="application/x-ndjson",
        headers=_STREAM_HEADERS,
    )


@router.post("/{chapter_id}/suggest-title")
def suggest_title_for_chapter(
    novel_id: int,
    chapter_id: int,
    body: ChapterSuggestTitleIn,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
):
    novel = _get_owned_novel(db, user.id, novel_id)
    if not list_available_providers():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="未配置任何 LLM API Key",
        )
    ch = db.get(Chapter, chapter_id)
    if ch is None or ch.novel_id != novel_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="章节不存在")

    system, user_msg = messages_suggest_chapter_title(novel, ch, body.hint or "")

    def gen():
        try:
            llm = resolve_llm_for_user(user, None)
        except ValueError as e:
            yield ndjson_line({"error": str(e)})
            return
        buf: list[str] = []
        try:
            for part in llm.stream_complete(system, user_msg):
                buf.append(part)
                yield ndjson_line({"t": part})
        except LLMRequestError as e:
            yield ndjson_line({"error": e.message})
            return
        except Exception as e:
            yield ndjson_line({"error": str(e) or "请求失败"})
            return
        raw = "".join(buf).strip()
        yield ndjson_line({"title": finalize_suggested_title(raw)})

    return StreamingResponse(
        gen(),
        media_type="application/x-ndjson",
        headers=_STREAM_HEADERS,
    )


@router.post("/{chapter_id}/revise")
def revise_chapter(
    novel_id: int,
    chapter_id: int,
    body: ChapterReviseIn,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
):
    novel = _get_owned_novel(db, user.id, novel_id)
    available = list_available_providers()
    prov = (body.llm_provider or "").lower().strip() or None
    if prov and prov not in available:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"该模型未配置或不可用。当前可用: {', '.join(available) or '无'}",
        )
    if not available:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="未配置任何 LLM API Key",
        )
    ch = db.get(Chapter, chapter_id)
    if ch is None or ch.novel_id != novel_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="章节不存在")

    mode = body.mode or "rewrite"
    if mode == "rewrite" and not (ch.content or "").strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="整体修改需要已有正文；正文为空请使用「增加」模式或先生成正文",
        )

    mode_eff = mode

    def gen():
        try:
            llm = resolve_llm_for_user(user, body.llm_provider)
        except ValueError as e:
            yield ndjson_line({"error": str(e)})
            return
        try:
            if mode_eff == "append":
                sys_a, usr_a = messages_append_chapter_body(novel, ch, body.instruction)
                buf: list[str] = []
                for part in llm.stream_complete(sys_a, usr_a):
                    buf.append(part)
                    yield ndjson_line({"t": part})
                addition = "".join(buf).strip()
                existing = (ch.content or "").strip()
                new_content = addition if not existing else existing.rstrip() + "\n\n" + addition
            else:
                sys_r, usr_r = messages_revise_chapter_body(novel, ch, body.instruction)
                buf2: list[str] = []
                for part in llm.stream_complete(sys_r, usr_r):
                    buf2.append(part)
                    yield ndjson_line({"t": part})
                new_content = "".join(buf2).strip()

            ch.content = new_content
            db.add(ch)
            db.commit()
            db.refresh(ch)
            yield ndjson_line({"chapter": ChapterOut.model_validate(ch).model_dump(mode="json")})
        except LLMRequestError as e:
            db.rollback()
            yield ndjson_line({"error": e.message})
        except Exception as e:
            db.rollback()
            yield ndjson_line({"error": str(e) or "修改失败"})

    return StreamingResponse(
        gen(),
        media_type="application/x-ndjson",
        headers=_STREAM_HEADERS,
    )


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
