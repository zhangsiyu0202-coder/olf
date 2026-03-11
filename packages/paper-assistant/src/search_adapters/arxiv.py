"""
 * File: arxiv.py
 * Module: packages/paper-assistant (arXiv 搜索 adapter)
 *
 * Responsibility:
 *   - 使用 `arxiv` 原生 Python 包完成 arXiv 论文发现搜索。
 *   - 负责 arXiv 特有的 query / id_list 兼容和字段映射，不让聚合层感知底层差异。
 *
 * Dependencies:
 *   - arxiv
 *   - search_contracts
 *
 * Last Updated:
 *   - 2026-03-11 by Codex - 放开来源内部结果上限以匹配聚合层 limit
"""

from __future__ import annotations

import re
from typing import Any

import arxiv

from search_contracts import (
    ARXIV_SOURCE,
    MAX_RESULTS_PER_SOURCE,
    build_generic_warning,
    normalize_authors,
    normalize_paper_payload,
    trim_text,
)

ARXIV_ID_PATTERN = re.compile(r"^(?:arxiv:)?(?:\d{4}\.\d{4,5}|[a-z\-]+(?:\.[A-Z]{2})?/\d{7})(?:v\d+)?$", re.IGNORECASE)


def normalize_arxiv_entry_id(entry_id: str | None, paper_id: str | None = None) -> str | None:
    if entry_id:
        return entry_id
    if paper_id:
        return f"https://arxiv.org/abs/{paper_id}"
    return None


def build_arxiv_pdf_url(entry_id: str | None, paper_id: str | None = None) -> str | None:
    normalized_abs_url = normalize_arxiv_entry_id(entry_id, paper_id)
    if not normalized_abs_url:
        return None
    return normalized_abs_url.replace("/abs/", "/pdf/") + ".pdf"


def looks_like_arxiv_id(query: str) -> bool:
    return bool(ARXIV_ID_PATTERN.fullmatch((query or "").strip()))


def normalize_arxiv_result(result: Any) -> dict[str, Any]:
    entry_id = str(getattr(result, "entry_id", "") or "").strip() or None
    source_id = ""
    if entry_id and "/abs/" in entry_id:
        source_id = entry_id.rsplit("/abs/", 1)[-1]
    if not source_id:
        pdf_url = str(getattr(result, "pdf_url", "") or "").strip()
        if pdf_url and "/pdf/" in pdf_url:
            source_id = pdf_url.rsplit("/pdf/", 1)[-1].replace(".pdf", "")
    if not source_id:
        raise ValueError("arXiv 结果缺少可用 ID")

    pdf_url = str(getattr(result, "pdf_url", "") or "").strip() or build_arxiv_pdf_url(entry_id, source_id)
    authors = normalize_authors([{"name": getattr(author, "name", "")} for author in getattr(result, "authors", [])])
    published = getattr(result, "published", None)

    return normalize_paper_payload(
        source=ARXIV_SOURCE,
        source_id=source_id,
        title=str(getattr(result, "title", "") or "Untitled"),
        authors=authors,
        published=published.date().isoformat() if published else None,
        summary=trim_text(str(getattr(result, "summary", "") or ""), 1800),
        abstract_url=normalize_arxiv_entry_id(entry_id, source_id),
        pdf_url=pdf_url,
        doi=str(getattr(result, "doi", "") or "") or None,
        venue=None,
        content=None,
        content_source=None,
        warning=build_generic_warning(ARXIV_SOURCE, pdf_url),
        access_status="pdf" if pdf_url else "abstract_only",
    )


class ArxivSearchAdapter:
    source = ARXIV_SOURCE

    def __init__(self) -> None:
        self.client = arxiv.Client()

    def _build_search(self, query: str, limit: int) -> arxiv.Search:
        normalized_query = query.strip()
        if looks_like_arxiv_id(normalized_query):
            normalized_id = normalized_query.replace("arxiv:", "")
            return arxiv.Search(id_list=[normalized_id])

        return arxiv.Search(
            query=normalized_query,
            max_results=max(1, min(limit, MAX_RESULTS_PER_SOURCE)),
            sort_by=arxiv.SortCriterion.Relevance,
        )

    def search(self, query: str, limit: int) -> list[dict[str, Any]]:
        search = self._build_search(query, limit)
        results: list[dict[str, Any]] = []
        for result in self.client.results(search):
            try:
                results.append(normalize_arxiv_result(result))
            except Exception:
                continue
            if len(results) >= max(1, min(limit, MAX_RESULTS_PER_SOURCE)):
                break
        return results


#
# Code Review:
# - arXiv 搜索改为直接走原生包后，检索链路从“我们 -> LangChain -> arXiv”缩短为“我们 -> arXiv”，更利于排查和控行为。
# - 精确 ID 查询和关键词搜索都留在 adapter 内部消化，聚合层只看统一输出，不再关心 arXiv 查询语法分支。
# - 内部结果上限现在跟随统一常量，而不是写死在 adapter 内部，避免前端把 limit 提高后这里仍悄悄截断成个位数。
