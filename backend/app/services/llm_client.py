"""LLM 客户端:封装 OpenAI 兼容协议,支持模型 fallback 链。

主路径:primary -> fallback。响应固定要求 JSON 模式。
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass

from openai import APIError, AsyncOpenAI

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class LLMError(Exception):
    pass


@dataclass
class LLMResponse:
    content: str
    model: str


class LLMClient:
    """统一调用入口。OpenAI 兼容协议,base_url 指向 yorhamc 网关。"""

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
    ) -> None:
        s = get_settings()
        self._api_key = api_key or s.openai_api_key
        self._base_url = base_url or s.openai_base_url
        if not self._api_key:
            raise LLMError("OPENAI_API_KEY 未配置,无法调用 LLM")
        self._client = AsyncOpenAI(api_key=self._api_key, base_url=self._base_url)

    async def chat_json(
        self,
        *,
        models: list[str],
        system: str,
        user: str,
        max_tokens: int = 4096,
        temperature: float = 0.2,
    ) -> LLMResponse:
        """按顺序尝试 models 中的模型,任一成功即返回。要求模型输出 JSON 字符串。"""
        last_error: Exception | None = None
        for model in models:
            try:
                logger.info("LLM call: model=%s", model)
                resp = await self._client.chat.completions.create(
                    model=model,
                    messages=[
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                    max_tokens=max_tokens,
                    temperature=temperature,
                )
                content = (resp.choices[0].message.content or "").strip()
                if not content:
                    raise LLMError(f"模型 {model} 返回空内容")
                return LLMResponse(content=content, model=model)
            except (APIError, LLMError) as e:
                logger.warning("LLM model %s failed: %s", model, e)
                last_error = e
                continue
        raise LLMError(f"所有候选模型都调用失败,最后一次错误: {last_error}")


def extract_json(text: str) -> dict:
    """从 LLM 输出里抽取 JSON 对象,容忍 ```json 包裹与前后缀文本。"""
    s = text.strip()
    if s.startswith("```"):
        # 去掉首行 ``` 或 ```json
        first_nl = s.find("\n")
        if first_nl > 0:
            s = s[first_nl + 1 :]
        if s.rstrip().endswith("```"):
            s = s.rstrip()[:-3]
    s = s.strip()
    # 找到第一个 { 与最后一个 } 之间
    start = s.find("{")
    end = s.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise LLMError(f"模型输出无法解析为 JSON: {text[:200]}")
    return json.loads(s[start : end + 1])
