"""
 * File: search_orchestrator.py
 * Module: packages/paper-assistant (论文搜索聚合层)
 *
 * Responsibility:
 *   - 统一调度各论文来源 adapter，并负责来源标准化、失败降级、去重、排序和状态汇总。
 *   - 对 `paper_core.py` 暴露稳定的 `search_papers()` 搜索入口，避免上层感知来源实现细节。
 *
 * Dependencies:
 *   - time
 *   - concurrent.futures
 *   - search_contracts
 *   - search_adapters/*
 *
 * Last Updated:
 *   - 2026-03-11 by Codex - 新增无模型规则重排，默认仅重排前 200 条
"""

from __future__ import annotations

import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

import httpx

from search_adapters.arxiv import ArxivSearchAdapter
from search_adapters.base import SearchAdapter
from search_adapters.openalex import OpenAlexSearchAdapter
from search_adapters.pubmed import PubMedSearchAdapter
from search_contracts import (
    ARXIV_SOURCE,
    DEFAULT_RERANK_MODE,
    DEFAULT_RERANK_TOP_K,
    DEFAULT_SOURCES,
    MAX_RESULTS_PER_SOURCE,
    OPENALEX_SOURCE,
    PUBMED_SOURCE,
    READABLE_SOURCES,
    build_english_query_expansion,
    build_source_status,
    dedupe_key_for_paper,
    normalize_sources,
)

TEXT_TOKEN_PATTERN = re.compile(r"[\u3400-\u9fff]+|[a-z0-9]+")
RERANK_SOURCE_PRIORS = {
    ARXIV_SOURCE: 1.0,
    PUBMED_SOURCE: 1.0,
    OPENALEX_SOURCE: 0.6,
}
RERANK_SUPPORTED_MODES = {"heuristic", "none"}
RERANK_RRF_K = 60.0
RERANK_TEXT_OVERLAP_WEIGHT = 0.02
RERANK_SOURCE_PRIOR_WEIGHT = 0.005


def build_search_adapters() -> dict[str, SearchAdapter]:
    return {
        adapter.source: adapter
        for adapter in [
            ArxivSearchAdapter(),
            PubMedSearchAdapter(),
            OpenAlexSearchAdapter(),
        ]
    }


def classify_error(error: Exception) -> str:
    if isinstance(error, httpx.TimeoutException):
        return "timeout"
    if isinstance(error, httpx.HTTPStatusError):
        if error.response.status_code == 429:
            return "rate_limited"
        return f"http_{error.response.status_code}"

    message = str(error).lower()
    if "429" in message:
        return "rate_limited"
    if "timeout" in message:
        return "timeout"
    if "not installed" in message or "未安装" in message:
        return "dependency_missing"
    return error.__class__.__name__.lower()


def build_source_query_variants(source: str, query: str) -> list[str]:
    normalized_query = str(query or "").strip()
    if source not in READABLE_SOURCES:
        return [normalized_query]

    english_expansion = build_english_query_expansion(normalized_query)
    variants: list[str] = []
    for candidate in [english_expansion, normalized_query]:
        normalized_candidate = str(candidate or "").strip()
        if normalized_candidate and normalized_candidate not in variants:
            variants.append(normalized_candidate)
    return variants or [normalized_query]


def resolve_rerank_mode() -> str:
    configured_mode = str(os.environ.get("PAPER_RERANK_MODE", DEFAULT_RERANK_MODE)).strip().lower()
    if configured_mode in RERANK_SUPPORTED_MODES:
        return configured_mode
    return DEFAULT_RERANK_MODE


def resolve_rerank_top_k() -> int:
    raw_value = str(os.environ.get("PAPER_RERANK_TOP_K", str(DEFAULT_RERANK_TOP_K))).strip()
    try:
        parsed = int(raw_value)
    except (TypeError, ValueError):
        parsed = DEFAULT_RERANK_TOP_K
    return max(1, min(parsed, MAX_RESULTS_PER_SOURCE))


def tokenize_for_rerank(text: str | None) -> set[str]:
    return set(TEXT_TOKEN_PATTERN.findall(str(text or "").lower()))


def build_source_rank_maps(source_results: dict[str, list[dict[str, Any]]]) -> dict[str, dict[str, int]]:
    source_rank_maps: dict[str, dict[str, int]] = {}
    for source, results in source_results.items():
        rank_map: dict[str, int] = {}
        for index, candidate in enumerate(results, start=1):
            key = dedupe_key_for_paper(candidate)
            if key not in rank_map:
                rank_map[key] = index
        source_rank_maps[source] = rank_map
    return source_rank_maps


def score_rrf(key: str, source_rank_maps: dict[str, dict[str, int]]) -> float:
    score = 0.0
    for rank_map in source_rank_maps.values():
        rank = rank_map.get(key)
        if rank is not None:
            score += 1.0 / (RERANK_RRF_K + float(rank))
    return score


def score_text_overlap(query_tokens: set[str], candidate: dict[str, Any]) -> float:
    if not query_tokens:
        return 0.0
    candidate_tokens = tokenize_for_rerank(f"{candidate.get('title') or ''} {candidate.get('summary') or ''}")
    if not candidate_tokens:
        return 0.0
    matched = sum(1 for token in query_tokens if token in candidate_tokens)
    return float(matched) / float(len(query_tokens))


def apply_heuristic_rerank(
    query: str,
    merged_results: list[dict[str, Any]],
    source_rank_maps: dict[str, dict[str, int]],
) -> list[dict[str, Any]]:
    if len(merged_results) <= 1 or resolve_rerank_mode() == "none":
        return merged_results

    rerank_top_k = min(len(merged_results), resolve_rerank_top_k())
    query_tokens = tokenize_for_rerank(query)
    head = merged_results[:rerank_top_k]
    tail = merged_results[rerank_top_k:]
    scored_results: list[tuple[float, int, dict[str, Any]]] = []

    for original_index, candidate in enumerate(head):
        key = dedupe_key_for_paper(candidate)
        rrf_score = score_rrf(key, source_rank_maps)
        overlap_score = score_text_overlap(query_tokens, candidate)
        source = str(candidate.get("source") or "").strip()
        source_prior = RERANK_SOURCE_PRIORS.get(source, 0.0)
        total_score = (
            rrf_score
            + (RERANK_TEXT_OVERLAP_WEIGHT * overlap_score)
            + (RERANK_SOURCE_PRIOR_WEIGHT * source_prior)
        )
        scored_results.append((total_score, original_index, candidate))

    sorted_head = [
        candidate
        for _, _, candidate in sorted(
            scored_results,
            key=lambda item: (-item[0], item[1]),
        )
    ]
    return sorted_head + tail


def execute_source_search(adapter: SearchAdapter, query: str, limit: int) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    started_at = time.perf_counter()
    normalized_limit = max(1, min(limit, MAX_RESULTS_PER_SOURCE))
    source_queries = build_source_query_variants(adapter.source, query)
    aggregated_results: list[dict[str, Any]] = []
    seen_keys: set[str] = set()
    attempt_succeeded = False
    last_error: Exception | None = None

    try:
        for source_query in source_queries:
            remaining_limit = normalized_limit - len(aggregated_results)
            if remaining_limit <= 0:
                break
            try:
                results = adapter.search(source_query, remaining_limit)
                attempt_succeeded = True
            except Exception as error:  # pragma: no cover - branch exercised via status assertions
                last_error = error
                continue

            for candidate in results:
                candidate_key = dedupe_key_for_paper(candidate)
                if candidate_key in seen_keys:
                    continue
                seen_keys.add(candidate_key)
                aggregated_results.append(candidate)
                if len(aggregated_results) >= normalized_limit:
                    break

        if not attempt_succeeded and last_error is not None:
            raise last_error

        duration_ms = int((time.perf_counter() - started_at) * 1000)
        return aggregated_results, build_source_status(
            source=adapter.source,
            ok=True,
            result_count=len(aggregated_results),
            duration_ms=duration_ms,
        )
    except Exception as error:
        duration_ms = int((time.perf_counter() - started_at) * 1000)
        return [], build_source_status(
            source=adapter.source,
            ok=False,
            result_count=0,
            duration_ms=duration_ms,
            error_code=classify_error(error),
            error_message=str(error),
        )


def merge_results(
    source_order: list[str],
    source_results: dict[str, list[dict[str, Any]]],
    limit: int,
) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    seen_keys: set[str] = set()
    remaining = True
    while remaining and len(merged) < max(1, limit):
        remaining = False
        for source in source_order:
            if not source_results.get(source):
                continue
            remaining = True
            candidate = source_results[source].pop(0)
            candidate_key = dedupe_key_for_paper(candidate)
            if candidate_key in seen_keys:
                continue
            seen_keys.add(candidate_key)
            merged.append(candidate)
            if len(merged) >= max(1, limit):
                break

    return merged


def search_papers(query: str, limit: int, sources: list[str] | None = None) -> dict[str, Any]:
    normalized_query = str(query or "").strip()
    if not normalized_query:
        raise ValueError("论文检索词不能为空")

    normalized_sources = normalize_sources(sources)
    adapters = build_search_adapters()
    selected_sources = [source for source in normalized_sources if source in adapters]
    if not selected_sources:
        selected_sources = DEFAULT_SOURCES.copy()

    per_source_limit = max(1, min(MAX_RESULTS_PER_SOURCE, -(-max(1, limit) // max(1, len(selected_sources)))))
    source_results: dict[str, list[dict[str, Any]]] = {source: [] for source in selected_sources}
    source_statuses: dict[str, dict[str, Any]] = {}

    with ThreadPoolExecutor(max_workers=len(selected_sources)) as executor:
        futures = {
            executor.submit(execute_source_search, adapters[source], normalized_query, per_source_limit): source
            for source in selected_sources
        }
        for future in as_completed(futures):
            source = futures[future]
            results, status = future.result()
            source_results[source] = results
            source_statuses[source] = status

    source_rank_maps = build_source_rank_maps(source_results)
    merged = merge_results(selected_sources, source_results, limit)
    merged = apply_heuristic_rerank(normalized_query, merged, source_rank_maps)
    ordered_statuses = [source_statuses[source] for source in selected_sources if source in source_statuses]

    if not merged and ordered_statuses and all(not status["ok"] for status in ordered_statuses):
        error_messages = [status["errorMessage"] for status in ordered_statuses if status.get("errorMessage")]
        raise ValueError("；".join(error_messages[:2]) or "所有论文来源均搜索失败")

    return {
        "results": merged,
        "sources": selected_sources,
        "sourceStatuses": ordered_statuses,
    }


#
# Code Review:
# - adapter 失败在这里被收敛成来源级状态，而不是直接被吞掉或炸穿整个请求，这能明显提升多源搜索的可观测性。
# - 聚合层现在只保留“可读源 + 发现源”三源组合，职责边界比之前更清楚。
# - 本次重排是“无模型规则重排”，默认只动前 200 条：先按来源轮询保证召回公平，再用轻量打分做全局优化，避免把排序质量完全绑死在单一来源返回顺序上。
# - `PAPER_RERANK_MODE` 与 `PAPER_RERANK_TOP_K` 都做了非法值回退，避免配置写错后直接把搜索链路打挂。
