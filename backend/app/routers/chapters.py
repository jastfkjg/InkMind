from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import CurrentUser
from app.llm.llm_errors import LLMRequestError
from app.llm.ndjson_stream import filter_think_chunks, ndjson_line
from app.llm.providers import list_available_providers, resolve_llm_for_user
from app.models import Chapter, ChapterVersion
from app.routers.novels import _get_owned_novel
from app.schemas.chapter import (
    ChapterBatchGenerateIn,
    ChapterCreate,
    ChapterEvaluateIn,
    ChapterGenerateIn,
    ChapterOut,
    ChapterReviseIn,
    ChapterRollbackIn,
    ChapterSelectionAiIn,
    ChapterSuggestTitleIn,
    ChapterUpdate,
    ChapterVersionDiffOut,
    ChapterVersionOut,
)
from app.services.chapter_eval import parse_evaluation_json, stream_evaluate_tokens
from app.observability.otel_ai import ai_span
from app.services.chapter_gen import (
    build_generation_prompt,
    parse_chapter_generation_json,
    plan_batch_chapters,
    run_react_chapter_generation,
)
from app.services.chapter_llm import (
    ensure_unique_chapter_title,
    finalize_suggested_title,
    list_existing_chapter_titles,
    messages_append_chapter_body,
    messages_revise_chapter_body,
    messages_selection_ai,
    messages_suggest_chapter_title,
)
from app.services.chapter_version import (
    compare_versions,
    compare_version_with_current,
    create_chapter_version,
    get_chapter_version,
    get_chapter_versions,
    rollback_to_version,
    save_version_before_change,
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
    fixed_title = req_title if body.lock_title and req_title else None

    def gen():
        try:
            llm = resolve_llm_for_user(user, None, db=db, action="AI生成")
        except ValueError as e:
            yield ndjson_line({"error": str(e)})
            return
        
        if target is not None and target.content:
            save_version_before_change(db, target, "ai_generate")

        try:
            with ai_span("chapter.generate.react_agent", novel_id=novel_id):
                result = run_react_chapter_generation(
                    db, novel, body.summary.strip(), target,
                    llm, fixed_title=fixed_title
                )
            # 迭代生成器：前部分是文本 chunks，最后是 Chapter 对象
            ch = None
            for item in result:
                if isinstance(item, Chapter):
                    ch = item
                else:
                    # 文本 chunk，直接转发
                    if item:
                        yield ndjson_line({"t": item})
            # 最后返回章节元数据
            if ch is not None:
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


@router.post("/generate-batch")
def generate_chapter_batch(
    novel_id: int,
    body: ChapterBatchGenerateIn,
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

    anchor: Chapter | None = None
    ordered = (
        db.query(Chapter)
        .filter(Chapter.novel_id == novel_id)
        .order_by(Chapter.sort_order, Chapter.id)
        .all()
    )
    if body.after_chapter_id is not None:
        anchor = next((c for c in ordered if c.id == body.after_chapter_id), None)
        if anchor is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="章节不存在")
        latest = ordered[-1] if ordered else None
        if latest is not None and anchor.id != latest.id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="批量生成仅支持从最新章节开始")

    def gen():
        try:
            llm = resolve_llm_for_user(user, None, db=db, action="AI批量生成")
        except ValueError as e:
            yield ndjson_line({"error": str(e)})
            return

        generated: list[Chapter] = []
        try:
            yield ndjson_line({"t": f"正在规划接下来 {body.chapter_count} 章...\n"})
            start_from_current = anchor is not None and not (anchor.content or "").strip()
            plan_anchor = None if start_from_current else anchor
            with ai_span("chapter.generate_batch.plan", novel_id=novel_id):
                plan = plan_batch_chapters(
                    db,
                    novel,
                    llm,
                    total_summary=body.total_summary.strip(),
                    chapter_count=body.chapter_count,
                    after_chapter=plan_anchor,
                )

            insert_order = (anchor.sort_order + (0 if start_from_current else 1)) if anchor is not None else (
                (ordered[-1].sort_order + 1) if ordered else 0
            )
            shift_count = body.chapter_count - 1 if start_from_current else body.chapter_count
            if shift_count > 0 and anchor is not None:
                for later in ordered:
                    if later.id == anchor.id:
                        continue
                    if later.sort_order >= insert_order + (1 if start_from_current else 0):
                        later.sort_order += shift_count
                        db.add(later)
                db.commit()

            for idx, item in enumerate(plan, start=1):
                yield ndjson_line({"t": f"[{idx}/{body.chapter_count}] 正在生成《{item['title']}》...\n"})
                target_chapter = anchor if start_from_current and idx == 1 else None
                sort_order = None if target_chapter is not None else insert_order + idx - (1 if start_from_current else 0)
                result = run_react_chapter_generation(
                    db,
                    novel,
                    item["summary"],
                    target_chapter,
                    llm,
                    fixed_title=item["title"],
                    new_sort_order=sort_order,
                )
                created: Chapter | None = None
                for piece in result:
                    if isinstance(piece, Chapter):
                        created = piece
                if created is not None:
                    generated.append(created)
                    yield ndjson_line({"t": f"[{idx}/{body.chapter_count}] 已完成《{created.title}》\n"})

            yield ndjson_line(
                {"chapters": [ChapterOut.model_validate(ch).model_dump(mode="json") for ch in generated]}
            )
        except ValueError as e:
            yield ndjson_line({"error": str(e)})
        except LLMRequestError as e:
            yield ndjson_line({"error": e.message})
        except Exception as e:
            yield ndjson_line({"error": str(e) or "批量生成失败"})

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

    existing_titles = list_existing_chapter_titles(db, novel_id, exclude_chapter_id=chapter_id)
    system, user_msg = messages_suggest_chapter_title(
        novel,
        ch,
        body.hint or "",
        existing_titles=existing_titles,
    )

    def gen():
        try:
            llm = resolve_llm_for_user(user, None, db=db, action="AI标题")
        except ValueError as e:
            yield ndjson_line({"error": str(e)})
            return
        buf: list[str] = []
        try:
            with ai_span("chapter.suggest_title.stream_complete", novel_id=novel_id, chapter_id=chapter_id):
                for part in filter_think_chunks(llm.stream_complete(system, user_msg)):
                    buf.append(part)
                    yield ndjson_line({"t": part})
        except LLMRequestError as e:
            yield ndjson_line({"error": e.message})
            return
        except Exception as e:
            yield ndjson_line({"error": str(e) or "请求失败"})
            return
        raw = "".join(buf).strip()
        title = ensure_unique_chapter_title(finalize_suggested_title(raw), existing_titles)
        yield ndjson_line({"title": title})

    return StreamingResponse(
        gen(),
        media_type="application/x-ndjson",
        headers=_STREAM_HEADERS,
    )


@router.post("/{chapter_id}/ai-evaluate")
def ai_evaluate_chapter(
    novel_id: int,
    chapter_id: int,
    body: ChapterEvaluateIn,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
):
    """根据当前章节（可选用编辑器未保存内容）给出弱点与去 AI 化分数。"""
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

    title_eff = ch.title if body.title is None else body.title
    summary_eff = ch.summary if body.summary is None else body.summary
    content_eff = ch.content if body.content is None else body.content
    if not (content_eff or "").strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="正文为空，无法评估；请先撰写正文或保存后再试",
        )

    try:
        llm = resolve_llm_for_user(user, body.llm_provider, db=db, action="AI评估")
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e

    def gen():
        buf: list[str] = []
        try:
            with ai_span("chapter.ai_evaluate.stream", novel_id=novel_id, chapter_id=chapter_id):
                for part in filter_think_chunks(stream_evaluate_tokens(
                    llm,
                    novel,
                    title=title_eff or "",
                    summary=summary_eff or "",
                    content=content_eff or "",
                )):
                    buf.append(part)
                    yield ndjson_line({"t": part})
            raw = "".join(buf)
            with ai_span("chapter.ai_evaluate.parse", novel_id=novel_id, chapter_id=chapter_id):
                out = parse_evaluation_json(raw)
            yield ndjson_line({"evaluate": out.model_dump(mode="json")})
        except ValueError as e:
            yield ndjson_line({"error": str(e)})
        except LLMRequestError as e:
            yield ndjson_line({"error": e.message})
        except Exception as e:
            yield ndjson_line({"error": str(e) or "评估失败"})

    return StreamingResponse(
        gen(),
        media_type="application/x-ndjson",
        headers=_STREAM_HEADERS,
    )


def _verify_unique_selection(chapter_content: str, selected_text: str) -> None:
    if selected_text not in chapter_content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="选区与当前正文不一致，请重试或重新选中",
        )
    if chapter_content.count(selected_text) > 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="选中片段在正文中出现多次，请扩大选区或改选唯一片段",
        )


@router.post("/{chapter_id}/selection-ai")
def selection_ai(
    novel_id: int,
    chapter_id: int,
    body: ChapterSelectionAiIn,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
):
    """正文选区：扩写或润色（NDJSON 流 + 最终 text）。"""
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
    if not (body.chapter_content or "").strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="章节正文为空")
    _verify_unique_selection(body.chapter_content, body.selected_text)

    change_type = "selection_expand" if body.mode == "expand" else "selection_polish"

    def gen():
        try:
            llm = resolve_llm_for_user(user, body.llm_provider, db=db, action=("AI扩写" if body.mode == "expand" else "AI润色"))
        except ValueError as e:
            yield ndjson_line({"error": str(e)})
            return
        
        if ch.content:
            save_version_before_change(db, ch, change_type)
        
        sys_m, usr_m = messages_selection_ai(
            novel,
            ch,
            chapter_content_full=body.chapter_content,
            selected_text=body.selected_text,
            mode=body.mode,
        )
        buf: list[str] = []
        try:
            with ai_span(
                "chapter.selection_ai.stream",
                novel_id=novel_id,
                chapter_id=chapter_id,
                mode=body.mode,
            ):
                for part in filter_think_chunks(llm.stream_complete(sys_m, usr_m)):
                    buf.append(part)
                    yield ndjson_line({"t": part})
            raw = "".join(buf).strip()
            yield ndjson_line({"text": raw})
        except LLMRequestError as e:
            yield ndjson_line({"error": e.message})
        except Exception as e:
            yield ndjson_line({"error": str(e) or "请求失败"})

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
    change_type = "ai_append" if mode_eff == "append" else "ai_rewrite"

    def gen():
        try:
            llm = resolve_llm_for_user(user, body.llm_provider, db=db, action=("AI续写" if mode_eff == "append" else "AI改写"))
        except ValueError as e:
            yield ndjson_line({"error": str(e)})
            return
        
        save_version_before_change(db, ch, change_type)
        
        try:
            if mode_eff == "append":
                sys_a, usr_a = messages_append_chapter_body(novel, ch, body.instruction)
                buf: list[str] = []
                with ai_span("chapter.revise.append_stream_complete", novel_id=novel_id, chapter_id=chapter_id):
                    for part in filter_think_chunks(llm.stream_complete(sys_a, usr_a)):
                        buf.append(part)
                        yield ndjson_line({"t": part})
                addition = "".join(buf).strip()
                existing = (ch.content or "").strip()
                new_content = addition if not existing else existing.rstrip() + "\n\n" + addition
            else:
                sys_r, usr_r = messages_revise_chapter_body(novel, ch, body.instruction)
                buf2: list[str] = []
                with ai_span("chapter.revise.rewrite_stream_complete", novel_id=novel_id, chapter_id=chapter_id):
                    for part in filter_think_chunks(llm.stream_complete(sys_r, usr_r)):
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
    
    has_changes = False
    for k, v in data.items():
        if getattr(ch, k) != v:
            has_changes = True
            break
    
    if has_changes:
        save_version_before_change(db, ch, "manual")
    
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


@router.get("/{chapter_id}/versions", response_model=list[ChapterVersionOut])
def list_chapter_versions(
    novel_id: int,
    chapter_id: int,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
    limit: int = Query(default=50, ge=1, le=200),
) -> list[ChapterVersion]:
    _get_owned_novel(db, user.id, novel_id)
    ch = db.get(Chapter, chapter_id)
    if ch is None or ch.novel_id != novel_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="章节不存在")
    return get_chapter_versions(db, chapter_id, limit=limit)


@router.get("/{chapter_id}/versions/{version_id}", response_model=ChapterVersionOut)
def get_chapter_version_detail(
    novel_id: int,
    chapter_id: int,
    version_id: int,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> ChapterVersion:
    _get_owned_novel(db, user.id, novel_id)
    ch = db.get(Chapter, chapter_id)
    if ch is None or ch.novel_id != novel_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="章节不存在")
    
    version = get_chapter_version(db, chapter_id, version_id)
    if version is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="版本不存在")
    return version


@router.get("/{chapter_id}/versions/compare", response_model=ChapterVersionDiffOut)
def compare_two_versions(
    novel_id: int,
    chapter_id: int,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
    version_id_1: int = Query(..., description="第一个版本ID"),
    version_id_2: int = Query(..., description="第二个版本ID"),
) -> ChapterVersionDiffOut:
    _get_owned_novel(db, user.id, novel_id)
    ch = db.get(Chapter, chapter_id)
    if ch is None or ch.novel_id != novel_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="章节不存在")
    
    result = compare_versions(db, chapter_id, version_id_1, version_id_2)
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="版本不存在")
    return ChapterVersionDiffOut(**result)


@router.get("/{chapter_id}/versions/{version_id}/compare-current", response_model=ChapterVersionDiffOut)
def compare_version_with_current_chapter(
    novel_id: int,
    chapter_id: int,
    version_id: int,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> ChapterVersionDiffOut:
    _get_owned_novel(db, user.id, novel_id)
    ch = db.get(Chapter, chapter_id)
    if ch is None or ch.novel_id != novel_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="章节不存在")
    
    result = compare_version_with_current(db, ch, version_id)
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="版本不存在")
    return ChapterVersionDiffOut(**result)


@router.post("/{chapter_id}/rollback", response_model=ChapterOut)
def rollback_chapter_to_version(
    novel_id: int,
    chapter_id: int,
    body: ChapterRollbackIn,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> Chapter:
    _get_owned_novel(db, user.id, novel_id)
    ch = db.get(Chapter, chapter_id)
    if ch is None or ch.novel_id != novel_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="章节不存在")
    
    updated_ch = rollback_to_version(
        db, ch, body.version_id, save_current=body.save_current
    )
    if updated_ch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="版本不存在")
    return updated_ch
