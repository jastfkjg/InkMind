from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import CurrentUser
from app.models import Novel
from app.schemas.novel import NovelCreate, NovelOut, NovelUpdate

router = APIRouter(prefix="/novels", tags=["novels"])


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
        outline=body.outline,
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
