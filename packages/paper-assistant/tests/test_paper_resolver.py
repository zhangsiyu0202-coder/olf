"""
 * File: test_paper_resolver.py
 * Module: packages/paper-assistant (discovery -> readable 解析测试)
 *
 * Responsibility:
 *   - 验证 OpenAlex 发现源的精确标识提取、可读源解析和 metadata-only 回退行为。
 *
 * Last Updated:
 *   - 2026-03-11 by Codex - 收缩为 OpenAlex 解析测试
"""

from __future__ import annotations

import paper_core
from paper_resolver import collect_identifier_candidates, resolve_readable_paper_id


def test_collect_identifier_candidates_extracts_explicit_ids() -> None:
    paper = {
        "paperId": "openalex:W123",
        "doi": "10.48550/arXiv.2501.00001",
        "abstractUrl": "https://example.com/paper",
    }
    raw_record = {
        "ids": {
            "pmid": "https://pubmed.ncbi.nlm.nih.gov/123456/",
            "pmcid": "https://pmc.ncbi.nlm.nih.gov/articles/PMC7654321/",
        },
        "primary_location": {
            "landing_page_url": "https://arxiv.org/abs/2501.00001",
        },
    }

    candidates = collect_identifier_candidates(paper, raw_record)

    assert "2501.00001" in candidates["arxiv_ids"]
    assert "123456" in candidates["pmids"]
    assert "PMC7654321" in candidates["pmcids"]
    assert "10.48550/arxiv.2501.00001" in candidates["dois"]


def test_resolve_readable_paper_id_prefers_arxiv_when_both_exact(monkeypatch) -> None:
    monkeypatch.setattr("paper_resolver.resolve_arxiv_exact_match", lambda arxiv_ids: "arxiv:2501.00001")
    monkeypatch.setattr("paper_resolver.resolve_pubmed_exact_match", lambda dois, pmids, pmcids: "pubmed:123456")

    resolved = resolve_readable_paper_id(
        {
            "paperId": "openalex:W123",
            "doi": "10.48550/arXiv.2501.00001",
            "abstractUrl": "https://pubmed.ncbi.nlm.nih.gov/123456/",
        }
    )

    assert resolved == "arxiv:2501.00001"


def test_load_openalex_paper_returns_resolved_readable_paper(monkeypatch) -> None:
    monkeypatch.setattr(
        paper_core,
        "request_openalex_work",
        lambda source_id: {
            "id": "https://openalex.org/W123",
            "display_name": "OpenAlex Detail",
            "publication_year": 2024,
            "doi": "https://doi.org/10.48550/arXiv.2501.00001",
        },
    )
    monkeypatch.setattr(paper_core, "resolve_readable_paper_id", lambda paper, raw_record: "arxiv:2501.00001")
    monkeypatch.setattr(
        paper_core,
        "load_arxiv_paper",
        lambda source_id, max_chars: {
            "paperId": f"arxiv:{source_id}",
            "source": "arxiv",
            "sourceLabel": "arXiv",
            "sourceId": source_id,
            "title": "Resolved arXiv paper",
            "authors": ["Alice"],
            "published": "2025-01-01",
            "summary": "summary",
            "abstractUrl": "https://arxiv.org/abs/2501.00001",
            "pdfUrl": "https://arxiv.org/pdf/2501.00001.pdf",
            "doi": "10.48550/arXiv.2501.00001",
            "venue": None,
            "fullTextAvailable": True,
            "accessStatus": "pdf",
            "content": "content",
            "contentSource": "arxiv_loader",
            "warning": None,
        },
    )

    paper = paper_core.load_openalex_paper("W123", 4000)

    assert paper["paperId"] == "arxiv:2501.00001"
    assert paper["source"] == "arxiv"


def test_build_bibtex_falls_back_to_metadata_only_for_unresolved_discovery(monkeypatch) -> None:
    monkeypatch.setattr(
        paper_core,
        "load_paper",
        lambda paper_id, max_chars: (_ for _ in ()).throw(ValueError("未找到可读来源")),
    )
    monkeypatch.setattr(
        paper_core,
        "load_paper_metadata",
        lambda paper_id, max_chars=6000: {
            "paper": {
                "paperId": "openalex:W123",
                "source": "openalex",
                "sourceLabel": "OpenAlex",
                "sourceId": "W123",
                "title": "Metadata only paper",
                "authors": ["Alice Smith"],
                "published": "2024",
                "summary": "summary",
                "abstractUrl": "https://openalex.org/W123",
                "pdfUrl": None,
                "doi": "10.1000/openalex",
                "venue": "Venue X",
                "fullTextAvailable": False,
                "accessStatus": "metadata_only",
                "content": "summary",
                "contentSource": "openalex_metadata",
                "warning": "metadata only",
            }
        },
    )

    payload = paper_core.build_bibtex("openalex:W123")

    assert payload["paperId"] == "openalex:W123"
    assert "10.1000/openalex" in payload["bibtex"]


#
# Code Review:
# - 这些测试直接围绕“精确解析 + metadata 回退”写断言，覆盖了本次架构收缩后最关键的 discovery 行为。
# - 解析器和 `paper_core` 之间的边界被分别测试，能防止后续有人把弱匹配、爬虫抓取或随机优先级悄悄加回主链路。
