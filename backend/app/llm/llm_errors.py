"""Normalize SDK failures into one exception type for HTTP mapping."""


class LLMRequestError(Exception):
    def __init__(self, message: str, *, upstream_status: int | None = None) -> None:
        self.message = message
        self.upstream_status = upstream_status
        super().__init__(message)


def _openai_error_message(exc: BaseException) -> str:
    body = getattr(exc, "body", None)
    if isinstance(body, dict):
        err = body.get("error")
        if isinstance(err, dict):
            msg = err.get("message")
            if msg:
                return str(msg)
            t = err.get("type")
            if t:
                return str(t)
        if isinstance(err, str):
            return err
    msg = getattr(exc, "message", None)
    if isinstance(msg, str) and msg.strip():
        return msg.strip()
    s = str(exc).strip()
    return s if s else "上游模型接口返回错误"


def wrap_openai_error(exc: BaseException) -> LLMRequestError:
    from openai import APIError

    if isinstance(exc, APIError):
        status = getattr(exc, "status_code", None)
        return LLMRequestError(_openai_error_message(exc), upstream_status=status)
    return LLMRequestError(str(exc))


def wrap_anthropic_error(exc: BaseException) -> LLMRequestError:
    msg = str(exc).strip() or "Anthropic 接口错误"
    status = getattr(exc, "status_code", None)
    return LLMRequestError(msg, upstream_status=status)
