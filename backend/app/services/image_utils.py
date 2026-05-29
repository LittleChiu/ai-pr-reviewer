"""PR 描述中图片 URL 的提取。"""

from __future__ import annotations

import re

# 匹配 markdown 图片: ![alt](url)
_MD_IMAGE_RE = re.compile(r"!\[.*?\]\((https?://[^\s)]+)\)")
# 匹配 HTML img 标签: <img src="url">
_HTML_IMG_RE = re.compile(r"""<img[^>]*src=["'](https?://[^"'\s>]+)["'][^>]*>""", re.IGNORECASE)


def extract_image_urls(body: str) -> list[str]:
    """从 PR body 中抽出所有图片 URL,去重并保持原始顺序。"""
    urls: list[str] = []
    seen: set[str] = set()
    for url in _MD_IMAGE_RE.findall(body):
        if url not in seen:
            seen.add(url)
            urls.append(url)
    for url in _HTML_IMG_RE.findall(body):
        if url not in seen:
            seen.add(url)
            urls.append(url)
    return urls
