"""
 * File: paper_service_app.py
 * Module: packages/paper-assistant (论文搜索 HTTP 服务)
 *
 * Responsibility:
 *   - 暴露独立论文搜索服务的 FastAPI 应用，供香港节点部署。
 *   - 复用论文核心能力，向主站提供多源搜索、详情、BibTeX、Agent 和 PDF 代理接口。
 *
 * Runtime Logic Overview:
 *   1. 主站或外部调用方通过 HTTP 请求访问论文搜索服务。
 *   2. FastAPI 路由调用 `paper_core.py` 中的统一多源论文能力。
 *   3. PDF 请求会优先走本地缓存，避免香港节点反复命中上游论文源。
 *
 * Dependencies:
 *   - fastapi
 *   - pydantic
 *   - packages/paper-assistant/src/paper_core.py
 *
 * Last Updated:
 *   - 2026-03-08 by Codex - 初始化可独立部署的论文搜索 FastAPI 服务
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path
from urllib.parse import quote

from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from paper_core import (
    answer_with_agent,
    answer_with_fallback,
    build_bibtex,
    fetch_paper_pdf,
    load_paper,
    search_papers,
)

repository_root = Path(__file__).resolve().parents[3]
paper_service_cache_root = Path(
    os.environ.get("PAPER_SERVICE_CACHE_ROOT", str(repository_root / ".runtime" / "paper-service-cache"))
)


class PaperSearchRequest(BaseModel):
    query: str
    limit: int = Field(default=6, ge=1, le=20)
    sources: list[str] = Field(default_factory=list)


class PaperAgentRequest(BaseModel):
    message: str
    selectedPaperIds: list[str] = Field(default_factory=list)
    sources: list[str] = Field(default_factory=list)


app = FastAPI(
    title="Overleaf Clone Paper Search Service",
    version="0.1.0",
)


def get_paper_pdf_cache_path(paper_id: str) -> Path:
    return paper_service_cache_root / f"{quote(paper_id, safe='')}.pdf"


def write_binary_atomically(target_path: Path, content: bytes) -> None:
    target_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=target_path.parent, delete=False) as handle:
        handle.write(content)
        temp_path = Path(handle.name)
    temp_path.replace(target_path)


@app.get("/health")
def healthcheck() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "paper-search",
    }


@app.post("/v1/search")
def search_endpoint(payload: PaperSearchRequest) -> dict:
    try:
        return search_papers(payload.query, payload.limit, payload.sources)
    except Exception as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.get("/v1/papers/{paper_id:path}/bibtex")
def paper_bibtex_endpoint(paper_id: str) -> dict:
    try:
        return build_bibtex(paper_id)
    except Exception as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.post("/v1/agent")
def paper_agent_endpoint(payload: PaperAgentRequest) -> dict:
    try:
        return answer_with_agent(payload.message, payload.selectedPaperIds, payload.sources)
    except Exception:
        return answer_with_fallback(payload.message, payload.selectedPaperIds)


@app.get("/v1/papers/{paper_id:path}/pdf")
def paper_pdf_endpoint(paper_id: str) -> Response:
    cache_path = get_paper_pdf_cache_path(paper_id)

    if cache_path.exists():
        return Response(content=cache_path.read_bytes(), media_type="application/pdf")

    try:
        pdf_bytes, resolved_url = fetch_paper_pdf(paper_id)
    except Exception as error:
        raise HTTPException(status_code=404, detail=str(error)) from error

    write_binary_atomically(cache_path, pdf_bytes)
    headers = {
        "X-Paper-Pdf-Source": resolved_url,
    }
    return Response(content=pdf_bytes, media_type="application/pdf", headers=headers)


@app.get("/v1/papers/{paper_id:path}")
def paper_detail_endpoint(paper_id: str, max_chars: int = 18000) -> dict:
    try:
        return load_paper(paper_id, max_chars)
    except Exception as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


#
# Code Review:
# - HTTP 服务只暴露论文相关能力，不碰项目、权限和文件写入，这样部署到香港节点后可以保持边界清晰。
# - PDF 代理接口采用本地缓存优先，能明显减少跨境重复下载；缓存策略仍保持简单文件缓存，先满足当前产品链路。
# - 所有路由都直接复用 `paper_core.py`，避免 CLI 模式和远端服务模式在搜索规则、来源字段和 BibTeX 生成上再次分叉。
