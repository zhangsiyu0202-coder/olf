"""
 * File: test_search_orchestrator.py
 * Module: packages/paper-assistant (论文搜索聚合层测试)
 *
 * Responsibility:
 *   - 验证三源搜索聚合层的去重、来源降级和状态输出行为。
 *   - 覆盖轻量规则重排的开关、topK 行为和配置回退。
 *
 * Last Updated:
 *   - 2026-03-11 by Codex - 新增默认 limit 与无模型重排行为断言
"""

from __future__ import annotations

from search_contracts import (
    ARXIV_SOURCE,
    DEFAULT_SEARCH_LIMIT,
    MAX_SEARCH_LIMIT,
    OPENALEX_SOURCE,
    PUBMED_SOURCE,
    build_english_query_expansion,
)
from search_orchestrator import search_papers


class FakeAdapter:
    def __init__(self, source: str, results=None, error: Exception | None = None) -> None:
        self.source = source
        self._results = results or []
        self._error = error

    def search(self, query: str, limit: int):  # noqa: ANN201
        if self._error:
            raise self._error
        return self._results[:limit]


def test_search_papers_merges_and_dedupes_by_doi(monkeypatch) -> None:
    monkeypatch.setattr(
        "search_orchestrator.build_search_adapters",
        lambda: {
            ARXIV_SOURCE: FakeAdapter(
                ARXIV_SOURCE,
                results=[
                    {
                        "paperId": "arxiv:1234.5678",
                        "source": ARXIV_SOURCE,
                        "sourceId": "1234.5678",
                        "sourceLabel": "arXiv",
                        "title": "A shared paper",
                        "authors": ["Alice"],
                        "published": "2025-01-01",
                        "summary": "arxiv summary",
                        "abstractUrl": "https://arxiv.org/abs/1234.5678",
                        "pdfUrl": "https://arxiv.org/pdf/1234.5678.pdf",
                        "doi": "10.1000/shared",
                    }
                ],
            ),
            OPENALEX_SOURCE: FakeAdapter(
                OPENALEX_SOURCE,
                results=[
                    {
                        "paperId": "openalex:Wshared",
                        "source": OPENALEX_SOURCE,
                        "sourceId": "10.1000/shared",
                        "sourceLabel": "OpenAlex",
                        "title": "A shared paper",
                        "authors": ["Alice"],
                        "published": "2024-12-01",
                        "summary": "openalex summary",
                        "abstractUrl": "https://doi.org/10.1000/shared",
                        "pdfUrl": None,
                        "doi": "10.1000/shared",
                    }
                ],
            ),
        },
    )

    payload = search_papers("shared", 6, [ARXIV_SOURCE, OPENALEX_SOURCE])

    assert payload["sources"] == [ARXIV_SOURCE, OPENALEX_SOURCE]
    assert len(payload["results"]) == 1
    assert len(payload["sourceStatuses"]) == 2
    assert all(status["ok"] for status in payload["sourceStatuses"])


def test_search_papers_keeps_partial_results_when_one_source_fails(monkeypatch) -> None:
    monkeypatch.setattr(
        "search_orchestrator.build_search_adapters",
        lambda: {
            ARXIV_SOURCE: FakeAdapter(
                ARXIV_SOURCE,
                results=[
                    {
                        "paperId": "arxiv:1",
                        "source": ARXIV_SOURCE,
                        "sourceId": "1",
                        "sourceLabel": "arXiv",
                        "title": "Useful result",
                        "authors": ["Alice"],
                        "published": "2025",
                        "summary": "summary",
                        "abstractUrl": "https://arxiv.org/abs/1",
                        "pdfUrl": None,
                    }
                ],
            ),
            PUBMED_SOURCE: FakeAdapter(PUBMED_SOURCE, error=RuntimeError("timeout from pubmed")),
        },
    )

    payload = search_papers("query", 6, [ARXIV_SOURCE, PUBMED_SOURCE])

    assert len(payload["results"]) == 1
    degraded_status = next(status for status in payload["sourceStatuses"] if status["source"] == PUBMED_SOURCE)
    assert degraded_status["ok"] is False
    assert degraded_status["errorMessage"] == "timeout from pubmed"


def test_search_papers_raises_when_all_sources_fail(monkeypatch) -> None:
    monkeypatch.setattr(
        "search_orchestrator.build_search_adapters",
        lambda: {
            ARXIV_SOURCE: FakeAdapter(ARXIV_SOURCE, error=RuntimeError("arxiv down")),
            PUBMED_SOURCE: FakeAdapter(PUBMED_SOURCE, error=RuntimeError("pubmed down")),
        },
    )

    try:
        search_papers("query", 6, [ARXIV_SOURCE, PUBMED_SOURCE])
    except ValueError as error:
        assert "down" in str(error)
    else:  # pragma: no cover - defensive branch
        raise AssertionError("expected search_papers to raise when all sources fail")


def test_search_papers_preserves_source_relevance_order_instead_of_date_sort(monkeypatch) -> None:
    monkeypatch.setenv("PAPER_RERANK_MODE", "none")
    monkeypatch.setattr(
        "search_orchestrator.build_search_adapters",
        lambda: {
            ARXIV_SOURCE: FakeAdapter(
                ARXIV_SOURCE,
                results=[
                    {
                        "paperId": "arxiv:older-but-relevant",
                        "source": ARXIV_SOURCE,
                        "sourceId": "older-but-relevant",
                        "sourceLabel": "arXiv",
                        "title": "Older but top ranked",
                        "authors": ["Alice"],
                        "published": "2015-01-01",
                        "summary": "summary",
                        "abstractUrl": "https://arxiv.org/abs/older-but-relevant",
                        "pdfUrl": None,
                    }
                ],
            ),
            PUBMED_SOURCE: FakeAdapter(
                PUBMED_SOURCE,
                results=[
                    {
                        "paperId": "pubmed:newer",
                        "source": PUBMED_SOURCE,
                        "sourceId": "newer",
                        "sourceLabel": "PubMed",
                        "title": "Newer paper",
                        "authors": ["Bob"],
                        "published": "2025-01-01",
                        "summary": "summary",
                        "abstractUrl": "https://pubmed.ncbi.nlm.nih.gov/newer/",
                        "pdfUrl": None,
                    }
                ],
            ),
        },
    )

    payload = search_papers("query", 2, [ARXIV_SOURCE, PUBMED_SOURCE])

    assert [item["paperId"] for item in payload["results"]] == ["arxiv:older-but-relevant", "pubmed:newer"]


def test_search_papers_expands_chinese_queries_for_readable_sources(monkeypatch) -> None:
    monkeypatch.setenv("PAPER_RERANK_MODE", "none")
    calls: dict[str, list[tuple[str, int]]] = {
        ARXIV_SOURCE: [],
        PUBMED_SOURCE: [],
        OPENALEX_SOURCE: [],
    }

    class RecordingAdapter(FakeAdapter):
        def search(self, query: str, limit: int):  # noqa: ANN201
            calls[self.source].append((query, limit))
            if self.source == OPENALEX_SOURCE:
                return [
                    {
                        "paperId": "openalex:W1",
                        "source": OPENALEX_SOURCE,
                        "sourceId": "W1",
                        "sourceLabel": "OpenAlex",
                        "title": "OpenAlex result",
                        "authors": ["Carol"],
                        "published": "2024",
                        "summary": "summary",
                        "abstractUrl": "https://openalex.org/W1",
                        "pdfUrl": None,
                    }
                ]
            if query == "deep learning":
                return [
                    {
                        "paperId": f"{self.source}:match",
                        "source": self.source,
                        "sourceId": "match",
                        "sourceLabel": self.source,
                        "title": f"{self.source} result",
                        "authors": ["Alice"],
                        "published": "2024",
                        "summary": "summary",
                        "abstractUrl": f"https://example.com/{self.source}",
                        "pdfUrl": None,
                    }
                ]
            return []

    monkeypatch.setattr(
        "search_orchestrator.build_search_adapters",
        lambda: {
            ARXIV_SOURCE: RecordingAdapter(ARXIV_SOURCE),
            PUBMED_SOURCE: RecordingAdapter(PUBMED_SOURCE),
            OPENALEX_SOURCE: RecordingAdapter(OPENALEX_SOURCE),
        },
    )

    payload = search_papers("深度学习", 500, [ARXIV_SOURCE, PUBMED_SOURCE, OPENALEX_SOURCE])

    assert [item["paperId"] for item in payload["results"]] == ["arxiv:match", "pubmed:match", "openalex:W1"]
    assert calls[ARXIV_SOURCE][0] == ("deep learning", 167)
    assert calls[PUBMED_SOURCE][0] == ("deep learning", 167)
    assert calls[OPENALEX_SOURCE][0] == ("深度学习", 167)
    assert all(query != "深度学习" for query, _ in calls[ARXIV_SOURCE][:1])
    assert all(query != "深度学习" for query, _ in calls[PUBMED_SOURCE][:1])


def test_build_english_query_expansion_covers_computer_keyword() -> None:
    assert build_english_query_expansion("计算机") == "computer"
    assert build_english_query_expansion("计算机科学") == "computer science"


def test_search_contract_limits_are_200_default_and_500_cap() -> None:
    assert DEFAULT_SEARCH_LIMIT == 200
    assert MAX_SEARCH_LIMIT == 500


def test_search_papers_heuristic_reranks_top_k_globally(monkeypatch) -> None:
    monkeypatch.setenv("PAPER_RERANK_MODE", "heuristic")
    monkeypatch.setenv("PAPER_RERANK_TOP_K", "200")
    monkeypatch.setattr(
        "search_orchestrator.build_search_adapters",
        lambda: {
            ARXIV_SOURCE: FakeAdapter(
                ARXIV_SOURCE,
                results=[
                    {
                        "paperId": "arxiv:generic",
                        "source": ARXIV_SOURCE,
                        "sourceId": "generic",
                        "sourceLabel": "arXiv",
                        "title": "A generic model paper",
                        "authors": ["Alice"],
                        "published": "2024",
                        "summary": "generic summary",
                        "abstractUrl": "https://arxiv.org/abs/generic",
                        "pdfUrl": None,
                    },
                    {
                        "paperId": "arxiv:deep-learning",
                        "source": ARXIV_SOURCE,
                        "sourceId": "deep-learning",
                        "sourceLabel": "arXiv",
                        "title": "Deep learning for vision",
                        "authors": ["Bob"],
                        "published": "2024",
                        "summary": "deep learning benchmark",
                        "abstractUrl": "https://arxiv.org/abs/deep-learning",
                        "pdfUrl": None,
                    },
                ],
            )
        },
    )

    payload = search_papers("deep learning", 2, [ARXIV_SOURCE])

    assert [item["paperId"] for item in payload["results"]] == ["arxiv:deep-learning", "arxiv:generic"]


def test_search_papers_none_mode_keeps_merge_order(monkeypatch) -> None:
    monkeypatch.setenv("PAPER_RERANK_MODE", "none")
    monkeypatch.setattr(
        "search_orchestrator.build_search_adapters",
        lambda: {
            ARXIV_SOURCE: FakeAdapter(
                ARXIV_SOURCE,
                results=[
                    {
                        "paperId": "arxiv:generic",
                        "source": ARXIV_SOURCE,
                        "sourceId": "generic",
                        "sourceLabel": "arXiv",
                        "title": "A generic model paper",
                        "authors": ["Alice"],
                        "published": "2024",
                        "summary": "generic summary",
                        "abstractUrl": "https://arxiv.org/abs/generic",
                        "pdfUrl": None,
                    },
                    {
                        "paperId": "arxiv:deep-learning",
                        "source": ARXIV_SOURCE,
                        "sourceId": "deep-learning",
                        "sourceLabel": "arXiv",
                        "title": "Deep learning for vision",
                        "authors": ["Bob"],
                        "published": "2024",
                        "summary": "deep learning benchmark",
                        "abstractUrl": "https://arxiv.org/abs/deep-learning",
                        "pdfUrl": None,
                    },
                ],
            )
        },
    )

    payload = search_papers("deep learning", 2, [ARXIV_SOURCE])

    assert [item["paperId"] for item in payload["results"]] == ["arxiv:generic", "arxiv:deep-learning"]


def test_search_papers_heuristic_only_reorders_head_with_top_k(monkeypatch) -> None:
    monkeypatch.setenv("PAPER_RERANK_MODE", "heuristic")
    monkeypatch.setenv("PAPER_RERANK_TOP_K", "2")
    monkeypatch.setattr(
        "search_orchestrator.build_search_adapters",
        lambda: {
            ARXIV_SOURCE: FakeAdapter(
                ARXIV_SOURCE,
                results=[
                    {
                        "paperId": "arxiv:generic",
                        "source": ARXIV_SOURCE,
                        "sourceId": "generic",
                        "sourceLabel": "arXiv",
                        "title": "A generic model paper",
                        "authors": ["Alice"],
                        "published": "2024",
                        "summary": "generic summary",
                        "abstractUrl": "https://arxiv.org/abs/generic",
                        "pdfUrl": None,
                    },
                    {
                        "paperId": "arxiv:deep-learning",
                        "source": ARXIV_SOURCE,
                        "sourceId": "deep-learning",
                        "sourceLabel": "arXiv",
                        "title": "Deep learning for vision",
                        "authors": ["Bob"],
                        "published": "2024",
                        "summary": "deep learning benchmark",
                        "abstractUrl": "https://arxiv.org/abs/deep-learning",
                        "pdfUrl": None,
                    },
                    {
                        "paperId": "arxiv:tail-1",
                        "source": ARXIV_SOURCE,
                        "sourceId": "tail-1",
                        "sourceLabel": "arXiv",
                        "title": "Tail paper one",
                        "authors": ["Carol"],
                        "published": "2024",
                        "summary": "tail summary one",
                        "abstractUrl": "https://arxiv.org/abs/tail-1",
                        "pdfUrl": None,
                    },
                    {
                        "paperId": "arxiv:tail-2",
                        "source": ARXIV_SOURCE,
                        "sourceId": "tail-2",
                        "sourceLabel": "arXiv",
                        "title": "Tail paper two",
                        "authors": ["Dave"],
                        "published": "2024",
                        "summary": "tail summary two",
                        "abstractUrl": "https://arxiv.org/abs/tail-2",
                        "pdfUrl": None,
                    },
                ],
            )
        },
    )

    payload = search_papers("deep learning", 4, [ARXIV_SOURCE])

    assert [item["paperId"] for item in payload["results"]] == [
        "arxiv:deep-learning",
        "arxiv:generic",
        "arxiv:tail-1",
        "arxiv:tail-2",
    ]


def test_search_papers_invalid_rerank_config_falls_back(monkeypatch) -> None:
    monkeypatch.setenv("PAPER_RERANK_MODE", "bad_mode")
    monkeypatch.setenv("PAPER_RERANK_TOP_K", "not-a-number")
    monkeypatch.setattr(
        "search_orchestrator.build_search_adapters",
        lambda: {
            ARXIV_SOURCE: FakeAdapter(
                ARXIV_SOURCE,
                results=[
                    {
                        "paperId": "arxiv:generic",
                        "source": ARXIV_SOURCE,
                        "sourceId": "generic",
                        "sourceLabel": "arXiv",
                        "title": "A generic model paper",
                        "authors": ["Alice"],
                        "published": "2024",
                        "summary": "generic summary",
                        "abstractUrl": "https://arxiv.org/abs/generic",
                        "pdfUrl": None,
                    },
                    {
                        "paperId": "arxiv:deep-learning",
                        "source": ARXIV_SOURCE,
                        "sourceId": "deep-learning",
                        "sourceLabel": "arXiv",
                        "title": "Deep learning for vision",
                        "authors": ["Bob"],
                        "published": "2024",
                        "summary": "deep learning benchmark",
                        "abstractUrl": "https://arxiv.org/abs/deep-learning",
                        "pdfUrl": None,
                    },
                ],
            )
        },
    )

    payload = search_papers("deep learning", 2, [ARXIV_SOURCE])

    assert [item["paperId"] for item in payload["results"]] == ["arxiv:deep-learning", "arxiv:generic"]


#
# Code Review:
# - 聚合层测试聚焦在“结果合并 + 来源状态”而不是网络细节，能稳住本次重构最关键的公共行为。
# - 单源失败继续返回部分结果的断言能防止后续有人又把多源搜索改回“一个来源挂了全链路报错”的脆弱实现。
# - 规则重排相关测试同时覆盖了 `heuristic / none`、topK 和非法配置回退，能防止后续重构时把默认行为悄悄改坏却没人发现。
