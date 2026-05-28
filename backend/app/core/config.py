"""配置管理:从环境变量加载,统一在此处暴露给业务代码。"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    openai_api_key: str = ""
    openai_base_url: str = "https://https://your-gateway.example.com/v1"

    primary_model: str = "deepseek-v4-pro-max"
    fast_model: str = "deepseek-v4-flash"
    vision_model: str = "gemini-3.1-flash-lite"
    fallback_model: str = "claude-sonnet-4-6"

    github_token: str = ""

    backend_host: str = "0.0.0.0"
    backend_port: int = 8000

    cors_origins: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]
    cors_origin_regex: str | None = None

    cache_enabled: bool = True
    cache_db_path: str = "./data/cache.db"


@lru_cache
def get_settings() -> Settings:
    return Settings()
