"""
 * File: test_search_adapters.py
 * Module: packages/paper-assistant (论文搜索 adapter 测试)
 *
 * Responsibility:
 *   - 验证各来源 adapter 的字段映射、降级策略和回退行为。
 *
 * Last Updated:
 *   - 2026-03-11 by Codex - 收缩为三源 adapter 断言
"""

from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace

from search_adapters.arxiv import normalize_arxiv_result
from search_adapters.openalex import normalize_openalex_item
from search_adapters.pubmed import PubMedSearchAdapter


def test_normalize_arxiv_result_maps_core_fields() -> None:
    result = SimpleNamespace(
        entry_id="https://arxiv.org/abs/2501.00001v1",
        pdf_url="https://arxiv.org/pdf/2501.00001v1.pdf",
        title="Adapter Paper",
        summary="A useful abstract",
        authors=[SimpleNamespace(name="Alice"), SimpleNamespace(name="Bob")],
        published=datetime(2025, 1, 1),
        doi="10.1000/arxiv",
    )

    payload = normalize_arxiv_result(result)

    assert payload["paperId"] == "arxiv:2501.00001v1"
    assert payload["sourceLabel"] == "arXiv"
    assert payload["doi"] == "10.1000/arxiv"


def test_pubmed_adapter_normalizes_articles(monkeypatch) -> None:
    adapter = PubMedSearchAdapter()
    monkeypatch.setattr(adapter, "_search_ids", lambda query, limit: ["123456"])
    monkeypatch.setattr(
        adapter,
        "_fetch_articles",
        lambda ids: [
            {
                "MedlineCitation": {
                    "PMID": "123456",
                    "Article": {
                        "ArticleTitle": "PubMed paper",
                        "Abstract": {"AbstractText": "PubMed abstract"},
                        "AuthorList": {"Author": [{"ForeName": "Alice", "LastName": "Smith"}]},
                        "Journal": {"Title": "Journal X", "JournalIssue": {"PubDate": {"Year": "2024"}}},
                    },
                },
                "PubmedData": {"ArticleIdList": {"ArticleId": [{"@IdType": "doi", "#text": "10.1000/pubmed"}]}},
            }
        ],
    )

    payload = adapter.search("pubmed", 3)

    assert payload[0]["paperId"] == "pubmed:123456"
    assert payload[0]["authors"] == ["Alice Smith"]
    assert payload[0]["doi"] == "10.1000/pubmed"


def test_normalize_openalex_item_marks_metadata_only_without_abstract() -> None:
    payload = normalize_openalex_item(
        {
            "id": "https://openalex.org/W123",
            "display_name": "OpenAlex paper",
            "publication_year": 2024,
            "authorships": [{"author": {"display_name": "Alice"}}],
            "doi": "https://doi.org/10.1000/openalex",
            "primary_location": {"source": {"display_name": "Venue X"}},
        }
    )

    assert payload["paperId"] == "openalex:W123"
    assert payload["accessStatus"] == "metadata_only"
    assert payload["doi"] == "10.1000/openalex"


def test_normalize_openalex_item_tolerates_missing_primary_source() -> None:
    payload = normalize_openalex_item(
        {
            "id": "https://openalex.org/W456",
            "display_name": "OpenAlex without source",
            "publication_year": 2024,
            "authorships": [{"author": {"display_name": "Bob"}}],
            "primary_location": {"source": None},
        }
    )

    assert payload["paperId"] == "openalex:W456"
    assert payload["venue"] is None
    assert payload["accessStatus"] == "metadata_only"


def test_normalize_openalex_item_does_not_expose_pdf_capability() -> None:
    payload = normalize_openalex_item(
        {
            "id": "https://openalex.org/W789",
            "display_name": "OpenAlex with pdf",
            "publication_year": 2024,
            "doi": "https://doi.org/10.1000/openalex-pdf",
            "primary_location": {
                "landing_page_url": "https://publisher.example/openalex",
                "pdf_url": "https://publisher.example/openalex.pdf",
                "source": {"display_name": "Venue X"},
            },
        }
    )

    assert payload["pdfUrl"] is None
    assert payload["fullTextAvailable"] is False
    assert payload["accessStatus"] == "metadata_only"


#
# Code Review:
# - adapter 测试优先验证字段映射和元数据降级，而不是去碰真实网络，这样既稳又能直接覆盖本次重构最容易回归的地方。
# - `OpenAlex` 的 metadata-only 断言能防止后续有人为了前端好看，把发现源错误标成“可读摘要/全文”。
