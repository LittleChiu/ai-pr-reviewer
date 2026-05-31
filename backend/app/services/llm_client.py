"""LLM 客户端:封装 OpenAI 兼容协议。

单模型调用,无候选/fallback 链。响应固定要求 JSON 模式。
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from json import JSONDecodeError, JSONDecoder

from openai import AsyncOpenAI

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_JSON_REPAIR_SYSTEM = """你是一个 JSON 修复器。
你的任务不是重新分析问题，而是把给定内容整理成**唯一一个合法 JSON 对象**。
要求：
1. 不要输出 markdown 代码块
2. 不要输出解释
3. 不要补充原文不存在的新结论
4. 仅在不改变原意的前提下修复格式问题
"""


class LLMError(Exception):
    pass


@dataclass
class TokenUsage:
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    llm_calls: int = 0

    def add(self, other: TokenUsage) -> None:
        self.prompt_tokens += other.prompt_tokens
        self.completion_tokens += other.completion_tokens
        self.total_tokens += other.total_tokens
        self.llm_calls += other.llm_calls


@dataclass
class LLMResponse:
    content: str
    model: str
    usage: TokenUsage = field(default_factory=TokenUsage)


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
        model: str,
        system: str,
        user: str,
        max_tokens: int = 4096,
        temperature: float = 0.2,
    ) -> LLMResponse:
        """调用单个模型,要求输出 JSON 字符串。"""
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
        usage = TokenUsage()
        if resp.usage is not None:
            usage.prompt_tokens = resp.usage.prompt_tokens or 0
            usage.completion_tokens = resp.usage.completion_tokens or 0
            usage.total_tokens = resp.usage.total_tokens or 0
        usage.llm_calls = 1
        return LLMResponse(content=content, model=model, usage=usage)


async def chat_json_with_parse_retry(
    llm: LLMClient,
    *,
    model: str,
    system: str,
    user: str,
    max_tokens: int = 4096,
    temperature: float = 0.2,
    max_parse_retries: int = 1,
) -> tuple[dict, LLMResponse]:
    """调用模型并解析 JSON。若第一次输出格式损坏,最多发起一次修复性重试。"""
    total_usage = TokenUsage()
    repair_max_tokens = min(max_tokens, 2048)
    last_error: LLMError | None = None
    last_content = ""

    for attempt in range(max_parse_retries + 1):
        if attempt == 0:
            resp = await llm.chat_json(
                model=model,
                system=system,
                user=user,
                max_tokens=max_tokens,
                temperature=temperature,
            )
        else:
            assert last_error is not None
            logger.warning(
                "model %s returned malformed JSON; retrying repair: %s", model, last_error
            )
            resp = await llm.chat_json(
                model=model,
                system=_JSON_REPAIR_SYSTEM,
                user=_json_repair_user_prompt(last_content, last_error),
                max_tokens=repair_max_tokens,
                temperature=0,
            )

        last_content = resp.content
        if resp.usage.llm_calls == 0:
            resp.usage.llm_calls = 1
        total_usage.add(resp.usage)
        try:
            data = extract_json(resp.content)
            resp.usage = total_usage
            return data, resp
        except LLMError as err:
            last_error = err
            if attempt >= max_parse_retries:
                raise

    assert last_error is not None
    raise last_error


def extract_json(text: str) -> dict:
    """从 LLM 输出里抽取 JSON 对象,容忍 ```json 包裹与前后缀文本。

    解析失败时做一次容错重试:去掉控制字符、替换智能引号。仍失败才抛 LLMError。
    """
    s = _strip_json_fence(text.strip())
    try:
        return _extract_first_json_object(s)
    except JSONDecodeError as first_err:
        cleaned = _clean_json_like(s)
        try:
            return _extract_first_json_object(cleaned)
        except JSONDecodeError as second_err:
            raise LLMError(
                f"模型输出 JSON 解析失败(已尝试容错): {second_err}; 首次错误: {first_err}; "
                f"原文片段: {s[:200]}"
            ) from second_err


_CONTROL_CHARS_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")
_SMART_QUOTES = str.maketrans({"“": '"', "”": '"', "‘": "'", "’": "'"})


def _strip_json_fence(s: str) -> str:
    if s.startswith("```"):
        first_nl = s.find("\n")
        if first_nl > 0:
            s = s[first_nl + 1 :]
        if s.rstrip().endswith("```"):
            s = s.rstrip()[:-3]
    return s.strip()


def _extract_first_json_object(s: str) -> dict:
    decoder = JSONDecoder()
    stripped = s.strip()
    saw_left_brace = False
    first_error: JSONDecodeError | None = None

    if stripped.startswith("{"):
        saw_left_brace = True
        try:
            obj, _ = decoder.raw_decode(stripped)
            if isinstance(obj, dict):
                return obj
        except JSONDecodeError as err:
            first_error = err

    for idx, ch in enumerate(s):
        if ch != "{":
            continue
        saw_left_brace = True
        try:
            obj, _ = decoder.raw_decode(s[idx:])
            if isinstance(obj, dict):
                return obj
        except JSONDecodeError as err:
            if first_error is None:
                first_error = err

    if not saw_left_brace:
        raise LLMError(f"模型输出无法解析为 JSON: {s[:200]}")
    if first_error is not None:
        raise first_error
    raise LLMError(f"模型输出无法解析为 JSON: {s[:200]}")


def _clean_json_like(s: str) -> str:
    """LLM 输出常见的两类问题:控制字符 + 智能引号。"""
    s = _CONTROL_CHARS_RE.sub("", s)
    return s.translate(_SMART_QUOTES)


def _json_repair_user_prompt(text: str, err: Exception) -> str:
    snippet = text.strip()
    if len(snippet) > 12000:
        snippet = snippet[:12000] + "\n...(原始输出已截断)"
    return (
        "下面是一段本应为 JSON 的模型输出，但它无法被 JSON 解析器接受。\n"
        f"解析错误: {err}\n\n"
        "请在**不改变原意**的前提下，把它整理成唯一一个合法 JSON 对象。"
        "不要输出解释，不要输出 markdown。\n\n"
        "原始输出:\n"
        f"{snippet}"
    )
