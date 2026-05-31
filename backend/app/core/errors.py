"""统一错误响应 schema 与异常处理器。

全部 API 错误都按这种结构返回:
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "GitHub API 限流",
    "hint": "请配置 GITHUB_TOKEN 或稍后再试"
  }
}

前端按 code 给本地化提示,message 是给开发者看的英文/技术信息,hint 是给用户的。
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import HTTPException, RequestValidationError
from fastapi.responses import JSONResponse

from app.services.github_client import GitHubError, PRNotFoundError, RateLimitedError
from app.services.llm_client import LLMError

logger = logging.getLogger(__name__)


def _err_payload(code: str, message: str, hint: str | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {"error": {"code": code, "message": message}}
    if hint:
        payload["error"]["hint"] = hint
    return payload


def install_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(PRNotFoundError)
    async def _pr_not_found(_req: Request, exc: PRNotFoundError) -> JSONResponse:
        return JSONResponse(
            status_code=404,
            content=_err_payload(
                "PR_NOT_FOUND",
                str(exc),
                hint="请检查 PR URL 是否正确,或仓库是否为公开仓库",
            ),
        )

    @app.exception_handler(RateLimitedError)
    async def _rate_limited(_req: Request, exc: RateLimitedError) -> JSONResponse:
        return JSONResponse(
            status_code=429,
            content=_err_payload(
                "RATE_LIMITED",
                str(exc),
                hint="GitHub API 触发限流,可配置 GITHUB_TOKEN 提升上限,或稍后再试",
            ),
        )

    @app.exception_handler(GitHubError)
    async def _github_error(_req: Request, exc: GitHubError) -> JSONResponse:
        return JSONResponse(
            status_code=502,
            content=_err_payload(
                "GITHUB_ERROR",
                str(exc),
                hint="访问 GitHub API 失败,请稍后再试",
            ),
        )

    @app.exception_handler(LLMError)
    async def _llm_error(_req: Request, exc: LLMError) -> JSONResponse:
        return JSONResponse(
            status_code=503,
            content=_err_payload(
                "LLM_UNAVAILABLE",
                str(exc),
                hint="LLM 网关暂时不可用,请稍后重试。这通常是上游模型服务的瞬时抖动",
            ),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_req: Request, exc: RequestValidationError) -> JSONResponse:
        first_err = (exc.errors() or [{}])[0]
        return JSONResponse(
            status_code=400,
            content=_err_payload(
                "VALIDATION_ERROR",
                first_err.get("msg", "请求参数校验失败"),
                hint="请检查请求体的字段类型与格式",
            ),
        )

    @app.exception_handler(HTTPException)
    async def _http_exception(_req: Request, exc: HTTPException) -> JSONResponse:
        # 兼容 FastAPI 旧代码里直接 raise HTTPException(detail=...) 的情况,
        # 把 detail 包成统一格式
        if isinstance(exc.detail, dict) and "error" in exc.detail:
            return JSONResponse(status_code=exc.status_code, content=exc.detail)
        code_map = {
            400: "BAD_REQUEST",
            404: "NOT_FOUND",
            429: "RATE_LIMITED",
            502: "UPSTREAM_ERROR",
            503: "SERVICE_UNAVAILABLE",
        }
        code = code_map.get(exc.status_code, "HTTP_ERROR")
        return JSONResponse(
            status_code=exc.status_code,
            content=_err_payload(code, str(exc.detail)),
        )

    @app.exception_handler(Exception)
    async def _unhandled(req: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled error on %s: %s", req.url.path, exc)
        return JSONResponse(
            status_code=500,
            content=_err_payload(
                "INTERNAL_ERROR",
                "服务器内部错误",
                hint="请联系管理员或查看后端日志",
            ),
        )
