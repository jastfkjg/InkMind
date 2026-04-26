from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import CurrentUser
from app.models import User
from app.schemas.auth import Token, UserCreate, UserLogin, UserOut, UserUpdate
from app.llm.providers import list_available_providers
from app.security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=Token)
def register(body: UserCreate, db: Session = Depends(get_db)) -> Token:
    existing = db.query(User).filter(User.email == body.email).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="该邮箱已注册")
    user = User(
        email=body.email,
        hashed_password=hash_password(body.password),
        display_name=body.display_name,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_access_token(str(user.id))
    return Token(access_token=token, user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
def me(user: CurrentUser) -> User:
    return user


@router.patch("/me", response_model=UserOut)
def update_me(body: UserUpdate, user: CurrentUser, db: Session = Depends(get_db)) -> User:
    data = body.model_dump(exclude_unset=True)

    if "preferred_llm_provider" in data:
        v = data["preferred_llm_provider"]
        if v is None or (isinstance(v, str) and not str(v).strip()):
            user.preferred_llm_provider = None
        else:
            avail = list_available_providers()
            low = str(v).strip().lower()
            if low not in avail:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"该模型未配置或不可用。当前可用: {', '.join(avail) or '无'}",
                )
            user.preferred_llm_provider = low

    if "agent_mode" in data:
        v = data["agent_mode"]
        valid_modes = ["flexible", "react", "direct"]
        if v not in valid_modes:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"agent_mode 必须是以下之一: {', '.join(valid_modes)}",
            )
        user.agent_mode = v

    if "max_llm_iterations" in data:
        v = data["max_llm_iterations"]
        if v is not None and (v < 1 or v > 50):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="max_llm_iterations 必须在 1-50 之间",
            )
        user.max_llm_iterations = v or 10

    if "max_tokens_per_task" in data:
        v = data["max_tokens_per_task"]
        if v is not None and (v < 1000 or v > 500000):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="max_tokens_per_task 必须在 1000-500000 之间",
            )
        user.max_tokens_per_task = v or 50000

    if "enable_auto_audit" in data:
        user.enable_auto_audit = bool(data["enable_auto_audit"])

    if "preview_before_save" in data:
        user.preview_before_save = bool(data["preview_before_save"])

    if "auto_audit_min_score" in data:
        v = data["auto_audit_min_score"]
        if v is not None and (v < 0 or v > 100):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="auto_audit_min_score 必须在 0-100 之间",
            )
        user.auto_audit_min_score = v or 60

    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/login", response_model=Token)
def login(body: UserLogin, db: Session = Depends(get_db)) -> Token:
    user = db.query(User).filter(User.email == body.email).first()
    if user is None or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="邮箱或密码错误")
    token = create_access_token(str(user.id))
    return Token(access_token=token, user=UserOut.model_validate(user))
