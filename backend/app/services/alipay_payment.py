"""Alipay official SDK adapter; configuration is never copied into application code."""
from dataclasses import dataclass
from decimal import Decimal
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlparse
import json
import stat

from app.config import settings
from app.models import PaymentOrder

SANDBOX_GATEWAY = "https://openapi-sandbox.dl.alipaydev.com/gateway.do"
PRODUCTION_GATEWAY = "https://openapi.alipay.com/gateway.do"
SANDBOX_CONFIG_PATH = Path(__file__).resolve().parents[2] / ".alipay-sandbox.json"


class PaymentGatewayError(Exception):
    pass


@dataclass(frozen=True, repr=False)
class PaymentConfig:
    app_id: str
    seller_id: str
    app_private_key: str
    alipay_public_key: str
    sandbox: bool
    server_url: str


def _raw_key(value: object) -> str:
    if not isinstance(value, str) or not value or any(ch.isspace() for ch in value) or "-----" in value:
        raise PaymentGatewayError("支付宝密钥格式不可用，请使用官方工具提供的原始密钥。")
    return value


def _protected_file(path: Path) -> str:
    if not path.is_absolute() or path.is_symlink() or path.stat().st_mode & (stat.S_IRWXG | stat.S_IRWXO):
        raise PaymentGatewayError("支付宝配置文件须使用绝对路径并限制为当前用户可读。")
    # Text editors commonly append a final newline. Keep the key body strict
    # while accepting whitespace around the protected file's contents.
    return path.read_text(encoding="utf-8").strip()


def load_payment_config() -> PaymentConfig:
    if settings.desktop_mode:
        raise PaymentGatewayError("桌面模式不提供平台收款。")
    try:
        if settings.alipay_sandbox:
            data = json.loads(_protected_file(SANDBOX_CONFIG_PATH))
            apps = data["appIds"]
            if not isinstance(apps, list) or len(apps) != 1:
                raise ValueError("ambiguous application")
            app = apps[0]
            app_id, seller_id = app["appId"], app["pid"]
            if not app_id or not seller_id:
                raise ValueError("missing identity")
            return PaymentConfig(app_id=str(app_id), seller_id=str(seller_id),
                                 app_private_key=_raw_key(app["appPrivatePkcsKey"]),
                                 alipay_public_key=_raw_key(app["alipayPublicKey"]),
                                 sandbox=True, server_url=SANDBOX_GATEWAY)
        if not settings.alipay_app_id or not settings.alipay_seller_id:
            raise ValueError("missing identity")
        return PaymentConfig(app_id=settings.alipay_app_id, seller_id=settings.alipay_seller_id,
                             app_private_key=_raw_key(_protected_file(Path(settings.alipay_private_key_path))),
                             alipay_public_key=_raw_key(_protected_file(Path(settings.alipay_public_key_path))),
                             sandbox=False, server_url=PRODUCTION_GATEWAY)
    except PaymentGatewayError:
        raise
    except Exception:
        raise PaymentGatewayError("支付宝收款配置不可用，请联系管理员。") from None


def return_url() -> str:
    value = settings.alipay_return_url or settings.alipay_api_base_url.rstrip("/") + "/billing/return"
    parsed = urlparse(value)
    if (parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username
            or parsed.fragment or parsed.query or parsed.path not in {"/billing/return", "/api/billing/return"}):
        raise PaymentGatewayError("请配置指向 InkMind 支付结果路由的返回地址。")
    if parsed.scheme != "https" and (not settings.alipay_sandbox or parsed.hostname not in {"localhost", "127.0.0.1"}):
        raise PaymentGatewayError("生产返回地址必须使用 HTTPS。")
    return value


class AlipayGateway:
    def __init__(self) -> None:
        from alipay.aop.api.AlipayClientConfig import AlipayClientConfig
        from alipay.aop.api.DefaultAlipayClient import DefaultAlipayClient
        self.config = load_payment_config()
        config = AlipayClientConfig()
        config.app_id = self.config.app_id
        config.app_private_key = self.config.app_private_key
        self.public_key = self.config.alipay_public_key
        config.alipay_public_key = self.public_key
        config.charset = "utf-8"
        config.sign_type = "RSA2"
        config.timeout = 15
        config.server_url = self.config.server_url
        self.client = DefaultAlipayClient(alipay_client_config=config)

    def checkout(self, order: PaymentOrder) -> str:
        from alipay.aop.api.request.AlipayTradePagePayRequest import AlipayTradePagePayRequest
        from alipay.aop.api.domain.AlipayTradePagePayModel import AlipayTradePagePayModel
        from zoneinfo import ZoneInfo
        from datetime import timezone
        request = AlipayTradePagePayRequest()
        model = AlipayTradePagePayModel()
        model.out_trade_no = order.out_trade_no
        model.total_amount = format(Decimal(order.amount_cents) / 100, ".2f")
        model.subject = order.subject
        model.product_code = "FAST_INSTANT_TRADE_PAY"
        model.time_expire = order.expires_at.replace(tzinfo=timezone.utc).astimezone(ZoneInfo("Asia/Shanghai")).strftime("%Y-%m-%d %H:%M:%S")
        request.biz_model = model
        if settings.alipay_notify_url:
            request.notify_url = settings.alipay_notify_url
        request.return_url = return_url()
        try:
            html = self.client.page_execute(request, http_method="POST")
            if not isinstance(html, str) or "<form" not in html:
                raise ValueError("missing payment form")
            return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + html + '</body></html>'
        except Exception:
            raise PaymentGatewayError("支付宝付款页面暂时不可用，请重试原订单。") from None

    def verify(self, params: dict[str, str], *, notification: bool = True) -> bool:
        from alipay.aop.api.util.SignatureUtils import get_sign_content, verify_with_rsa
        if params.get("sign_type") != "RSA2" or not params.get("sign"):
            return False
        # Alipay callback verification excludes sign and sign_type for both returns and notifications.
        excluded = {"sign", "sign_type"}
        signed = {k: v for k, v in params.items() if k not in excluded and v != ""}
        try:
            return bool(verify_with_rsa(self.public_key, get_sign_content(signed).encode("utf-8"), params["sign"]))
        except Exception:
            return False

    def _execute(self, request: object) -> dict:
        try:
            result = json.loads(self.client.execute(request))
        except Exception:
            raise PaymentGatewayError("支付宝暂时无法确认交易，请稍后查询原订单。") from None
        if result.get("code") != "10000":
            if result.get("sub_code") == "ACQ.TRADE_NOT_EXIST":
                return {"trade_status": "NOT_FOUND", "refund_status": "UNKNOWN"}
            raise PaymentGatewayError("支付宝交易处理未完成，请稍后查询原订单。")
        return result

    def query(self, order: PaymentOrder) -> dict:
        from alipay.aop.api.request.AlipayTradeQueryRequest import AlipayTradeQueryRequest
        from alipay.aop.api.domain.AlipayTradeQueryModel import AlipayTradeQueryModel
        request = AlipayTradeQueryRequest()
        model = AlipayTradeQueryModel()
        model.out_trade_no = order.out_trade_no
        request.biz_model = model
        return self._execute(request)

    def refund(self, order: PaymentOrder) -> dict:
        from alipay.aop.api.request.AlipayTradeRefundRequest import AlipayTradeRefundRequest
        from alipay.aop.api.domain.AlipayTradeRefundModel import AlipayTradeRefundModel
        request = AlipayTradeRefundRequest()
        model = AlipayTradeRefundModel()
        model.out_trade_no = order.out_trade_no
        model.out_request_no = order.refund_no
        model.refund_amount = format(Decimal(order.amount_cents) / 100, ".2f")
        model.refund_reason = "未使用额度包退款"
        request.biz_model = model
        return self._execute(request)

    def refund_query(self, order: PaymentOrder) -> dict:
        from alipay.aop.api.request.AlipayTradeFastpayRefundQueryRequest import AlipayTradeFastpayRefundQueryRequest
        from alipay.aop.api.domain.AlipayTradeFastpayRefundQueryModel import AlipayTradeFastpayRefundQueryModel
        request = AlipayTradeFastpayRefundQueryRequest()
        model = AlipayTradeFastpayRefundQueryModel()
        model.out_trade_no = order.out_trade_no
        model.out_request_no = order.refund_no
        request.biz_model = model
        return self._execute(request)

    def close(self, order: PaymentOrder) -> dict:
        from alipay.aop.api.request.AlipayTradeCloseRequest import AlipayTradeCloseRequest
        from alipay.aop.api.domain.AlipayTradeCloseModel import AlipayTradeCloseModel
        request = AlipayTradeCloseRequest()
        model = AlipayTradeCloseModel()
        model.out_trade_no = order.out_trade_no
        request.biz_model = model
        return self._execute(request)


@lru_cache(maxsize=1)
def get_gateway() -> AlipayGateway:
    try:
        return AlipayGateway()
    except Exception:
        raise PaymentGatewayError("支付宝收款配置不可用，请联系管理员。") from None
