from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import CurrentUser
from app.models import NovelMemo
from app.routers.novels import _get_owned_novel
from app.schemas.memo import MemoCreate, MemoOut, MemoUpdate

router = APIRouter(prefix="/novels/{novel_id}", tags=["memos"])


@router.get("/memos", response_model=list[MemoOut])
def list_memos(
    novel_id: int,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> list[NovelMemo]:
    _get_owned_novel(db, user.id, novel_id)
    return (
        db.query(NovelMemo)
        .filter(NovelMemo.novel_id == novel_id)
        .order_by(NovelMemo.id.desc())
        .all()
    )


@router.post("/memos", response_model=MemoOut, status_code=status.HTTP_201_CREATED)
def create_memo(
    novel_id: int,
    body: MemoCreate,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> NovelMemo:
    _get_owned_novel(db, user.id, novel_id)
    m = NovelMemo(novel_id=novel_id, title=body.title.strip(), body=body.body)
    db.add(m)
    db.commit()
    db.refresh(m)
    return m


@router.patch("/memos/{memo_id}", response_model=MemoOut)
def update_memo(
    novel_id: int,
    memo_id: int,
    body: MemoUpdate,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> NovelMemo:
    _get_owned_novel(db, user.id, novel_id)
    m = db.get(NovelMemo, memo_id)
    if m is None or m.novel_id != novel_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="备忘不存在")
    data = body.model_dump(exclude_unset=True)
    if "title" in data and data["title"] is not None:
        data["title"] = data["title"].strip()
    for k, v in data.items():
        setattr(m, k, v)
    db.add(m)
    db.commit()
    db.refresh(m)
    return m


@router.delete("/memos/{memo_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_memo(
    novel_id: int,
    memo_id: int,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> None:
    _get_owned_novel(db, user.id, novel_id)
    m = db.get(NovelMemo, memo_id)
    if m is None or m.novel_id != novel_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="备忘不存在")
    db.delete(m)
    db.commit()
