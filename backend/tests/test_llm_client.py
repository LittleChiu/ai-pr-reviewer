import pytest

from app.services.llm_client import extract_json


def test_extract_json_plain() -> None:
    s = '{"summary": "hi", "highlights": []}'
    d = extract_json(s)
    assert d["summary"] == "hi"
    assert d["highlights"] == []


def test_extract_json_with_markdown_fence() -> None:
    s = '```json\n{"a": 1}\n```'
    assert extract_json(s) == {"a": 1}


def test_extract_json_with_prose_around() -> None:
    s = '当然!这是结果:\n{"x": 2}\n希望帮到你。'
    assert extract_json(s) == {"x": 2}


def test_extract_json_with_fence_no_lang() -> None:
    s = '```\n{"k": "v"}\n```'
    assert extract_json(s) == {"k": "v"}


def test_extract_json_invalid_raises() -> None:
    from app.services.llm_client import LLMError

    with pytest.raises(LLMError):
        extract_json("没有 JSON 内容")


def test_extract_json_smart_quotes_recovered() -> None:
    """LLM 偶尔输出中文'智能引号',解析失败时应该自动替换。"""
    bad = '{"summary": “hello”, "v": 1}'
    d = extract_json(bad)
    assert d["v"] == 1
    assert d["summary"] == "hello"


def test_extract_json_control_chars_recovered() -> None:
    """JSON 字符串里夹了真实控制字符(LLM 输出常见),应被剥掉。"""
    bad = '{"summary": "a\x07b", "v": 1}'
    d = extract_json(bad)
    assert d["v"] == 1
    assert "a" in d["summary"] and "b" in d["summary"]
