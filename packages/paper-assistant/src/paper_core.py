"""
 * File: paper_core.py
 * Module: packages/paper-assistant (论文多源核心)
 *
 * Responsibility:
 *   - 提供多源论文搜索、详情加载、BibTeX 生成、PDF 获取和研究 Agent 的统一核心能力。
 *   - 把搜索发现层与全文获取层继续收敛在同一边界内，避免 CLI、HTTP 服务和 Node 主站维护多套规则。
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
 *   - 后续可继续增强 `OpenAlex` 的元数据补全与去重权重，但仍应保持“搜索发现层”和“全文获取层”分离。
 *   - 去重、排序和缓存若继续增强，也应优先在本模块扩展，而不是散落到 API 或前端。
 *
 * Dependencies:
 *   - httpx
 *   - xmltodict
 *   - arxiv
 *   - paper_resolver
 *   - search_adapters
 *   - search_contracts
 *   - search_orchestrator
 *   - langchain
 *   - langchain-openai
 *
 * Last Updated:
 *   - 2026-03-11 by Codex - 新增结构化论文报告生成能力（DSPy 约束链路）
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime
from typing import Any
from urllib.parse import quote, urlparse

import arxiv
import httpx
import xmltodict
from langchain.agents import create_agent
from langchain.tools import tool
from langchain_community.document_loaders import ArxivLoader
from langchain_openai import ChatOpenAI

from paper_report import build_report_payload
from paper_resolver import resolve_readable_paper_id
from search_adapters.openalex import OPENALEX_API_URL, normalize_openalex_item
from search_contracts import (
    ARXIV_SOURCE,
    DISCOVERY_SOURCES,
    OPENALEX_SOURCE,
    PAPER_REQUEST_TIMEOUT_S,
    PUBMED_SOURCE,
    SOURCE_LABELS,
    build_generic_warning,
    build_paper_id,
    get_source_label,
    normalize_authors,
    normalize_paper_payload,
    normalize_sources,
    trim_text,
)
from search_orchestrator import search_papers as orchestrate_search_papers

PUBMED_ABSTRACT_URL_TEMPLATE = "https://pubmed.ncbi.nlm.nih.gov/{source_id}/"
PMC_PDF_URL_TEMPLATE = "https://pmc.ncbi.nlm.nih.gov/articles/{pmcid}/pdf/"
AGENT_STABLE_SOURCES = [ARXIV_SOURCE, PUBMED_SOURCE]


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
        if source and source_id:
            raise ValueError("当前尚不支持该论文来源")

    return ARXIV_SOURCE, value.replace(".pdf", "")


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


def request_openalex_work(source_id: str) -> dict[str, Any]:
    params: dict[str, Any] = {}
    mailto = os.environ.get("OPENALEX_EMAIL", "").strip()
    if mailto:
        params["mailto"] = mailto

    try:
        with httpx.Client(timeout=PAPER_REQUEST_TIMEOUT_S, follow_redirects=True) as client:
            response = client.get(
                f"{OPENALEX_API_URL}/{quote(source_id, safe='')}",
                params=params,
                headers={"User-Agent": "overleaf-clone-paper-service/0.1"},
            )
            response.raise_for_status()
            return response.json()
    except httpx.HTTPStatusError as error:
        if error.response.status_code == 404:
            raise ValueError("未找到对应的 OpenAlex 论文") from error
        raise ValueError("获取 OpenAlex 论文详情失败") from error
    except Exception as error:  # noqa: BLE001
        raise ValueError("获取 OpenAlex 论文详情失败") from error


def load_openalex_metadata(source_id: str) -> dict[str, Any]:
    item = request_openalex_work(source_id)
    return normalize_openalex_item(item)


def load_openalex_paper(source_id: str, max_chars: int) -> dict[str, Any]:
    item = request_openalex_work(source_id)
    base_paper = normalize_openalex_item(item)
    resolved_paper_id = resolve_readable_paper_id(base_paper, item)
    if not resolved_paper_id:
        raise ValueError("未找到可读来源")
    _, resolved_source_id = parse_paper_id(resolved_paper_id)
    if resolved_paper_id.startswith(f"{ARXIV_SOURCE}:"):
        return load_arxiv_paper(resolved_source_id, max_chars)
    return load_pubmed_paper(resolved_source_id, max_chars)


READABLE_LOAD_HANDLERS = {
    ARXIV_SOURCE: load_arxiv_paper,
    PUBMED_SOURCE: load_pubmed_paper,
}

DISCOVERY_METADATA_HANDLERS = {
    OPENALEX_SOURCE: load_openalex_metadata,
}

LOAD_HANDLERS = {
    **READABLE_LOAD_HANDLERS,
    OPENALEX_SOURCE: load_openalex_paper,
}


def search_papers(query: str, limit: int, sources: list[str] | None = None) -> dict[str, Any]:
    return orchestrate_search_papers(query, limit, sources)


def load_paper(paper_id: str, max_chars: int) -> dict[str, Any]:
    source, source_id = parse_paper_id(paper_id)
    if source not in LOAD_HANDLERS:
        raise ValueError("当前尚不支持该论文来源")
    return {
        "paper": LOAD_HANDLERS[source](source_id, max_chars),
    }


def load_paper_metadata(paper_id: str, max_chars: int = 6000) -> dict[str, Any]:
    source, source_id = parse_paper_id(paper_id)
    if source in DISCOVERY_METADATA_HANDLERS:
        return {
            "paper": DISCOVERY_METADATA_HANDLERS[source](source_id),
        }
    if source in READABLE_LOAD_HANDLERS:
        return {
            "paper": READABLE_LOAD_HANDLERS[source](source_id, max_chars),
        }
    raise ValueError("当前尚不支持该论文来源")


def load_paper_for_report(paper_id: str, max_chars: int) -> dict[str, Any]:
    try:
        return load_paper(paper_id, max_chars)["paper"]
    except Exception as error:  # noqa: BLE001
        source, _ = parse_paper_id(paper_id)
        if source in DISCOVERY_METADATA_HANDLERS and str(error) == "未找到可读来源":
            return load_paper_metadata(paper_id, min(max_chars, 8000))["paper"]
        raise


def generate_paper_report(paper_id: str, max_chars: int = 24000, language: str = "zh-CN") -> dict[str, Any]:
    paper = load_paper_for_report(paper_id, max_chars)
    report = build_report_payload(paper, language=language)
    return {
        "paper": paper,
        "report": report,
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

    if source in DISCOVERY_SOURCES:
        try:
            resolved_paper = load_paper(paper_id, 6000)["paper"]
        except ValueError as error:
            if str(error) != "未找到可读来源":
                raise
            paper = load_paper_metadata(paper_id, 6000)["paper"]
        else:
            return build_bibtex(resolved_paper["paperId"])
    else:
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
    agent_search_sources = [source for source in normalized_sources if source in AGENT_STABLE_SOURCES] or AGENT_STABLE_SOURCES.copy()

    @tool
    def search_research_papers(query: str) -> str:
        """Search across configured paper sources and return concise candidate papers."""
        result = search_papers(query, 6, agent_search_sources)
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


def answer_with_fallback(
    message: str,
    selected_paper_ids: list[str] | None,
    reason: str | None = None,
) -> dict[str, Any]:
    hint = f" 当前阅读论文: {', '.join(selected_paper_ids[:3])}。" if selected_paper_ids else ""
    normalized_reason = str(reason or "").strip()
    if "AI_API_KEY" in normalized_reason or "OPENAI_API_KEY" in normalized_reason:
        prefix = "当前论文 Agent 未配置远端模型，已回退为本地提示。"
    elif normalized_reason:
        prefix = f"当前论文 Agent 远端调用失败（{normalized_reason[:140]}），已回退为本地提示。"
    else:
        prefix = "当前论文 Agent 远端调用失败，已回退为本地提示。"
    return {
        "reply": {
            "answer": (
                prefix
                + " "
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
# - `OpenAlex` 现在只承担发现源职责，阅读时必须先解析到 `arXiv / PubMed`，避免继续让低质量发现源污染阅读链路。
# - discovery 源的 BibTeX 会优先复用解析后的可读源；只有解析失败时才回退到 metadata-only 通用 BibTeX，保证引用导入不断链。
