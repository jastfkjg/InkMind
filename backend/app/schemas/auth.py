from pydantic import BaseModel, EmailStr, Field


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    display_name: str | None = None


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: int
    email: str
    display_name: str | None
    preferred_llm_provider: str | None = None
    llm_call_count: int = 0

    agent_mode: str = "flexible"
    max_llm_iterations: int = 10
    max_tokens_per_task: int = 50000
    enable_auto_audit: bool = True
    preview_before_save: bool = True
    auto_audit_min_score: int = 60
    ai_language: str | None = None

    model_config = {"from_attributes": True}


class UserUpdate(BaseModel):
    preferred_llm_provider: str | None = None

    agent_mode: str | None = None
    max_llm_iterations: int | None = None
    max_tokens_per_task: int | None = None
    enable_auto_audit: bool | None = None
    preview_before_save: bool | None = None
    auto_audit_min_score: int | None = None
    ai_language: str | None = None


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut
