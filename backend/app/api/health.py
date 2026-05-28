from fastapi import APIRouter

from app.core.config import get_settings

router = APIRouter()


@router.get("/health")
async def health() -> dict:
    settings = get_settings()
    return {
        "status": "ok",
        "service": "ai-pr-reviewer-backend",
        "version": "0.1.0",
        "models": {
            "primary": settings.primary_model,
            "fast": settings.fast_model,
            "vision": settings.vision_model,
            "fallback": settings.fallback_model,
        },
        "llm_configured": bool(settings.openai_api_key),
    }
