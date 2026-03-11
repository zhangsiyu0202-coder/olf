"""
 * File: openalex.py
 * Module: packages/paper-assistant (OpenAlex 搜索 adapter)
 *
 * Responsibility:
 *   - 提供 OpenAlex 论文发现搜索，优先尝试 `PyAlex`，失败后回退官方 HTTP API。
 *   - 负责 OpenAlex 抽象字段到统一论文搜索结构的映射。
 *
 * Dependencies:
 *   - httpx
 *   - search_contracts
 *
 * Last Updated:
 *   - 2026-03-11 by Codex - 将来源内部结果上限提升到统一配置
"""

from __future__ import annotations

import os
from typing import Any

import httpx

try:
    from pyalex import Works
except ImportError:  # pragma: no cover - runtime fallback
    Works = None

from search_contracts import (
    MAX_RESULTS_PER_SOURCE,
    OPENALEX_SOURCE,
    PAPER_REQUEST_TIMEOUT_S,
    build_generic_warning,
    normalize_paper_payload,
    trim_text,
)

OPENALEX_API_URL = "https://api.openalex.org/works"


def reconstruct_openalex_abstract(abstract_inverted_index: dict[str, list[int]] | None) -> str:
    if not isinstance(abstract_inverted_index, dict) or not abstract_inverted_index:
        return ""
    indexed_words: list[tuple[int, str]] = []
    for word, positions in abstract_inverted_index.items():
        if not isinstance(positions, list):
            continue
        for position in positions:
            if isinstance(position, int):
                indexed_words.append((position, word))
    indexed_words.sort(key=lambda item: item[0])
    return " ".join(word for _, word in indexed_words)


def normalize_openalex_doi(value: str | None) -> str | None:
    normalized = str(value or "").strip()
    if not normalized:
        return None
    return normalized.replace("https://doi.org/", "").replace("http://doi.org/", "")


def normalize_openalex_source_id(value: str | None) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError("OpenAlex 结果缺少 id")
    return normalized.rstrip("/").rsplit("/", 1)[-1]


def normalize_openalex_authors(raw_authorships: Any) -> list[str]:
    authors: list[str] = []
    if not isinstance(raw_authorships, list):
        return authors
    for authorship in raw_authorships:
        if not isinstance(authorship, dict):
            continue
        author = authorship.get("author") or {}
        name = str(author.get("display_name") or "").strip()
        if name:
            authors.append(name)
    return authors


def normalize_openalex_item(item: dict[str, Any]) -> dict[str, Any]:
    source_id = normalize_openalex_source_id(item.get("id"))
    primary_location = item.get("primary_location") or {}
    primary_source = primary_location.get("source") or {}
    landing_page_url = str(primary_location.get("landing_page_url") or "").strip() or None
    summary = trim_text(reconstruct_openalex_abstract(item.get("abstract_inverted_index")), 2200)
    access_status = "abstract_only" if summary else "metadata_only"

    return normalize_paper_payload(
        source=OPENALEX_SOURCE,
        source_id=source_id,
        title=str(item.get("display_name") or "Untitled"),
        authors=normalize_openalex_authors(item.get("authorships")),
        published=str(item.get("publication_year")) if item.get("publication_year") else None,
        summary=summary,
        abstract_url=landing_page_url or str(item.get("id") or "").strip() or None,
        pdf_url=None,
        doi=normalize_openalex_doi(item.get("doi")),
        venue=str(primary_source.get("display_name") or "") or None,
        content=summary,
        content_source="openalex_abstract" if summary else "openalex_metadata",
        warning=build_generic_warning(OPENALEX_SOURCE, None),
        access_status=access_status,
    )


class OpenAlexSearchAdapter:
    source = OPENALEX_SOURCE

    def _search_with_pyalex(self, query: str, limit: int) -> list[dict[str, Any]]:
        if Works is None:
            raise RuntimeError("当前环境未安装 pyalex")
        records = Works().search(query[:300]).get(per_page=max(1, min(limit, MAX_RESULTS_PER_SOURCE)))
        if not isinstance(records, list):
            raise ValueError("PyAlex 返回结果格式异常")
        return [normalize_openalex_item(item) for item in records if isinstance(item, dict)]

    def _search_with_http(self, query: str, limit: int) -> list[dict[str, Any]]:
        params = {
            "search": query[:300],
            "per-page": max(1, min(limit, MAX_RESULTS_PER_SOURCE)),
        }
        mailto = os.environ.get("OPENALEX_EMAIL", "").strip()
        if mailto:
            params["mailto"] = mailto
        with httpx.Client(timeout=PAPER_REQUEST_TIMEOUT_S, follow_redirects=True) as client:
            response = client.get(
                OPENALEX_API_URL,
                params=params,
                headers={"User-Agent": "overleaf-clone-paper-service/0.1"},
            )
            response.raise_for_status()
            payload = response.json()
        return [normalize_openalex_item(item) for item in payload.get("results", []) if isinstance(item, dict)]

    def search(self, query: str, limit: int) -> list[dict[str, Any]]:
        try:
            return self._search_with_pyalex(query, limit)
        except Exception:
            return self._search_with_http(query, limit)


#
# Code Review:
# - OpenAlex adapter 先尝试 `PyAlex`，失败后再走官方 HTTP API，既符合“有包接包”的策略，也避免运行环境缺少包时整条来源直接报废。
# - OpenAlex 在当前产品里被收缩为“发现源”，因此即便上游给了 `pdf_url`，这里也不把它直接暴露成可读全文能力。
# - `primary_location.source` 在 OpenAlex 结果里并不总是对象，映射时必须显式兜底为 `{}`，否则会把单条脏记录放大成整来源失败。
# - adapter 不再把 `per-page` 卡死在个位数，能跟随聚合层按需放大召回规模。
