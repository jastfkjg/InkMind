from datetime import datetime, timezone
from decimal import Decimal
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_serializer, model_validator


class CreditPackage(BaseModel):
    id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,64}$")
    name: str = Field(min_length=1, max_length=80, pattern=r"^[^/=&#<>]+$")
    name_en: str = Field(default="", max_length=80)
    amount_cents: int = Field(strict=True, ge=1, le=100000000)
    credits: int = Field(strict=True, ge=1, le=100000000)


class BillingModel(BaseModel):
    provider: str = Field(min_length=1, max_length=64)
    model: str = Field(min_length=1, max_length=256)
    input_rate: Decimal = Field(default=Decimal(1), gt=0, le=1000)
    output_rate: Decimal = Field(default=Decimal(1), gt=0, le=1000)
    # Required for a bounded SDK assistant turn. Use actual vendor prices.
    usd_per_million_input: Decimal | None = Field(default=None, gt=0)
    usd_per_million_output: Decimal | None = Field(default=None, gt=0)


class PaymentOrderCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    package_id: str | None = Field(default=None, min_length=1, max_length=64)
    amount_cents: int | None = Field(default=None, strict=True, ge=100, le=100000000)
    request_key: str = Field(pattern=r"^[a-zA-Z0-9_-]{16,64}$")
    accept_terms: Literal[True]

    @model_validator(mode="after")
    def one_purchase_option(self) -> "PaymentOrderCreate":
        if (self.package_id is None) == (self.amount_cents is None):
            raise ValueError("请选择套餐或自定义充值金额。")
        return self


class PaymentOrderResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    user_id: int
    out_trade_no: str
    package_id: str
    subject: str
    amount_cents: int
    credits: int
    remaining_credits: int
    status: str
    sandbox: bool
    created_at: datetime
    expires_at: datetime
    paid_at: datetime | None
    refunded_at: datetime | None

    @field_serializer("created_at", "expires_at", "paid_at", "refunded_at")
    def serialize_time(self, value: datetime | None) -> str | None:
        if value is None:
            return None
        return value.replace(tzinfo=timezone.utc).isoformat() if value.tzinfo is None else value.isoformat()


class ReservationReconcile(BaseModel):
    input_tokens: int = Field(ge=0, le=100000000)
    output_tokens: int = Field(ge=0, le=100000000)
    reason: str = Field(min_length=5, max_length=300)
