from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, aliased

from app.database import get_db
from app.deps import CurrentAdmin, CurrentUser
from app.llm.metered_llm import get_effective_token_quota_used
from app.models import AdminLog, Chapter, LLMUsageEvent, Novel, TokenQuotaChange, User
from app.schemas.admin import (
    AdminLogListOut,
    AdminLogOut,
    AdminUserListOut,
    AdminUserOut,
    TokenQuotaChangeListOut,
    TokenQuotaChangeOut,
    UpdateTokenQuotaRequest,
    UserNovelListOut,
    UserNovelOut,
    UserUsageDetail,
)

router = APIRouter(prefix="/admin", tags=["admin"])


def _log_admin_action(
    db: Session,
    admin: User,
    action: str,
    request: Request | None = None,
    target_user_id: int | None = None,
    resource_type: str | None = None,
    resource_id: int | None = None,
    details: str | None = None,
) -> None:
    ip_address = None
    user_agent = None
    if request is not None:
        forwarded_for = request.headers.get("X-Forwarded-For")
        if forwarded_for:
            ip_address = forwarded_for.split(",")[0].strip()
        else:
            ip_address = request.client.host if request.client else None
        user_agent = request.headers.get("User-Agent")
    
    log = AdminLog(
        admin_id=admin.id,
        target_user_id=target_user_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        details=details,
        ip_address=ip_address,
        user_agent=user_agent,
    )
    db.add(log)
    db.commit()


def _get_user_with_usage(db: Session, user_id: int) -> AdminUserOut:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")
    
    return _admin_user_out(db, user)


def _admin_user_out(db: Session, user: User) -> AdminUserOut:
    item = AdminUserOut.model_validate(user)
    item.token_quota_used = get_effective_token_quota_used(db, user)
    return item


@router.get("/users", response_model=AdminUserListOut)
def list_users(
    admin: CurrentAdmin,
    db: Annotated[Session, Depends(get_db)],
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    search: str | None = Query(default=None),
) -> AdminUserListOut:
    offset = (page - 1) * page_size
    
    query = select(User)
    if search:
        search_term = f"%{search}%"
        query = query.where(
            (User.email.ilike(search_term)) |
            (User.display_name.ilike(search_term))
        )
    
    count_query = select(func.count(User.id)).select_from(query.subquery())
    total = db.scalar(count_query) or 0
    
    query = query.order_by(User.created_at.desc()).offset(offset).limit(page_size)
    users = db.scalars(query).all()
    
    return AdminUserListOut(
        total=total,
        items=[_admin_user_out(db, u) for u in users],
    )


@router.get("/users/{user_id}", response_model=AdminUserOut)
def get_user_detail(
    admin: CurrentAdmin,
    user_id: int,
    db: Annotated[Session, Depends(get_db)],
) -> AdminUserOut:
    return _get_user_with_usage(db, user_id)


@router.patch("/users/{user_id}/quota", response_model=AdminUserOut)
def update_user_quota(
    admin: CurrentAdmin,
    user_id: int,
    payload: UpdateTokenQuotaRequest,
    db: Annotated[Session, Depends(get_db)],
    request: Request,
) -> AdminUserOut:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")
    
    old_quota = user.token_quota
    new_quota = payload.token_quota
    
    if old_quota != new_quota:
        user.token_quota = new_quota
        
        change = TokenQuotaChange(
            user_id=user_id,
            admin_id=admin.id,
            old_quota=old_quota,
            new_quota=new_quota,
            reason=payload.reason,
        )
        db.add(change)
        
        details = f"配额从 {old_quota if old_quota is not None else '无限制'} 改为 {new_quota if new_quota is not None else '无限制'}"
        if payload.reason:
            details += f"，原因：{payload.reason}"
        
        _log_admin_action(
            db,
            admin,
            "update_quota",
            request,
            target_user_id=user_id,
            details=details,
        )
    
    db.commit()
    db.refresh(user)
    
    return _admin_user_out(db, user)


@router.post("/users/{user_id}/reset-quota-usage", response_model=AdminUserOut)
def reset_user_quota_usage(
    admin: CurrentAdmin,
    user_id: int,
    db: Annotated[Session, Depends(get_db)],
    request: Request,
) -> AdminUserOut:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")
    
    old_used = user.token_quota_used
    user.token_quota_used = 0
    user.token_quota_reset_at = datetime.now(timezone.utc)
    
    _log_admin_action(
        db,
        admin,
        "reset_quota_usage",
        request,
        target_user_id=user_id,
        details=f"重置已使用配额：{old_used} tokens",
    )
    
    db.commit()
    db.refresh(user)
    
    return _admin_user_out(db, user)


@router.get("/users/{user_id}/novels", response_model=UserNovelListOut)
def get_user_novels(
    admin: CurrentAdmin,
    user_id: int,
    db: Annotated[Session, Depends(get_db)],
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> UserNovelListOut:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")
    
    offset = (page - 1) * page_size
    
    count_query = select(func.count(Novel.id)).where(Novel.user_id == user_id)
    total = db.scalar(count_query) or 0
    
    query = (
        select(Novel, func.count(Chapter.id).label("chapter_count"))
        .outerjoin(Chapter, Novel.id == Chapter.novel_id)
        .where(Novel.user_id == user_id)
        .group_by(Novel.id)
        .order_by(Novel.created_at.desc())
        .offset(offset)
        .limit(page_size)
    )
    rows = db.execute(query).all()
    
    items = []
    for row in rows:
        novel = row[0]
        chapter_count = row[1] or 0
        item = UserNovelOut.model_validate(novel)
        item.chapter_count = chapter_count
        items.append(item)
    
    return UserNovelListOut(total=total, items=items)


@router.get("/users/{user_id}/usage", response_model=UserUsageDetail)
def get_user_usage(
    admin: CurrentAdmin,
    user_id: int,
    db: Annotated[Session, Depends(get_db)],
    days: int = Query(default=30, ge=1, le=365),
) -> UserUsageDetail:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")
    
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    
    result = db.execute(
        select(
            func.count(LLMUsageEvent.id),
            func.coalesce(func.sum(LLMUsageEvent.input_tokens), 0),
            func.coalesce(func.sum(LLMUsageEvent.output_tokens), 0),
            func.coalesce(func.sum(LLMUsageEvent.total_tokens), 0),
        ).where(
            LLMUsageEvent.user_id == user_id,
            LLMUsageEvent.created_at >= cutoff,
        )
    ).one()
    
    return UserUsageDetail(
        total_calls=int(result[0] or 0),
        total_input_tokens=int(result[1] or 0),
        total_output_tokens=int(result[2] or 0),
        total_tokens=int(result[3] or 0),
    )


@router.get("/quota-changes", response_model=TokenQuotaChangeListOut)
def list_quota_changes(
    admin: CurrentAdmin,
    db: Annotated[Session, Depends(get_db)],
    user_id: int | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> TokenQuotaChangeListOut:
    offset = (page - 1) * page_size
    
    query = select(TokenQuotaChange)
    if user_id is not None:
        query = query.where(TokenQuotaChange.user_id == user_id)
    
    count_query = select(func.count(TokenQuotaChange.id)).select_from(query.subquery())
    total = db.scalar(count_query) or 0
    
    query = query.order_by(TokenQuotaChange.created_at.desc()).offset(offset).limit(page_size)
    changes = db.scalars(query).all()
    
    return TokenQuotaChangeListOut(
        total=total,
        items=[TokenQuotaChangeOut.model_validate(c) for c in changes],
    )


@router.get("/logs", response_model=AdminLogListOut)
def list_admin_logs(
    admin: CurrentAdmin,
    db: Annotated[Session, Depends(get_db)],
    action: str | None = Query(default=None),
    admin_id: int | None = Query(default=None),
    target_user_id: int | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> AdminLogListOut:
    offset = (page - 1) * page_size
    
    AdminUser = aliased(User)
    TargetUser = aliased(User)
    
    query = (
        select(AdminLog, AdminUser, TargetUser)
        .outerjoin(AdminUser, AdminLog.admin_id == AdminUser.id)
        .outerjoin(TargetUser, AdminLog.target_user_id == TargetUser.id)
    )
    
    if action:
        query = query.where(AdminLog.action == action)
    if admin_id is not None:
        query = query.where(AdminLog.admin_id == admin_id)
    if target_user_id is not None:
        query = query.where(AdminLog.target_user_id == target_user_id)
    
    count_query = select(func.count()).select_from(query.subquery())
    total = db.scalar(count_query) or 0
    
    query = query.order_by(AdminLog.created_at.desc()).offset(offset).limit(page_size)
    rows = db.execute(query).all()
    
    items = []
    for row in rows:
        log = row[0]
        admin_user = row[1]
        target_user = row[2]
        
        out = AdminLogOut.model_validate(log)
        out.admin_email = admin_user.email if admin_user else None
        out.target_user_email = target_user.email if target_user else None
        items.append(out)
    
    return AdminLogListOut(total=total, items=items)


@router.get("/me/quota")
def get_my_quota(user: CurrentUser, db: Annotated[Session, Depends(get_db)]):
    used = get_effective_token_quota_used(db, user)
    remaining = None
    if user.token_quota is not None:
        remaining = max(0, user.token_quota - used)
    
    return {
        "token_quota": user.token_quota,
        "token_quota_used": used,
        "token_quota_remaining": remaining,
        "token_quota_reset_at": user.token_quota_reset_at,
        "is_unlimited": user.token_quota is None,
    }
