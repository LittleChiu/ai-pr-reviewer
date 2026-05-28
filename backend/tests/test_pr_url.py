import pytest

from app.services.pr_url import parse_pr_url


@pytest.mark.parametrize(
    "url,owner,repo,number",
    [
        ("https://github.com/openai/openai-python/pull/1234", "openai", "openai-python", 1234),
        ("https://github.com/a/b/pull/1/", "a", "b", 1),
        ("http://github.com/a-b/c.d/pull/9", "a-b", "c.d", 9),
        ("LittleChiu/ai-pr-reviewer#7", "LittleChiu", "ai-pr-reviewer", 7),
    ],
)
def test_parse_pr_url_valid(url: str, owner: str, repo: str, number: int) -> None:
    ref = parse_pr_url(url)
    assert ref.owner == owner
    assert ref.repo == repo
    assert ref.number == number
    assert str(ref) == f"{owner}/{repo}#{number}"
    assert ref.slug == f"{owner}/{repo}"


@pytest.mark.parametrize(
    "url",
    [
        "",
        "   ",
        "not a url",
        "https://github.com/openai/openai-python/issues/1234",
        "https://gitlab.com/x/y/-/merge_requests/3",
        "https://github.com/openai/openai-python/pull/abc",
    ],
)
def test_parse_pr_url_invalid(url: str) -> None:
    with pytest.raises(ValueError):
        parse_pr_url(url)
