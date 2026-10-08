"""Run the payment review with isolated data and the protected sandbox configuration."""
import os
from pathlib import Path
import tempfile


def main() -> None:
    data_dir = Path(tempfile.gettempdir()) / "inkmind-payment-sandbox"
    data_dir.mkdir(mode=0o700, exist_ok=True)
    os.environ.update({
        "DATABASE_URL": f"sqlite:///{data_dir / 'review.db'}",
        "DESKTOP_MODE": "false",
        "ALIPAY_SANDBOX": "true",
        "BILLING_ENABLED": "true",
        "BILLING_PACKAGES": '[{"id":"sandbox","name":"沙箱体验额度包","name_en":"Sandbox credit package","amount_cents":1,"credits":100000}]',
        "BILLING_MODELS": '[{"provider":"qwen","model":"qwen-turbo","input_rate":"1","output_rate":"1"}]',
        "BILLING_TERMS_URL": "http://127.0.0.1:8000/billing/sandbox-info",
        "BILLING_SUPPORT_EMAIL": "",
        "ALIPAY_API_BASE_URL": "http://127.0.0.1:8000",
        "ALIPAY_RETURN_URL": "http://127.0.0.1:8000/billing/return",
        "ALIPAY_NOTIFY_URL": "",
        "BILLING_FRONTEND_URL": "http://127.0.0.1:5173/usage",
    })
    from app.main import app
    from fastapi.responses import HTMLResponse
    import uvicorn

    @app.get("/billing/sandbox-info", response_class=HTMLResponse, include_in_schema=False)
    def sandbox_info() -> HTMLResponse:
        return HTMLResponse("<!doctype html><html lang='zh'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>InkMind 沙箱体验说明</title><body style='max-width:40rem;margin:4rem auto;padding:1rem;font:16px/1.7 system-ui'><h1>沙箱体验说明</h1><p>本实例仅供验证支付和订单流程，使用支付宝沙箱账号，不涉及真实资金。本页展示的额度包及价格仅为测试数据，不是正式销售条款。测试数据与原有 InkMind 数据库隔离。</p><p>实际付款由你在沙箱收银台完成。付款后回到用量页查询订单；未使用的测试额度包可由管理员执行全额退款。公网异步通知和正式销售条款须在生产上线前配置并验证。</p></body></html>")

    uvicorn.run(app, host="127.0.0.1", port=8000, access_log=False)


if __name__ == "__main__":
    main()
