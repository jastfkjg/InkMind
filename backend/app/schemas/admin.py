from datetime import datetime

from pydantic import BaseModel, field_serializer

from app.schemas.usage import _utc_dt


class TokenQuotaInfo(BaseModel):
    token_quota: int | None = None
    token_quota_used: int = 0
    token_quota_remaining: int | None = None
    token_quota_reset_at: datetime | None = None

    model_config = {"from_attributes": True}

    @field_serializer("token_quota_reset_at")
    def serialize_dt(self, v: datetime | None) -> str | None:
        if v is None:
            return None
        return _utc_dt(v).isoformat()


class AdminUserOut(BaseModel):
    id: int
    email: str
    display_name: str | None
    is_admin: bool
    llm_call_count: int
    created_at: datetime

    token_quota: int | None = None
    token_quota_used: int = 0
    token_quota_reset_at: datetime | None = None

    model_config = {"from_attributes": True}

    @field_serializer("created_at", "token_quota_reset_at")
    def serialize_dts(self, v: datetime | None) -> str | None:
        if v is None:
            return None
        return _utc_dt(v).isoformat()


class AdminUserListOut(BaseModel):
    total: int
    items: list[AdminUserOut]


class UpdateTokenQuotaRequest(BaseModel):
    token_quota: int | None = None
    reason: str | None = None


class TokenQuotaChangeOut(BaseModel):
    id: int
    user_id: int
    admin_id: int | None
    old_quota: int | None
    new_quota: int | None
    reason: str | None
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_serializer("created_at")
    def serialize_dt(self, v: datetime) -> str:
        return _utc_dt(v).isoformat()


class TokenQuotaChangeListOut(BaseModel):
    total: int
    items: list[TokenQuotaChangeOut]


class AdminLogOut(BaseModel):
    id: int
    admin_id: int
    admin_email: str | None = None
    target_user_id: int | None
    target_user_email: str | None = None
    action: str
    resource_type: str | None
    resource_id: int | None
    details: str | None
    ip_address: str | None
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_serializer("created_at")
    def serialize_dt(self, v: datetime) -> str:
        return _utc_dt(v).isoformat()


class AdminLogListOut(BaseModel):
    total: int
    items: list[AdminLogOut]


class UserUsageSummary(BaseModel):
    user_id: int
    user_email: str
    total_calls: int
    total_input_tokens: int
    total_output_tokens: int
    total_tokens: int
    period_start: datetime
    period_end: datetime


class UserNovelOut(BaseModel):
    id: int
    title: str
    genre: str
    created_at: datetime
    updated_at: datetime
    chapter_count: int = 0

    model_config = {"from_attributes": True}

    @field_serializer("created_at", "updated_at")
    def serialize_dts(self, v: datetime) -> str:
        return _utc_dt(v).isoformat()


class UserNovelListOut(BaseModel):
    total: int
    items: list[UserNovelOut]


class UserUsageDetail(BaseModel):
    total_calls: int
    total_input_tokens: int
    total_output_tokens: int
    total_tokens: int
