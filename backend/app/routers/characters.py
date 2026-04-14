from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import CurrentUser
from app.models import Character
from app.routers.novels import _get_owned_novel
from app.schemas.character import (
    CharacterCreate,
    CharacterOut,
    CharacterUpdate,
)

router = APIRouter(prefix="/novels/{novel_id}", tags=["characters"])


@router.get("/characters", response_model=list[CharacterOut])
def list_characters(
    novel_id: int,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> list[Character]:
    _get_owned_novel(db, user.id, novel_id)
    return db.query(Character).filter(Character.novel_id == novel_id).order_by(Character.id).all()


@router.post("/characters", response_model=CharacterOut, status_code=status.HTTP_201_CREATED)
def create_character(
    novel_id: int,
    body: CharacterCreate,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> Character:
    _get_owned_novel(db, user.id, novel_id)
    c = Character(novel_id=novel_id, name=body.name, profile=body.profile, notes=body.notes)
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


@router.patch("/characters/{character_id}", response_model=CharacterOut)
def update_character(
    novel_id: int,
    character_id: int,
    body: CharacterUpdate,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> Character:
    _get_owned_novel(db, user.id, novel_id)
    c = db.get(Character, character_id)
    if c is None or c.novel_id != novel_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="人物不存在")
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(c, k, v)
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


@router.delete("/characters/{character_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_character(
    novel_id: int,
    character_id: int,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> None:
    _get_owned_novel(db, user.id, novel_id)
    c = db.get(Character, character_id)
    if c is None or c.novel_id != novel_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="人物不存在")
    db.delete(c)
    db.commit()
