import difflib
from typing import Literal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Chapter, ChapterVersion, VersionChangeType


def get_next_version_number(db: Session, chapter_id: int) -> int:
    max_version = db.scalar(
        select(func.max(ChapterVersion.version_number)).where(
            ChapterVersion.chapter_id == chapter_id
        )
    )
    return (max_version or 0) + 1


def create_chapter_version(
    db: Session,
    chapter: Chapter,
    change_type: VersionChangeType = "manual",
    *,
    title: str | None = None,
    summary: str | None = None,
    content: str | None = None,
) -> ChapterVersion:
    version_number = get_next_version_number(db, chapter.id)
    
    version = ChapterVersion(
        chapter_id=chapter.id,
        version_number=version_number,
        title=title if title is not None else chapter.title,
        summary=summary if summary is not None else chapter.summary,
        content=content if content is not None else chapter.content,
        change_type=change_type,
    )
    
    db.add(version)
    db.commit()
    db.refresh(version)
    return version


def save_version_before_change(
    db: Session,
    chapter: Chapter,
    change_type: VersionChangeType,
) -> ChapterVersion | None:
    if not chapter.content and not chapter.title and not chapter.summary:
        return None
    return create_chapter_version(db, chapter, change_type)


def get_chapter_versions(
    db: Session,
    chapter_id: int,
    limit: int = 50,
) -> list[ChapterVersion]:
    return (
        db.query(ChapterVersion)
        .filter(ChapterVersion.chapter_id == chapter_id)
        .order_by(ChapterVersion.version_number.desc())
        .limit(limit)
        .all()
    )


def get_chapter_version(
    db: Session,
    chapter_id: int,
    version_id: int,
) -> ChapterVersion | None:
    return (
        db.query(ChapterVersion)
        .filter(ChapterVersion.id == version_id, ChapterVersion.chapter_id == chapter_id)
        .first()
    )


def compute_text_diff(
    old_text: str,
    new_text: str,
    context_lines: int = 3,
) -> tuple[str, str, int, int, int]:
    old_lines = (old_text or "").splitlines()
    new_lines = (new_text or "").splitlines()
    
    matcher = difflib.SequenceMatcher(None, old_lines, new_lines)
    
    added_count = 0
    removed_count = 0
    changed_count = 0
    
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "insert":
            added_count += j2 - j1
        elif tag == "delete":
            removed_count += i2 - i1
        elif tag == "replace":
            changed_count += max(i2 - i1, j2 - j1)
    
    diff_text_lines = []
    for line in difflib.unified_diff(
        old_lines,
        new_lines,
        fromfile="旧版本",
        tofile="新版本",
        lineterm="",
        n=context_lines,
    ):
        diff_text_lines.append(line)
    diff_text = "\n".join(diff_text_lines)
    
    html_lines = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            for line in old_lines[i1:i2]:
                html_lines.append(f'<span class="diff-equal">{_escape_html(line) or " "}</span>')
        elif tag == "insert":
            for line in new_lines[j1:j2]:
                html_lines.append(f'<span class="diff-insert">+ {_escape_html(line) or " "}</span>')
        elif tag == "delete":
            for line in old_lines[i1:i2]:
                html_lines.append(f'<span class="diff-delete">- {_escape_html(line) or " "}</span>')
        elif tag == "replace":
            for line in old_lines[i1:i2]:
                html_lines.append(f'<span class="diff-delete">- {_escape_html(line) or " "}</span>')
            for line in new_lines[j1:j2]:
                html_lines.append(f'<span class="diff-insert">+ {_escape_html(line) or " "}</span>')
    
    diff_html = "<br>".join(html_lines)
    
    return diff_html, diff_text, added_count, removed_count, changed_count


def _escape_html(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def compare_versions(
    db: Session,
    chapter_id: int,
    version_id_1: int,
    version_id_2: int,
) -> dict[str, str | int] | None:
    v1 = get_chapter_version(db, chapter_id, version_id_1)
    v2 = get_chapter_version(db, chapter_id, version_id_2)
    
    if not v1 or not v2:
        return None
    
    if v1.version_number > v2.version_number:
        v1, v2 = v2, v1
    
    diff_html, diff_text, added_count, removed_count, changed_count = compute_text_diff(
        v1.content, v2.content
    )
    
    return {
        "diff_html": diff_html,
        "diff_text": diff_text,
        "added_count": added_count,
        "removed_count": removed_count,
        "changed_count": changed_count,
        "old_version": {
            "id": v1.id,
            "version_number": v1.version_number,
            "title": v1.title,
            "summary": v1.summary,
            "content": v1.content,
            "change_type": v1.change_type,
            "created_at": v1.created_at,
        },
        "new_version": {
            "id": v2.id,
            "version_number": v2.version_number,
            "title": v2.title,
            "summary": v2.summary,
            "content": v2.content,
            "change_type": v2.change_type,
            "created_at": v2.created_at,
        },
    }


def compare_version_with_current(
    db: Session,
    chapter: Chapter,
    version_id: int,
) -> dict[str, str | int] | None:
    v = get_chapter_version(db, chapter.id, version_id)
    
    if not v:
        return None
    
    diff_html, diff_text, added_count, removed_count, changed_count = compute_text_diff(
        v.content, chapter.content
    )
    
    return {
        "diff_html": diff_html,
        "diff_text": diff_text,
        "added_count": added_count,
        "removed_count": removed_count,
        "changed_count": changed_count,
        "old_version": {
            "id": v.id,
            "version_number": v.version_number,
            "title": v.title,
            "summary": v.summary,
            "content": v.content,
            "change_type": v.change_type,
            "created_at": v.created_at,
        },
        "current_version": {
            "id": chapter.id,
            "title": chapter.title,
            "summary": chapter.summary,
            "content": chapter.content,
            "updated_at": chapter.updated_at,
        },
    }


def rollback_to_version(
    db: Session,
    chapter: Chapter,
    version_id: int,
    save_current: bool = True,
) -> Chapter | None:
    target_version = get_chapter_version(db, chapter.id, version_id)
    
    if not target_version:
        return None
    
    if save_current:
        create_chapter_version(db, chapter, "rollback")
    
    chapter.title = target_version.title
    chapter.summary = target_version.summary
    chapter.content = target_version.content
    
    db.add(chapter)
    db.commit()
    db.refresh(chapter)
    
    return chapter
