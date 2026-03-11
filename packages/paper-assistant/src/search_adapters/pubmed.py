"""
 * File: pubmed.py
 * Module: packages/paper-assistant (PubMed 搜索 adapter)
 *
 * Responsibility:
 *   - 使用 `Bio.Entrez` 调用 NCBI E-utilities 完成 PubMed 搜索。
 *   - 在 adapter 内部处理 PMID 搜索、摘要解析与作者字段缺失降级。
 *
 * Dependencies:
 *   - Bio.Entrez
 *   - xmltodict
 *   - search_contracts
 *
 * Last Updated:
 *   - 2026-03-11 by Codex - 放开来源内部结果上限以匹配聚合层 limit
"""

from __future__ import annotations

import os
from typing import Any

import xmltodict

try:
    from Bio import Entrez
except ImportError:  # pragma: no cover - runtime fallback
    Entrez = None

from search_contracts import (
    MAX_RESULTS_PER_SOURCE,
    PUBMED_SOURCE,
    build_generic_warning,
    normalize_paper_payload,
    trim_text,
)

PUBMED_ABSTRACT_URL_TEMPLATE = "https://pubmed.ncbi.nlm.nih.gov/{source_id}/"


def normalize_xml_text(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        if "#text" in value:
            return str(value["#text"]).strip()
        return " ".join(normalize_xml_text(item) for item in value.values() if normalize_xml_text(item))
    if isinstance(value, list):
        return " ".join(normalize_xml_text(item) for item in value if normalize_xml_text(item))
    return str(value).strip() if value is not None else ""


def ensure_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def extract_pubmed_authors(article_node: dict[str, Any]) -> list[str]:
    author_list = ensure_list(article_node.get("AuthorList", {}).get("Author"))
    authors: list[str] = []
    for author in author_list:
        if not isinstance(author, dict):
            continue
        collective_name = normalize_xml_text(author.get("CollectiveName"))
        if collective_name:
            authors.append(collective_name)
            continue
        last_name = normalize_xml_text(author.get("LastName"))
        fore_name = normalize_xml_text(author.get("ForeName"))
        initials = normalize_xml_text(author.get("Initials"))
        display_name = " ".join(part for part in [fore_name, last_name] if part).strip()
        if not display_name:
            display_name = " ".join(part for part in [initials, last_name] if part).strip()
        if display_name:
            authors.append(display_name)
    return authors


def extract_pubmed_summary(article_node: dict[str, Any]) -> str:
    abstract_text = article_node.get("Abstract", {}).get("AbstractText", [])
    if isinstance(abstract_text, str):
        return abstract_text.strip()
    if isinstance(abstract_text, dict):
        return normalize_xml_text(abstract_text)
    summaries = []
    for item in ensure_list(abstract_text):
        label = normalize_xml_text(item.get("@Label")) if isinstance(item, dict) else ""
        text = normalize_xml_text(item)
        if not text:
            continue
        summaries.append(f"{label}: {text}" if label else text)
    return "\n".join(summaries) if summaries else "No abstract available"


def extract_pubmed_published(article_node: dict[str, Any]) -> str | None:
    article_date = article_node.get("ArticleDate", {})
    if isinstance(article_date, list) and article_date:
        article_date = article_date[0]
    if isinstance(article_date, dict):
        year = normalize_xml_text(article_date.get("Year"))
        month = normalize_xml_text(article_date.get("Month"))
        day = normalize_xml_text(article_date.get("Day"))
        if year:
            return "-".join(part for part in [year, month, day] if part)

    journal_issue = article_node.get("Journal", {}).get("JournalIssue", {})
    pub_date = journal_issue.get("PubDate", {})
    year = normalize_xml_text(pub_date.get("Year"))
    medline_date = normalize_xml_text(pub_date.get("MedlineDate"))
    if year:
        month = normalize_xml_text(pub_date.get("Month"))
        day = normalize_xml_text(pub_date.get("Day"))
        return "-".join(part for part in [year, month, day] if part)
    return medline_date or None


def extract_pubmed_article_ids(article_data: dict[str, Any]) -> dict[str, str]:
    identifiers: dict[str, str] = {}
    article_ids = (
        article_data.get("PubmedData", {})
        .get("ArticleIdList", {})
        .get("ArticleId", [])
    )
    for item in ensure_list(article_ids):
        if isinstance(item, dict):
            key = str(item.get("@IdType") or "").strip().lower()
            value = normalize_xml_text(item)
            if key and value:
                identifiers[key] = value
    return identifiers


def extract_pubmed_title(article_node: dict[str, Any]) -> str:
    return normalize_xml_text(article_node.get("ArticleTitle")) or "Untitled"


def extract_pubmed_venue(article_node: dict[str, Any]) -> str | None:
    journal_title = normalize_xml_text(article_node.get("Journal", {}).get("Title"))
    return journal_title or None


class PubMedSearchAdapter:
    source = PUBMED_SOURCE

    def _ensure_entrez(self) -> Any:
        if Entrez is None:
            raise RuntimeError("当前环境未安装 biopython，无法执行 PubMed 搜索")
        Entrez.email = os.environ.get("PUBMED_EMAIL", "your_email@example.com").strip() or "your_email@example.com"
        api_key = os.environ.get("PUBMED_API_KEY", "").strip()
        Entrez.api_key = api_key or None
        return Entrez

    def _search_ids(self, query: str, limit: int) -> list[str]:
        entrez = self._ensure_entrez()
        with entrez.esearch(
            db="pubmed",
            term=query[:300],
            retmax=max(1, min(limit, MAX_RESULTS_PER_SOURCE)),
            sort="relevance",
        ) as handle:
            payload = entrez.read(handle)
        return [str(item).strip() for item in payload.get("IdList", []) if str(item).strip()]

    def _fetch_articles(self, ids: list[str]) -> list[dict[str, Any]]:
        if not ids:
            return []
        entrez = self._ensure_entrez()
        with entrez.efetch(db="pubmed", id=",".join(ids), retmode="xml") as handle:
            payload = xmltodict.parse(handle.read())
        articles = payload.get("PubmedArticleSet", {}).get("PubmedArticle", [])
        return ensure_list(articles)

    def search(self, query: str, limit: int) -> list[dict[str, Any]]:
        ids = self._search_ids(query, limit)
        results: list[dict[str, Any]] = []
        for article_wrapper in self._fetch_articles(ids):
            if not isinstance(article_wrapper, dict):
                continue
            medline = article_wrapper.get("MedlineCitation", {})
            article = medline.get("Article", {})
            source_id = normalize_xml_text(medline.get("PMID"))
            if not source_id:
                continue
            identifiers = extract_pubmed_article_ids(article_wrapper)
            pmcid = identifiers.get("pmc")
            doi = identifiers.get("doi")
            pdf_url = f"https://pmc.ncbi.nlm.nih.gov/articles/{pmcid}/pdf/" if pmcid else None
            summary = trim_text(extract_pubmed_summary(article), 2200)
            results.append(
                normalize_paper_payload(
                    source=PUBMED_SOURCE,
                    source_id=source_id,
                    title=extract_pubmed_title(article),
                    authors=extract_pubmed_authors(article),
                    published=extract_pubmed_published(article),
                    summary=summary,
                    abstract_url=PUBMED_ABSTRACT_URL_TEMPLATE.format(source_id=source_id),
                    pdf_url=pdf_url,
                    doi=doi,
                    venue=extract_pubmed_venue(article),
                    content=summary,
                    content_source="pubmed_abstract",
                    warning=build_generic_warning(PUBMED_SOURCE, pdf_url),
                    access_status="pdf" if pdf_url else "abstract_only",
                )
            )
        return results


#
# Code Review:
# - PubMed 搜索改为 `Bio.Entrez` 后，搜索链路和详情链路终于统一回到 NCBI 官方接口体系，减少了 LangChain wrapper 的黑盒差异。
# - 缺作者、缺摘要、缺年份都被视为正常元数据降级，而不是直接抛错，这更符合 PubMed 真实数据质量的波动情况。
# - `retmax` 不再写死为个位数，避免大 limit 请求在 PubMed 这一层被悄悄截断。
