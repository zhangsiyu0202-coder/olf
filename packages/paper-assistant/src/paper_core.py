"""
 * File: paper_core.py
 * Module: packages/paper-assistant (论文多源核心)
 *
 * Responsibility:
 *   - 提供多源论文搜索、详情加载、BibTeX 生成、PDF 获取和研究 Agent 的统一核心能力。
 *   - 把 `arXiv`、`Semantic Scholar` 和 `PubMed` 的接入差异收敛在一处，避免 CLI、HTTP 服务和 Node 主站维护多套规则。
 *
 * Runtime Logic Overview:
 *   1. 调用方传入搜索词、论文 ID 或 Agent 问题。
 *   2. 本模块按来源路由到对应搜索发现源或全文获取源。
 *   3. 统一输出结构化论文对象，供 CLI、FastAPI 服务和 Node 主站复用。
 *
 * Key Data Flow:
 *   - 输入：检索词、`paperId`、来源列表、最大加载长度、Agent 问题。
 *   - 输出：统一论文搜索结果、详情、BibTeX、PDF 字节流和 Agent 回复。
 *
 * Future Extension:
 *   - 后续可继续接入 `Crossref`、`OpenAlex` 等来源，但仍应保持“搜索发现层”和“全文获取层”分离。
 *   - 去重、排序和缓存若继续增强，也应优先在本模块扩展，而不是散落到 API 或前端。
 *
 * Dependencies:
 *   - httpx
 *   - xmltodict
 *   - arxiv
 *   - semanticscholar
 *   - langchain
 *   - langchain-community
 *   - langchain-openai
 *
 * Last Updated:
 *   - 2026-03-08 by Codex - 初始化多源论文搜索、详情与独立服务复用核心
"""

from __future__ import annotations

import json
import math
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Any
from urllib.parse import quote, urlparse

import arxiv
import httpx
import xmltodict
from langchain.agents import create_agent
from langchain.tools import tool
from langchain_community.document_loaders import ArxivLoader
from langchain_community.retrievers import ArxivRetriever
from langchain_community.utilities import PubMedAPIWrapper
from langchain_openai import ChatOpenAI
from semanticscholar import SemanticScholar

ARXIV_SOURCE = "arxiv"
SEMANTIC_SCHOLAR_SOURCE = "semantic_scholar"
PUBMED_SOURCE = "pubmed"
DEFAULT_SOURCES = [ARXIV_SOURCE, SEMANTIC_SCHOLAR_SOURCE, PUBMED_SOURCE]
SOURCE_LABELS = {
    ARXIV_SOURCE: "arXiv",
    SEMANTIC_SCHOLAR_SOURCE: "Semantic Scholar",
    PUBMED_SOURCE: "PubMed",
}
SEMANTIC_SCHOLAR_FIELDS = [
    "title",
    "abstract",
    "venue",
    "year",
    "paperId",
    "authors",
    "externalIds",
    "openAccessPdf",
    "url",
]
PAPER_REQUEST_TIMEOUT_S = max(5.0, float(os.environ.get("PAPER_SOURCE_TIMEOUT_MS", "15000")) / 1000.0)
SEMANTIC_SCHOLAR_API_URL = "https://api.semanticscholar.org/graph/v1"
PUBMED_ABSTRACT_URL_TEMPLATE = "https://pubmed.ncbi.nlm.nih.gov/{source_id}/"
PMC_PDF_URL_TEMPLATE = "https://pmc.ncbi.nlm.nih.gov/articles/{pmcid}/pdf/"


def get_source_label(source: str) -> str:
    return SOURCE_LABELS.get(source, source or "Unknown")


def build_paper_id(source: str, source_id: str) -> str:
    normalized_source_id = str(source_id or "").strip()
    if not normalized_source_id:
        raise ValueError("论文来源 ID 不能为空")
    return f"{source}:{normalized_source_id}"


def parse_paper_id(raw_value: str | None) -> tuple[str, str]:
    value = (raw_value or "").strip()
    if not value:
        raise ValueError("论文 ID 不能为空")

    if value.startswith("http://") or value.startswith("https://"):
        parsed = urlparse(value)
        path_value = parsed.path.rstrip("/").split("/")[-1]
        return ARXIV_SOURCE, path_value.replace(".pdf", "")

    if ":" in value:
        source, source_id = value.split(":", 1)
        source = source.strip()
        source_id = source_id.strip()
        if source in SOURCE_LABELS and source_id:
            return source, source_id

    return ARXIV_SOURCE, value.replace(".pdf", "")


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
                name = str(item.get("name") or item.get("Name") or "").strip()
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
        if normalized in SOURCE_LABELS and normalized not in selected_sources:
            selected_sources.append(normalized)
    return selected_sources or DEFAULT_SOURCES.copy()


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


def dedupe_key_for_paper(paper: dict[str, Any]) -> str:
    doi = str(paper.get("doi") or "").strip().lower()
    if doi:
        return f"doi:{doi}"

    title_key = normalize_title_key(paper.get("title"))
    published = str(paper.get("published") or "").strip()
    return f"title:{title_key}:{published}"


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
) -> dict[str, Any]:
    paper_id = build_paper_id(source, source_id)
    return {
        "paperId": paper_id,
        "source": source,
        "sourceLabel": get_source_label(source),
        "sourceId": source_id,
        "entryId": entry_id or abstract_url,
        "title": title.strip() or "Untitled",
        "authors": authors,
        "published": published,
        "summary": summary.strip(),
        "abstractUrl": abstract_url,
        "pdfUrl": pdf_url,
        "doi": doi.strip() if isinstance(doi, str) and doi.strip() else None,
        "venue": venue.strip() if isinstance(venue, str) and venue.strip() else None,
        "fullTextAvailable": bool(pdf_url),
        "accessStatus": "pdf" if pdf_url else "abstract_only",
        "content": (content or "").strip(),
        "contentSource": content_source,
        "warning": warning,
    }


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


def normalize_arxiv_search_document(document: Any) -> dict[str, Any]:
    metadata = dict(getattr(document, "metadata", {}) or {})
    raw_entry_id = metadata.get("Entry ID")
    source_id = str(raw_entry_id or metadata.get("Title") or "").strip()
    if raw_entry_id:
        source_id = parse_paper_id(raw_entry_id)[1]

    return normalize_paper_payload(
        source=ARXIV_SOURCE,
        source_id=source_id,
        title=str(metadata.get("Title") or "Untitled"),
        authors=normalize_authors(metadata.get("Authors")),
        published=str(metadata.get("Published")) if metadata.get("Published") else None,
        summary=trim_text(metadata.get("Summary") or getattr(document, "page_content", ""), 1800),
        abstract_url=normalize_arxiv_entry_id(raw_entry_id, source_id),
        pdf_url=build_arxiv_pdf_url(raw_entry_id, source_id),
        content=None,
        content_source=None,
        warning=None,
    )


def search_arxiv(query: str, limit: int) -> list[dict[str, Any]]:
    retriever = ArxivRetriever(
        load_max_docs=max(1, min(limit, 8)),
        get_full_documents=False,
        load_all_available_meta=False,
    )
    documents = retriever.invoke(query)
    results: list[dict[str, Any]] = []
    for document in documents:
        try:
            results.append(normalize_arxiv_search_document(document))
        except Exception:
            continue
    return results


def load_arxiv_paper(source_id: str, max_chars: int) -> dict[str, Any]:
    loader = ArxivLoader(
        query=source_id,
        load_max_docs=1,
        doc_content_chars_max=max(2000, min(max_chars, 50000)),
    )
    documents = loader.load()
    if not documents:
        raise ValueError("未找到对应的 arXiv 论文")

    document = documents[0]
    metadata = dict(document.metadata or {})
    entry_id = metadata.get("Entry ID")
    return normalize_paper_payload(
        source=ARXIV_SOURCE,
        source_id=source_id,
        title=str(metadata.get("Title") or source_id),
        authors=normalize_authors(metadata.get("Authors")),
        published=str(metadata.get("Published")) if metadata.get("Published") else None,
        summary=trim_text(metadata.get("Summary") or document.page_content, 2200),
        abstract_url=normalize_arxiv_entry_id(entry_id, source_id),
        pdf_url=build_arxiv_pdf_url(entry_id, source_id),
        doi=str(metadata.get("doi") or "") or None,
        venue=None,
        entry_id=normalize_arxiv_entry_id(entry_id, source_id),
        content=trim_text(document.page_content, max_chars),
        content_source="arxiv_loader",
        warning=None,
    )


def build_semantic_scholar_headers() -> dict[str, str]:
    headers = {
        "User-Agent": "overleaf-clone-paper-service/0.1",
        "Accept": "application/json",
    }
    api_key = os.environ.get("SEMANTIC_SCHOLAR_API_KEY", "").strip()
    if api_key:
        headers["x-api-key"] = api_key
    return headers


def extract_semantic_external_id(item: dict[str, Any], key: str) -> str | None:
    external_ids = item.get("externalIds") or {}
    if isinstance(external_ids, dict):
        value = external_ids.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def normalize_semantic_scholar_paper(item: dict[str, Any]) -> dict[str, Any]:
    source_id = str(item.get("paperId") or "").strip()
    if not source_id:
        raise ValueError("Semantic Scholar 结果缺少 paperId")

    pdf_url = None
    open_access_pdf = item.get("openAccessPdf")
    if isinstance(open_access_pdf, dict):
        pdf_url = str(open_access_pdf.get("url") or "").strip() or None

    abstract_url = str(item.get("url") or "").strip() or f"https://www.semanticscholar.org/paper/{source_id}"
    summary = trim_text(str(item.get("abstract") or "暂无摘要"), 2200)
    return normalize_paper_payload(
        source=SEMANTIC_SCHOLAR_SOURCE,
        source_id=source_id,
        title=str(item.get("title") or "Untitled"),
        authors=normalize_authors(item.get("authors")),
        published=str(item.get("year")) if item.get("year") else None,
        summary=summary,
        abstract_url=abstract_url,
        pdf_url=pdf_url,
        doi=extract_semantic_external_id(item, "DOI"),
        venue=str(item.get("venue") or "") or None,
        content=summary,
        content_source="semantic_scholar_abstract",
        warning=build_generic_warning(SEMANTIC_SCHOLAR_SOURCE, pdf_url),
    )


def request_semantic_scholar_json(path: str, params: dict[str, Any]) -> dict[str, Any]:
    with httpx.Client(timeout=PAPER_REQUEST_TIMEOUT_S, follow_redirects=True) as client:
        response = client.get(
            f"{SEMANTIC_SCHOLAR_API_URL}{path}",
            params=params,
            headers=build_semantic_scholar_headers(),
        )
        response.raise_for_status()
        return response.json()


def search_semantic_scholar(query: str, limit: int) -> list[dict[str, Any]]:
    payload = request_semantic_scholar_json(
        "/paper/search",
        {
            "query": query[:300],
            "limit": max(1, min(limit, 8)),
            "fields": ",".join(SEMANTIC_SCHOLAR_FIELDS),
        },
    )
    results: list[dict[str, Any]] = []
    for item in payload.get("data") or []:
        try:
            results.append(normalize_semantic_scholar_paper(item))
        except Exception:
            continue
    return results


def load_semantic_scholar_paper(source_id: str, max_chars: int) -> dict[str, Any]:
    payload = request_semantic_scholar_json(
        f"/paper/{quote(source_id, safe='')}",
        {
            "fields": ",".join(SEMANTIC_SCHOLAR_FIELDS),
        },
    )
    paper = normalize_semantic_scholar_paper(payload)
    paper["content"] = trim_text(paper["summary"], max_chars)
    paper["contentSource"] = "semantic_scholar_abstract"
    return paper


def create_pubmed_wrapper(limit: int) -> PubMedAPIWrapper:
    return PubMedAPIWrapper(
        top_k_results=max(1, min(limit, 8)),
        doc_content_chars_max=2200,
        email=os.environ.get("PUBMED_EMAIL", "your_email@example.com"),
        api_key=os.environ.get("PUBMED_API_KEY", "").strip(),
    )


def normalize_pubmed_search_result(item: dict[str, Any]) -> dict[str, Any]:
    source_id = str(item.get("uid") or "").strip()
    if not source_id:
        raise ValueError("PubMed 结果缺少 uid")

    summary = trim_text(str(item.get("Summary") or "No abstract available"), 2200)
    return normalize_paper_payload(
        source=PUBMED_SOURCE,
        source_id=source_id,
        title=str(item.get("Title") or "Untitled"),
        authors=[],
        published=str(item.get("Published") or "").strip() or None,
        summary=summary,
        abstract_url=PUBMED_ABSTRACT_URL_TEMPLATE.format(source_id=source_id),
        pdf_url=None,
        doi=None,
        venue=None,
        content=summary,
        content_source="pubmed_summary",
        warning=build_generic_warning(PUBMED_SOURCE, None),
    )


def search_pubmed(query: str, limit: int) -> list[dict[str, Any]]:
    wrapper = create_pubmed_wrapper(limit)
    results: list[dict[str, Any]] = []
    for item in wrapper.load(query[:300]):
        try:
            results.append(normalize_pubmed_search_result(item))
        except Exception:
            continue
    return results


def request_pubmed_xml(source_id: str) -> dict[str, Any]:
    params = {
        "db": "pubmed",
        "retmode": "xml",
        "id": source_id,
    }
    api_key = os.environ.get("PUBMED_API_KEY", "").strip()
    if api_key:
        params["api_key"] = api_key

    with httpx.Client(timeout=PAPER_REQUEST_TIMEOUT_S, follow_redirects=True) as client:
        response = client.get(
            "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi",
            params=params,
            headers={"User-Agent": "overleaf-clone-paper-service/0.1"},
        )
        response.raise_for_status()
        return xmltodict.parse(response.text)


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


def extract_pubmed_article_ids(article_data: dict[str, Any]) -> dict[str, str]:
    identifiers: dict[str, str] = {}
    article_ids = (
        article_data.get("PubmedData", {})
        .get("ArticleIdList", {})
        .get("ArticleId", [])
    )
    if not isinstance(article_ids, list):
        article_ids = [article_ids]
    for item in article_ids:
        if isinstance(item, dict):
            key = str(item.get("@IdType") or "").strip().lower()
            value = normalize_xml_text(item)
            if key and value:
                identifiers[key] = value
    return identifiers


def extract_pubmed_authors(article_node: dict[str, Any]) -> list[str]:
    author_list = article_node.get("AuthorList", {}).get("Author", [])
    if not isinstance(author_list, list):
        author_list = [author_list]
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
    if not isinstance(abstract_text, list):
        abstract_text = [abstract_text]
    for item in abstract_text:
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


def load_pubmed_paper(source_id: str, max_chars: int) -> dict[str, Any]:
    payload = request_pubmed_xml(source_id)
    article_wrapper = payload.get("PubmedArticleSet", {}).get("PubmedArticle")
    if isinstance(article_wrapper, list):
        article_wrapper = article_wrapper[0] if article_wrapper else None
    if not isinstance(article_wrapper, dict):
        raise ValueError("未找到对应的 PubMed 记录")

    medline = article_wrapper.get("MedlineCitation", {})
    article = medline.get("Article", {})
    identifiers = extract_pubmed_article_ids(article_wrapper)
    pmcid = identifiers.get("pmc")
    doi = identifiers.get("doi")
    summary = extract_pubmed_summary(article)
    pdf_url = PMC_PDF_URL_TEMPLATE.format(pmcid=pmcid) if pmcid else None
    journal_title = normalize_xml_text(article.get("Journal", {}).get("Title"))

    paper = normalize_paper_payload(
        source=PUBMED_SOURCE,
        source_id=source_id,
        title=normalize_xml_text(article.get("ArticleTitle")) or f"PubMed {source_id}",
        authors=extract_pubmed_authors(article),
        published=extract_pubmed_published(article),
        summary=trim_text(summary, 2200),
        abstract_url=PUBMED_ABSTRACT_URL_TEMPLATE.format(source_id=source_id),
        pdf_url=pdf_url,
        doi=doi,
        venue=journal_title or None,
        content=trim_text(summary, max_chars),
        content_source="pubmed_abstract",
        warning=build_generic_warning(PUBMED_SOURCE, pdf_url),
    )
    return paper


SEARCH_HANDLERS = {
    ARXIV_SOURCE: search_arxiv,
    SEMANTIC_SCHOLAR_SOURCE: search_semantic_scholar,
    PUBMED_SOURCE: search_pubmed,
}

LOAD_HANDLERS = {
    ARXIV_SOURCE: load_arxiv_paper,
    SEMANTIC_SCHOLAR_SOURCE: load_semantic_scholar_paper,
    PUBMED_SOURCE: load_pubmed_paper,
}


def search_papers(query: str, limit: int, sources: list[str] | None = None) -> dict[str, Any]:
    normalized_query = str(query or "").strip()
    if not normalized_query:
        raise ValueError("论文检索词不能为空")

    normalized_sources = normalize_sources(sources)
    per_source_limit = max(1, math.ceil(max(1, limit) / max(1, len(normalized_sources))))
    source_results: dict[str, list[dict[str, Any]]] = {source: [] for source in normalized_sources}

    with ThreadPoolExecutor(max_workers=len(normalized_sources)) as executor:
        futures = {
            executor.submit(SEARCH_HANDLERS[source], normalized_query, per_source_limit): source
            for source in normalized_sources
        }
        for future in as_completed(futures):
            source = futures[future]
            try:
                source_results[source] = future.result()
            except Exception:
                source_results[source] = []

    merged: list[dict[str, Any]] = []
    seen_keys: set[str] = set()
    remaining = True
    while remaining and len(merged) < max(1, limit):
        remaining = False
        for source in normalized_sources:
            if not source_results[source]:
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

    merged.sort(key=lambda paper: parse_sort_date(paper.get("published")), reverse=True)

    return {
        "results": merged,
        "sources": normalized_sources,
    }


def load_paper(paper_id: str, max_chars: int) -> dict[str, Any]:
    source, source_id = parse_paper_id(paper_id)
    if source not in LOAD_HANDLERS:
        raise ValueError("当前尚不支持该论文来源")
    return {
        "paper": LOAD_HANDLERS[source](source_id, max_chars),
    }


def slugify_token(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "", value.lower())
    return normalized or "paper"


def build_generic_bibtex_fields(paper: dict[str, Any]) -> tuple[str, str]:
    authors = paper.get("authors") or []
    published_year = str(paper.get("published") or datetime.utcnow().year).strip().split("-")[0]
    first_author_token = slugify_token(authors[0].split()[-1] if authors else paper.get("source") or "paper")
    title_token = slugify_token((paper.get("title") or "").split(" ")[0] if paper.get("title") else "paper")
    cite_key = f"{first_author_token}{published_year}{title_token}"
    entry_type = "article" if paper.get("venue") else "misc"
    fields = [
        f"  title = {{{paper.get('title')}}}",
        f"  author = {{{' and '.join(authors)}}}",
        f"  year = {{{published_year}}}",
    ]
    if paper.get("venue"):
        fields.append(f"  journal = {{{paper.get('venue')}}}")
    if paper.get("doi"):
        fields.append(f"  doi = {{{paper.get('doi')}}}")
    if paper.get("abstractUrl"):
        fields.append(f"  url = {{{paper.get('abstractUrl')}}}")
    fields.append(f"  note = {{{get_source_label(str(paper.get('source') or 'unknown'))}}}")
    bibtex = f"@{entry_type}{{{cite_key},\n" + ",\n".join(fields) + "\n}\n"
    return cite_key, bibtex


def build_bibtex(paper_id: str) -> dict[str, Any]:
    source, source_id = parse_paper_id(paper_id)
    if source == ARXIV_SOURCE:
        client = arxiv.Client()
        search = arxiv.Search(id_list=[source_id])
        result = next(client.results(search), None)
        if not result:
            raise ValueError("未找到可生成 BibTeX 的 arXiv 论文")
        authors = [author.name.strip() for author in result.authors if author.name.strip()]
        published_year = result.published.year if result.published else datetime.utcnow().year
        first_author_token = slugify_token(authors[0].split()[-1] if authors else "arxiv")
        title_token = slugify_token((result.title or "").split(" ")[0] if result.title else "paper")
        cite_key = f"{first_author_token}{published_year}{title_token}"
        fields = [
            f"  title = {{{result.title}}}",
            f"  author = {{{' and '.join(authors)}}}",
            f"  year = {{{published_year}}}",
            f"  eprint = {{{source_id}}}",
            "  archivePrefix = {arXiv}",
        ]
        if getattr(result, "primary_category", None):
            fields.append(f"  primaryClass = {{{result.primary_category}}}")
        if getattr(result, "doi", None):
            fields.append(f"  doi = {{{result.doi}}}")
        bibtex = "@article{" + cite_key + ",\n" + ",\n".join(fields) + "\n}\n"
        return {
            "paperId": build_paper_id(source, source_id),
            "citeKey": cite_key,
            "bibtex": bibtex,
        }

    paper = load_paper(paper_id, 6000)["paper"]
    cite_key, bibtex = build_generic_bibtex_fields(paper)
    return {
        "paperId": paper["paperId"],
        "citeKey": cite_key,
        "bibtex": bibtex,
    }


def create_model() -> ChatOpenAI:
    api_key = (
        os.environ.get("AI_API_KEY")
        or os.environ.get("OPENAI_API_KEY")
        or os.environ.get("API_KEY")
        or ""
    ).strip()
    if not api_key:
        raise ValueError("当前未配置论文助手所需的 AI_API_KEY")

    base_url = (
        os.environ.get("AI_BASE_URL")
        or os.environ.get("OPENAI_BASE_URL")
        or os.environ.get("BASE_URL")
        or "https://api.openai.com/v1"
    ).strip()
    model_name = (
        os.environ.get("AI_MODEL_NAME")
        or os.environ.get("OPENAI_MODEL")
        or os.environ.get("MODEL_NAME")
        or "gpt-4.1-mini"
    ).strip()

    return ChatOpenAI(
        model=model_name,
        api_key=api_key,
        base_url=base_url,
        temperature=0,
    )


def extract_agent_text(result: Any) -> str:
    if isinstance(result, dict):
        messages = result.get("messages")
        if isinstance(messages, list) and messages:
            last_message = messages[-1]
            content = getattr(last_message, "content", last_message)
            if isinstance(content, str):
                return content
            if isinstance(content, list):
                return "\n".join(
                    str(item.get("text") if isinstance(item, dict) else item)
                    for item in content
                    if item
                )
        if isinstance(result.get("output"), str):
            return result["output"]
    return str(result)


def answer_with_agent(
    message: str,
    selected_paper_ids: list[str] | None,
    sources: list[str] | None = None,
) -> dict[str, Any]:
    model = create_model()
    normalized_sources = normalize_sources(sources)

    @tool
    def search_research_papers(query: str) -> str:
        """Search across configured paper sources and return concise candidate papers."""
        result = search_papers(query, 6, normalized_sources)
        return json.dumps(result["results"], ensure_ascii=False)

    @tool
    def load_research_paper(target_paper_id: str) -> str:
        """Load a specific paper by opaque paperId and return readable detail text."""
        loaded = load_paper(target_paper_id, 12000)["paper"]
        return json.dumps(
            {
                "paperId": loaded["paperId"],
                "sourceLabel": loaded["sourceLabel"],
                "title": loaded["title"],
                "authors": loaded["authors"],
                "published": loaded["published"],
                "summary": loaded["summary"],
                "content": loaded["content"],
            },
            ensure_ascii=False,
        )

    system_prompt = (
        "你是一个面向论文检索与阅读场景的研究助手。"
        "当用户在比较研究方向、询问论文内容或需要候选论文时，优先调用工具。"
        "回答必须使用中文，直接给出结论、代表论文和简明依据。"
        "如果信息不足，要明确说明。"
    )
    selected_hint = ""
    if selected_paper_ids:
        selected_hint = f"\n当前阅读上下文中的论文 ID: {', '.join(selected_paper_ids[:5])}"

    agent = create_agent(
        model=model,
        tools=[search_research_papers, load_research_paper],
        system_prompt=system_prompt,
    )
    result = agent.invoke(
        {
            "messages": [
                {
                    "role": "user",
                    "content": f"{message}{selected_hint}",
                }
            ]
        }
    )
    answer = extract_agent_text(result)
    return {
        "reply": {
            "answer": answer,
            "source": "langchain_agent",
            "model": getattr(model, "model_name", "unknown"),
        }
    }


def answer_with_fallback(message: str, selected_paper_ids: list[str] | None) -> dict[str, Any]:
    hint = f" 当前阅读论文: {', '.join(selected_paper_ids[:3])}。" if selected_paper_ids else ""
    return {
        "reply": {
            "answer": (
                "当前论文 Agent 未配置远端模型，已回退为本地提示。"
                f"{hint}你可以先使用多源论文检索搜索主题，再打开具体论文查看摘要、PDF 或外链全文。"
                f"\n\n你的问题：{message}"
            ),
            "source": "local_fallback",
            "model": "local_fallback",
        }
    }


def fetch_paper_pdf(paper_id: str) -> tuple[bytes, str]:
    paper = load_paper(paper_id, 4000)["paper"]
    pdf_url = paper.get("pdfUrl")
    if not pdf_url:
        raise ValueError("当前论文来源未提供可直接访问的 PDF")

    with httpx.Client(timeout=PAPER_REQUEST_TIMEOUT_S, follow_redirects=True) as client:
        response = client.get(str(pdf_url))
        response.raise_for_status()
        return response.content, str(pdf_url)


#
# Code Review:
# - 该核心模块明确把“搜索发现源”和“全文获取源”分层，实现上虽然共用统一论文结构，但不会把“能搜到”错误等同为“默认能读到全文”。
# - 当前多源搜索优先保证来源广度和统一结果结构，排序仍保持轻量；后续若需要更强相关性排序，可继续在这一层补召回重排，而不是让前端拼逻辑。
# - BibTeX 对 `Semantic Scholar / PubMed` 先走轻量通用格式，优先保证项目文献库可导入；若后续要补足期刊卷期页码，应继续从元数据补全层增强。
