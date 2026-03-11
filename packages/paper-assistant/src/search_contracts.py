"""
 * File: search_contracts.py
 * Module: packages/paper-assistant (论文搜索契约与共享工具)
 *
 * Responsibility:
 *   - 定义论文搜索层共享的来源常量、统一结果结构和状态结构。
 *   - 提供搜索 adapter 与聚合层共用的轻量标准化工具，避免每个来源各自拼字段。
 *
 * Runtime Logic Overview:
 *   1. 来源 adapter 把上游返回映射为统一论文搜索结果。
 *   2. 聚合层基于本文件的来源顺序、去重键和状态结构做统一编排。
 *   3. `paper_core.py` 与前端最终只消费统一结构，不直接感知单个来源差异。
 *
 * Dependencies:
 *   - re
 *   - datetime
 *   - typing
 *
 * Last Updated:
 *   - 2026-03-11 by Codex - 默认搜索规模回收至 200，并补充轻量重排配置常量
"""

from __future__ import annotations

import os
import re
from datetime import datetime
from typing import Any

ARXIV_SOURCE = "arxiv"
PUBMED_SOURCE = "pubmed"
OPENALEX_SOURCE = "openalex"
READABLE_SOURCES = [
    ARXIV_SOURCE,
    PUBMED_SOURCE,
]
DISCOVERY_SOURCES = [
    OPENALEX_SOURCE,
]
SUPPORTED_SOURCES = READABLE_SOURCES + DISCOVERY_SOURCES
DEFAULT_SOURCES = SUPPORTED_SOURCES.copy()
SOURCE_LABELS = {
    ARXIV_SOURCE: "arXiv",
    PUBMED_SOURCE: "PubMed",
    OPENALEX_SOURCE: "OpenAlex",
}
METADATA_ONLY_SUMMARY = "当前来源仅返回元数据，暂未提供摘要。"
PAPER_REQUEST_TIMEOUT_S = max(5.0, float(os.environ.get("PAPER_SOURCE_TIMEOUT_MS", "15000")) / 1000.0)
DEFAULT_SEARCH_LIMIT = 200
MAX_SEARCH_LIMIT = 500
MAX_RESULTS_PER_SOURCE = 500
DEFAULT_RERANK_MODE = "heuristic"
DEFAULT_RERANK_TOP_K = 200
CJK_CHARACTER_PATTERN = re.compile(r"[\u3400-\u9fff]")
ENGLISH_QUERY_EXPANSION_RULES = [
    ("检索增强生成", "retrieval augmented generation"),
    ("检索增强", "retrieval augmented"),
    ("人工智能", "artificial intelligence"),
    ("计算机科学", "computer science"),
    ("计算机", "computer"),
    ("深度神经网络", "deep neural network"),
    ("神经网络", "neural network"),
    ("深度学习", "deep learning"),
    ("机器学习", "machine learning"),
    ("大语言模型", "large language model"),
    ("语言模型", "language model"),
    ("多模态", "multimodal"),
    ("自然语言处理", "natural language processing"),
    ("计算机视觉", "computer vision"),
    ("强化学习", "reinforcement learning"),
    ("图神经网络", "graph neural network"),
    ("生成对抗网络", "generative adversarial network"),
    ("扩散模型", "diffusion model"),
    ("算法", "algorithm"),
    ("优化", "optimization"),
    ("训练", "training"),
    ("推理", "inference"),
    ("目标检测", "object detection"),
    ("图像分割", "image segmentation"),
    ("图像分类", "image classification"),
    ("推荐系统", "recommender system"),
    ("注意力机制", "attention mechanism"),
]


def get_source_label(source: str) -> str:
    return SOURCE_LABELS.get(source, source or "Unknown")


def build_paper_id(source: str, source_id: str) -> str:
    normalized_source_id = str(source_id or "").strip()
    if not normalized_source_id:
        raise ValueError("论文来源 ID 不能为空")
    return f"{source}:{normalized_source_id}"


def trim_text(value: str | None, max_chars: int) -> str:
    normalized = (value or "").strip()
    if len(normalized) <= max_chars:
        return normalized
    return f"{normalized[:max_chars]}\n...[truncated]"


def normalize_authors(raw_authors: Any) -> list[str]:
    if isinstance(raw_authors, str):
        return [item.strip() for item in raw_authors.split(",") if item.strip()]
    if isinstance(raw_authors, list):
        normalized_authors: list[str] = []
        for item in raw_authors:
            if isinstance(item, dict):
                name = str(item.get("name") or item.get("Name") or item.get("display_name") or "").strip()
            else:
                name = getattr(item, "name", None) or getattr(item, "Name", None) or str(item)
                name = str(name).strip()
            if name:
                normalized_authors.append(name)
        return normalized_authors
    return []


def normalize_sources(raw_sources: list[str] | None) -> list[str]:
    selected_sources = []
    for item in raw_sources or []:
        normalized = str(item or "").strip().lower()
        if normalized in SUPPORTED_SOURCES and normalized not in selected_sources:
            selected_sources.append(normalized)
    return selected_sources or DEFAULT_SOURCES.copy()


def contains_cjk_characters(value: str | None) -> bool:
    return bool(CJK_CHARACTER_PATTERN.search(str(value or "")))


def build_english_query_expansion(query: str | None) -> str | None:
    normalized_query = str(query or "").strip()
    if not normalized_query or not contains_cjk_characters(normalized_query):
        return None

    expanded_query = normalized_query
    for chinese_term, english_term in ENGLISH_QUERY_EXPANSION_RULES:
        expanded_query = expanded_query.replace(chinese_term, f" {english_term} ")

    english_tokens = re.findall(r"[A-Za-z0-9][A-Za-z0-9+\-]*", expanded_query)
    english_query = " ".join(english_tokens).strip()
    if not english_query:
        return None
    return re.sub(r"\s+", " ", english_query)


def normalize_title_key(title: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", "", (title or "").lower())


def parse_sort_date(value: str | None) -> datetime:
    if not value:
        return datetime.min

    normalized = value.strip()
    for pattern in ("%Y-%m-%d", "%Y/%m/%d", "%Y-%m", "%Y/%m", "%Y"):
        try:
            return datetime.strptime(normalized, pattern)
        except ValueError:
            continue

    try:
        return datetime.fromisoformat(normalized.replace("Z", "+00:00"))
    except ValueError:
        return datetime.min


def normalize_year(value: str | int | None) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    if not normalized:
        return None
    if re.fullmatch(r"\d{4}", normalized):
        return normalized
    return normalized


def dedupe_key_for_paper(paper: dict[str, Any]) -> str:
    doi = str(paper.get("doi") or "").strip().lower()
    if doi:
        return f"doi:{doi}"

    source = str(paper.get("source") or "").strip()
    source_id = str(paper.get("sourceId") or "").strip()
    if source and source_id:
        return f"source:{source}:{source_id}"

    title_key = normalize_title_key(paper.get("title"))
    published_year = str(paper.get("published") or "").strip().split("-")[0]
    return f"title:{title_key}:{published_year}"


def build_generic_warning(source: str, pdf_url: str | None) -> str | None:
    if pdf_url:
        return None
    if source == ARXIV_SOURCE:
        return "当前只获取到摘要和文本片段，PDF 可能暂时不可用。"
    return f"当前来源仅保证摘要或元数据可读，未发现可直接访问的 {get_source_label(source)} PDF。"


def normalize_paper_payload(
    *,
    source: str,
    source_id: str,
    title: str,
    authors: list[str],
    published: str | None,
    summary: str,
    abstract_url: str | None,
    pdf_url: str | None,
    doi: str | None = None,
    venue: str | None = None,
    entry_id: str | None = None,
    content: str | None = None,
    content_source: str | None = None,
    warning: str | None = None,
    access_status: str | None = None,
) -> dict[str, Any]:
    paper_id = build_paper_id(source, source_id)
    resolved_access_status = access_status or ("pdf" if pdf_url else "abstract_only")
    resolved_summary = summary.strip() if summary else ""
    if not resolved_summary:
        resolved_summary = METADATA_ONLY_SUMMARY if resolved_access_status == "metadata_only" else "暂无摘要"

    return {
        "paperId": paper_id,
        "source": source,
        "sourceLabel": get_source_label(source),
        "sourceId": source_id,
        "entryId": entry_id or abstract_url,
        "title": title.strip() or "Untitled",
        "authors": authors,
        "published": published,
        "summary": resolved_summary,
        "abstractUrl": abstract_url,
        "pdfUrl": pdf_url,
        "doi": doi.strip() if isinstance(doi, str) and doi.strip() else None,
        "venue": venue.strip() if isinstance(venue, str) and venue.strip() else None,
        "fullTextAvailable": bool(pdf_url),
        "accessStatus": resolved_access_status,
        "content": (content or "").strip(),
        "contentSource": content_source,
        "warning": warning,
    }


def build_source_status(
    *,
    source: str,
    ok: bool,
    result_count: int,
    duration_ms: int,
    error_code: str | None = None,
    error_message: str | None = None,
) -> dict[str, Any]:
    return {
        "source": source,
        "sourceLabel": get_source_label(source),
        "ok": ok,
        "resultCount": max(0, int(result_count)),
        "durationMs": max(0, int(duration_ms)),
        "errorCode": error_code,
        "errorMessage": error_message,
    }


#
# Code Review:
# - 搜索层现在显式区分 `READABLE_SOURCES` 与 `DISCOVERY_SOURCES`，后续阅读与导入链路可以直接复用这两个集合，不必再散落白名单。
# - `SOURCE_LABELS` 只保留当前仍受支持的三源，避免已下线来源再通过契约层漏回主链路。
# - `accessStatus` 在这里统一建模，避免 `OpenAlex` 这类元数据发现源被误当成可读全文源。
# - 中文检索扩展采用静态术语映射而不是模型翻译，优先保证搜索链路可预测、可测试，不把基础检索再绑到额外 AI 依赖上。
# - 搜索默认 limit 调整为 `200`，但保留 `500` 上限，兼顾常规响应速度与手工扩召回场景。
