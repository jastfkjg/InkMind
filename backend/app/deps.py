from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User
from app.security import decode_token

security = HTTPBearer(auto_error=False)


def get_current_user(
    db: Annotated[Session, Depends(get_db)],
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(security)],
) -> User:
    if creds is None or not creds.credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="未登录")
    sub = decode_token(creds.credentials)
    if sub is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效或过期令牌")
    try:
        user_id = int(sub)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效令牌")
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户不存在")
    return user


def get_current_admin(
    user: Annotated[User, Depends(get_current_user)],
) -> User:
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="需要管理员权限",
        )
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
CurrentAdmin = Annotated[User, Depends(get_current_admin)]
