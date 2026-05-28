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
