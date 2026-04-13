from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "InkMind"
    secret_key: str = "change-me-in-production-use-long-random-string"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 7

    database_url: str = "sqlite:///./inkmind.db"

    default_llm_provider: str = "openai"
    openai_api_key: str | None = None
    openai_base_url: str | None = None
    openai_model: str = "gpt-4o-mini"
    # 部分兼容网关/推理模型不接受 temperature，设为 False 可在请求中省略该参数
    openai_send_temperature: bool = True
    openai_timeout: float = 120.0

    # 通义千问（DashScope OpenAI 兼容：https://dashscope.aliyuncs.com/compatible-mode/v1）
    qwen_api_key: str | None = None
    qwen_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    qwen_model: str = "qwen-turbo"
    qwen_send_temperature: bool = True
    qwen_timeout: float = 120.0

    # DeepSeek 官方兼容接口：https://api.deepseek.com
    deepseek_api_key: str | None = None
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-chat"
    deepseek_send_temperature: bool = True
    deepseek_timeout: float = 120.0

    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-3-5-sonnet-20241022"

    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"


settings = Settings()
