"""
 * File: test_paper_report.py
 * Module: packages/paper-assistant (论文报告生成测试)
 *
 * Responsibility:
 *   - 验证论文报告生成模块的结构化输出、约束校验和降级行为。
 *
 * Last Updated:
 *   - 2026-03-11 by Codex - 新增 paper_report 模块基础测试
"""

from __future__ import annotations

from paper_report import build_evidence_chunks, build_report_payload, evaluate_constraints


def test_build_evidence_chunks_generates_stable_chunk_ids():
    paper = {
        "paperId": "arxiv:2401.00001",
        "title": "A Test Paper",
        "summary": "summary text",
        "content": "A" * 2800,
    }
    chunks = build_evidence_chunks(paper)
    assert len(chunks) >= 2
    assert chunks[0]["id"] == "chunk-1"
    assert chunks[1]["id"] == "chunk-2"


def test_build_report_payload_contains_required_fields_without_dspy():
    paper = {
        "paperId": "arxiv:2401.00002",
        "title": "Fallback Paper",
        "summary": "This is a fallback summary.",
        "content": "Method section. Experiment section. Limitation section. Reproducibility section." * 30,
    }
    payload = build_report_payload(paper, language="zh-CN")
    assert payload["canonicalPaperId"] == paper["paperId"]
    assert payload["status"] in {"ready", "degraded"}
    assert len(payload["sections"]) >= 5
    assert isinstance(payload["constraints"]["failedRules"], list)
    assert "markdown" in payload and payload["markdown"]


def test_evaluate_constraints_flags_missing_sections_and_anchors():
    evidence_by_id = {
        "chunk-1": {"id": "chunk-1", "text": "evidence text"},
    }
    sections = [
        {
            "id": "core_findings",
            "title": "核心结论",
            "content": "",
            "anchorIds": [],
            "confidence": "low",
        }
    ]
    anchors = []
    constraints = evaluate_constraints(
        sections=sections,
        anchors=anchors,
        evidence_by_id=evidence_by_id,
    )
    assert constraints["passed"] is False
    assert constraints["score"] < 0.8
    assert constraints["failedRules"]


#
# Code Review:
# - 测试优先覆盖结构化输出和约束评分两个核心契约，避免后续改 Prompt 或模型时破坏接口稳定性。
# - 用“无 DSPy 环境”场景校验 fallback，确保部署依赖不完整时仍能返回可读报告。
