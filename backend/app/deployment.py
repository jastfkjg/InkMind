"""Host-controlled admission gate for draining a single-process Web deployment."""
from pathlib import Path
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send


class MaintenanceMiddleware:
    def __init__(self, app: ASGIApp, marker: str = "", state: "MaintenanceMiddleware | None" = None) -> None:
        self.app = app
        self.marker = Path(marker) if marker else None
        self.active_requests = 0
        self.state = state or self

    def enabled(self) -> bool:
        return self.marker is not None and self.marker.exists()

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope.get("path") == "/health":
            await self.app(scope, receive, send)
            return
        if self.state.enabled():
            await JSONResponse({"detail": "服务正在更新，请稍后重试。"}, status_code=503,
                               headers={"Retry-After": "60"})(scope, receive, send)
            return
        self.state.active_requests += 1
        try:
            await self.app(scope, receive, send)
        finally:
            self.state.active_requests -= 1
