from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import CurrentUser
from app.models import Character, CharacterRelationship
from app.routers.novels import _get_owned_novel
from app.schemas.character import (
    CharacterCreate,
    CharacterOut,
    CharacterUpdate,
    RelationshipCreate,
    RelationshipOut,
    RelationshipUpdate,
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


@router.get("/relationships", response_model=list[RelationshipOut])
def list_relationships(
    novel_id: int,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> list[CharacterRelationship]:
    _get_owned_novel(db, user.id, novel_id)
    return (
        db.query(CharacterRelationship)
        .filter(CharacterRelationship.novel_id == novel_id)
        .order_by(CharacterRelationship.id)
        .all()
    )


@router.post("/relationships", response_model=RelationshipOut, status_code=status.HTTP_201_CREATED)
def create_relationship(
    novel_id: int,
    body: RelationshipCreate,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> CharacterRelationship:
    _get_owned_novel(db, user.id, novel_id)
    a = db.get(Character, body.character_a_id)
    b = db.get(Character, body.character_b_id)
    if (
        a is None
        or b is None
        or a.novel_id != novel_id
        or b.novel_id != novel_id
        or body.character_a_id == body.character_b_id
    ):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="人物无效")
    r = CharacterRelationship(
        novel_id=novel_id,
        character_a_id=body.character_a_id,
        character_b_id=body.character_b_id,
        description=body.description,
    )
    db.add(r)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="该人物对已存在关系记录",
        ) from None
    db.refresh(r)
    return r


@router.patch("/relationships/{rel_id}", response_model=RelationshipOut)
def update_relationship(
    novel_id: int,
    rel_id: int,
    body: RelationshipUpdate,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> CharacterRelationship:
    _get_owned_novel(db, user.id, novel_id)
    r = db.get(CharacterRelationship, rel_id)
    if r is None or r.novel_id != novel_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="关系不存在")
    if body.description is not None:
        r.description = body.description
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


@router.delete("/relationships/{rel_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_relationship(
    novel_id: int,
    rel_id: int,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> None:
    _get_owned_novel(db, user.id, novel_id)
    r = db.get(CharacterRelationship, rel_id)
    if r is None or r.novel_id != novel_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="关系不存在")
    db.delete(r)
    db.commit()
