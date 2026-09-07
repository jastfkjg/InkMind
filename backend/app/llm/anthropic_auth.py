from typing import Literal
from urllib.parse import urlparse


ClaudeAuthMode = Literal["auto", "api_key", "auth_token"]


def resolve_claude_auth_mode(
    base_url: str | None,
    configured_mode: str | None,
) -> Literal["api_key", "auth_token"]:
    """Choose the authentication header for an Anthropic-compatible endpoint."""
    if configured_mode in {"api_key", "auth_token"}:
        return configured_mode

    hostname = (urlparse(base_url or "").hostname or "").lower()
    if not hostname:
        return "api_key"
    # Anthropic and Kimi Code document X-Api-Key. Most other Claude-compatible
    # gateways (including Bailian plans and DeepSeek) document Bearer auth.
    if hostname == "api.anthropic.com" or hostname.endswith(".anthropic.com"):
        return "api_key"
    if hostname == "api.kimi.com" or hostname.endswith(".kimi.com"):
        return "api_key"
    return "auth_token"
