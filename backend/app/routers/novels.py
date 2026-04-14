from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import CurrentUser
from app.llm.llm_errors import LLMRequestError
from app.llm.providers import list_available_providers, resolve_llm_for_user
from app.models import Novel
from app.schemas.ai import NovelAiChatIn, NovelAiChatOut, NovelNamingIn, NovelNamingOut
from app.schemas.novel import NovelCreate, NovelOut, NovelUpdate
from app.services.novel_ai import novel_naming_suggest, novel_writing_chat

router = APIRouter(prefix="/novels", tags=["novels"])


def _novel_ai_llm_http_exc(e: LLMRequestError) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=f"模型接口错误: {e.message}",
    )


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


@router.post("/{novel_id}/ai-chat", response_model=NovelAiChatOut)
def novel_ai_chat(
    novel_id: int,
    body: NovelAiChatIn,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> NovelAiChatOut:
    novel = _get_owned_novel(db, user.id, novel_id)
    if not list_available_providers():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="未配置任何 LLM API Key",
        )
    try:
        llm = resolve_llm_for_user(user, None)
        reply = novel_writing_chat(llm, novel, body.message, body.history)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    except LLMRequestError as e:
        raise _novel_ai_llm_http_exc(e) from e
    return NovelAiChatOut(reply=reply)


@router.post("/{novel_id}/ai-naming", response_model=NovelNamingOut)
def novel_ai_naming(
    novel_id: int,
    body: NovelNamingIn,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> NovelNamingOut:
    novel = _get_owned_novel(db, user.id, novel_id)
    if not list_available_providers():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="未配置任何 LLM API Key",
        )
    try:
        llm = resolve_llm_for_user(user, None)
        text = novel_naming_suggest(llm, novel, body)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    except LLMRequestError as e:
        raise _novel_ai_llm_http_exc(e) from e
    return NovelNamingOut(text=text)


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
