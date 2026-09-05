import secrets

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import CurrentUser
from app.models import User, UserCustomLLM
from app.schemas.auth import Token, UserCreate, UserLogin, UserOut, UserUpdate
from app.llm.providers import list_available_providers
from app.security import create_access_token, hash_password, verify_password
from app.config import settings

router = APIRouter(prefix="/auth", tags=["auth"])

_DESKTOP_USER_EMAIL = "local@inkmind.desktop"


@router.post("/desktop-session", response_model=Token, include_in_schema=False)
def desktop_session(
    db: Session = Depends(get_db),
    desktop_token: str | None = Header(default=None, alias="X-InkMind-Desktop-Token"),
) -> Token:
    """Create a session for the single local desktop author.

    Electron starts the API on loopback and keeps the per-launch token in its
    main process. The endpoint does not exist as a usable login path in web mode.
    """
    expected = settings.desktop_session_token
    if (
        not settings.desktop_mode
        or not expected
        or not desktop_token
        or not secrets.compare_digest(desktop_token, expected)
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    user = db.query(User).filter(User.email == _DESKTOP_USER_EMAIL).first()
    if user is None:
        user = User(
            email=_DESKTOP_USER_EMAIL,
            hashed_password=hash_password(secrets.token_urlsafe(32)),
            display_name="本地作者",
        )
        db.add(user)
        try:
            db.commit()
        except IntegrityError:
            # React Strict Mode can request the startup session twice. Another
            # request may have created the single local author in the meantime.
            db.rollback()
            user = db.query(User).filter(User.email == _DESKTOP_USER_EMAIL).one()
        db.refresh(user)

    # The local author supplies their own model credentials, so server-style
    # account quotas do not apply in desktop mode.
    if user.token_quota is not None:
        user.token_quota = None
        db.add(user)
        db.commit()
        db.refresh(user)

    token = create_access_token(str(user.id))
    return Token(access_token=token, user=UserOut.model_validate(user))


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

    if "preferred_llm_model" in data:
        v = data["preferred_llm_model"]
        if v is None or (isinstance(v, str) and not str(v).strip()):
            user.preferred_llm_model = None
        else:
            user.preferred_llm_model = str(v).strip()

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
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="max_llm_iterations 必须在 1-50 之间")
        user.max_llm_iterations = v or 10

    if "max_tokens_per_task" in data:
        v = data["max_tokens_per_task"]
        if v is not None and (v < 1000 or v > 500000):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="max_tokens_per_task 必须在 1000-500000 之间")
        user.max_tokens_per_task = v or 50000

    if "enable_auto_audit" in data:
        user.enable_auto_audit = bool(data["enable_auto_audit"])

    if "preview_before_save" in data:
        user.preview_before_save = bool(data["preview_before_save"])

    if "auto_audit_min_score" in data:
        v = data["auto_audit_min_score"]
        if v is not None and (v < 0 or v > 100):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="auto_audit_min_score 必须在 0-100 之间")
        user.auto_audit_min_score = v or 60

    if "ai_language" in data:
        v = data["ai_language"]
        if v is not None and v not in ["zh", "en"]:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ai_language 必须是 'zh' 或 'en'")
        user.ai_language = v

    if "agent_use_custom" in data:
        user.agent_use_custom = bool(data["agent_use_custom"])

    if "agent_custom_llm_id" in data:
        v = data["agent_custom_llm_id"]
        if v is not None:
            custom = db.get(UserCustomLLM, v)
            if not custom or custom.user_id != user.id:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="自定义 LLM 不存在")
        user.agent_custom_llm_id = v

    if "agent_model" in data:
        v = data["agent_model"]
        user.agent_model = v.strip() if v and v.strip() else None

    if "generation_use_custom" in data:
        user.generation_use_custom = bool(data["generation_use_custom"])

    if "generation_custom_llm_id" in data:
        v = data["generation_custom_llm_id"]
        if v is not None:
            custom = db.get(UserCustomLLM, v)
            if not custom or custom.user_id != user.id:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="自定义 LLM 不存在")
        user.generation_custom_llm_id = v

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
