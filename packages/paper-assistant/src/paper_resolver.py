"""
 * File: paper_resolver.py
 * Module: packages/paper-assistant (发现源到可读源解析器)
 *
 * Responsibility:
 *   - 仅为 `OpenAlex` 这类发现源执行“精确匹配 -> 可读源”解析。
 *   - 只接受显式标识符，不做 `title + year + authors` 弱匹配，避免误命中。
 *
 * Runtime Logic Overview:
 *   1. 从 discovery 结果及其原始元数据中提取 DOI、arXiv ID、PMID、PMCID。
 *   2. 并发向 `arXiv` 与 `PubMed` 查询这些显式标识符。
 *   3. 只有验证通过的精确匹配才会返回；若双边都命中，固定优先 `arXiv`。
 *
 * Dependencies:
 *   - concurrent.futures
 *   - re
 *   - arxiv
 *   - search_adapters.arxiv
 *   - search_adapters.pubmed
 *   - search_contracts
 *
 * Last Updated:
 *   - 2026-03-11 by Codex - 收缩为 OpenAlex discovery 解析器
"""

from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import arxiv

from search_adapters.arxiv import ARXIV_ID_PATTERN, normalize_arxiv_result
from search_adapters.pubmed import PubMedSearchAdapter, extract_pubmed_article_ids, normalize_xml_text
from search_contracts import ARXIV_SOURCE, PUBMED_SOURCE, build_paper_id

DOI_PATTERN = re.compile(r"(10\.\d{4,9}/[^\s\"'<>]+)", re.IGNORECASE)
ARXIV_URL_PATTERN = re.compile(r"arxiv\.org/(?:abs|pdf)/(?P<paper_id>[^/?#]+)", re.IGNORECASE)
ARXIV_DOI_PATTERN = re.compile(r"10\.48550/arxiv\.(?P<paper_id>[^/?#]+)", re.IGNORECASE)
PMID_URL_PATTERN = re.compile(r"pubmed\.ncbi\.nlm\.nih\.gov/(?P<pmid>\d+)", re.IGNORECASE)
PMCID_PATTERN = re.compile(r"\bPMC\d+\b", re.IGNORECASE)


def append_unique(items: list[str], value: str | None) -> None:
    normalized = str(value or "").strip()
    if normalized and normalized not in items:
        items.append(normalized)


def normalize_doi(value: str | None) -> str | None:
    normalized = str(value or "").strip()
    if not normalized:
        return None
    match = DOI_PATTERN.search(normalized.replace("https://doi.org/", "").replace("http://doi.org/", ""))
    if not match:
        return None
    return match.group(1).rstrip(").,;").lower()


def normalize_arxiv_id(value: str | None) -> str | None:
    normalized = str(value or "").strip()
    if not normalized:
        return None
    if ARXIV_ID_PATTERN.fullmatch(normalized):
        return normalized.replace("arxiv:", "")

    doi_match = ARXIV_DOI_PATTERN.search(normalized)
    if doi_match:
        return doi_match.group("paper_id").rstrip(".")

    url_match = ARXIV_URL_PATTERN.search(normalized)
    if url_match:
        candidate = url_match.group("paper_id").replace(".pdf", "").strip()
        if ARXIV_ID_PATTERN.fullmatch(candidate):
            return candidate
    return None


def normalize_pmid(value: str | None) -> str | None:
    normalized = str(value or "").strip()
    if not normalized:
        return None
    url_match = PMID_URL_PATTERN.search(normalized)
    if url_match:
        return url_match.group("pmid")
    return normalized if normalized.isdigit() else None


def normalize_pmcid(value: str | None) -> str | None:
    normalized = str(value or "").strip()
    if not normalized:
        return None
    match = PMCID_PATTERN.search(normalized)
    if not match:
        return None
    return match.group(0).upper()


def collect_text_fragments(node: Any, fragments: list[str]) -> None:
    if isinstance(node, str):
        append_unique(fragments, node)
        return
    if isinstance(node, dict):
        for value in node.values():
            collect_text_fragments(value, fragments)
        return
    if isinstance(node, list):
        for item in node:
            collect_text_fragments(item, fragments)


def collect_identifier_candidates(paper: dict[str, Any], raw_record: dict[str, Any] | None = None) -> dict[str, list[str]]:
    fragments: list[str] = []
    for field_name in ["doi", "abstractUrl", "entryId", "pdfUrl", "sourceId"]:
        append_unique(fragments, paper.get(field_name))
    if raw_record:
        collect_text_fragments(raw_record, fragments)

    dois: list[str] = []
    arxiv_ids: list[str] = []
    pmids: list[str] = []
    pmcids: list[str] = []

    for fragment in fragments:
        append_unique(dois, normalize_doi(fragment))
        append_unique(arxiv_ids, normalize_arxiv_id(fragment))
        append_unique(pmids, normalize_pmid(fragment))
        append_unique(pmcids, normalize_pmcid(fragment))

    return {
        "dois": dois,
        "arxiv_ids": arxiv_ids,
        "pmids": pmids,
        "pmcids": pmcids,
    }


def resolve_arxiv_exact_match(arxiv_ids: list[str]) -> str | None:
    if not arxiv_ids:
        return None

    client = arxiv.Client()
    for arxiv_id in arxiv_ids:
        result = next(client.results(arxiv.Search(id_list=[arxiv_id])), None)
        if not result:
            continue
        normalized = normalize_arxiv_result(result)
        source_id = str(normalized.get("sourceId") or "").strip()
        if source_id:
            return build_paper_id(ARXIV_SOURCE, source_id)
    return None


def extract_pubmed_pmid(article_wrapper: dict[str, Any]) -> str | None:
    medline = article_wrapper.get("MedlineCitation", {})
    return normalize_xml_text(medline.get("PMID")) or None


def search_verified_pubmed_match(
    adapter: PubMedSearchAdapter,
    query_terms: list[str],
    verifier,
) -> str | None:
    seen_query_terms: list[str] = []
    for query_term in query_terms:
        normalized = query_term.strip()
        if not normalized or normalized in seen_query_terms:
            continue
        seen_query_terms.append(normalized)
        ids = adapter._search_ids(normalized, 4)
        for article_wrapper in adapter._fetch_articles(ids):
            if not isinstance(article_wrapper, dict):
                continue
            if verifier(article_wrapper):
                pmid = extract_pubmed_pmid(article_wrapper)
                if pmid:
                    return build_paper_id(PUBMED_SOURCE, pmid)
    return None


def resolve_pubmed_exact_match(dois: list[str], pmids: list[str], pmcids: list[str]) -> str | None:
    adapter = PubMedSearchAdapter()

    for pmid in pmids:
        for article_wrapper in adapter._fetch_articles([pmid]):
            if not isinstance(article_wrapper, dict):
                continue
            if extract_pubmed_pmid(article_wrapper) == pmid:
                return build_paper_id(PUBMED_SOURCE, pmid)

    for pmcid in pmcids:
        match = search_verified_pubmed_match(
            adapter,
            [pmcid, f"\"{pmcid}\""],
            lambda article_wrapper, expected=pmcid: extract_pubmed_article_ids(article_wrapper).get("pmc", "").upper()
            == expected.upper(),
        )
        if match:
            return match

    for doi in dois:
        match = search_verified_pubmed_match(
            adapter,
            [doi, f"\"{doi}\""],
            lambda article_wrapper, expected=doi: extract_pubmed_article_ids(article_wrapper).get("doi", "").lower()
            == expected.lower(),
        )
        if match:
            return match

    return None


def resolve_readable_paper_id(paper: dict[str, Any], raw_record: dict[str, Any] | None = None) -> str | None:
    candidates = collect_identifier_candidates(paper, raw_record)

    with ThreadPoolExecutor(max_workers=2) as executor:
        arxiv_future = executor.submit(resolve_arxiv_exact_match, candidates["arxiv_ids"])
        pubmed_future = executor.submit(
            resolve_pubmed_exact_match,
            candidates["dois"],
            candidates["pmids"],
            candidates["pmcids"],
        )
        try:
            arxiv_match = arxiv_future.result()
        except Exception:
            arxiv_match = None
        try:
            pubmed_match = pubmed_future.result()
        except Exception:
            pubmed_match = None

    if arxiv_match:
        return arxiv_match
    if pubmed_match:
        return pubmed_match
    return None


#
# Code Review:
# - 解析器只接受 DOI / arXiv ID / PMID / PMCID 这类显式标识符，不做弱匹配，能把 discovery -> readable 的误命中风险压到最低。
# - `arXiv` 和 `PubMed` 虽然并发查询，但最终选择依据是“是否通过精确校验”，而不是返回先后顺序，符合产品约束。
# - 旧世界里来自 OpenAlex 原始记录的各类 URL 会在这里统一拆出标识符，避免把来源特有脏字段继续泄漏到 `paper_core.py`。
