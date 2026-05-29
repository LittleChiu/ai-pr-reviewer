from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import health, pr, review
from app.core.config import get_settings
from app.core.errors import install_exception_handlers


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="AI PR Review",
        description="AI-powered Pull Request review assistant. "
        "粘 GitHub PR URL,几秒看到总览,30 秒拿到带置信度的智能评审报告。",
        version="0.1.0",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_origin_regex=settings.cors_origin_regex,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    install_exception_handlers(app)
    app.include_router(health.router, prefix="/api", tags=["health"])
    app.include_router(pr.router, prefix="/api", tags=["pr"])
    app.include_router(review.router, prefix="/api", tags=["review"])
    return app


app = create_app()
