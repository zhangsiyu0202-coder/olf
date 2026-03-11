"""
 * File: paper_report.py
 * Module: packages/paper-assistant (论文结构化报告生成)
 *
 * Responsibility:
 *   - 基于论文内容构建 evidence chunks，并调用 DSPy 生成结构化报告。
 *   - 对报告执行可校验约束评分，按规则输出 `ready/degraded` 状态。
 *
 * Runtime Logic Overview:
 *   1. 从 `paper` 构建可引用的 evidence chunk 列表（含稳定 chunkId）。
 *   2. 优先使用 DSPy (`Signature + JSONAdapter + Refine`) 生成报告 JSON。
 *   3. 若模型输出不满足约束，则按失败规则返回降级报告，而非中断阅读链路。
 *
 * Dependencies:
 *   - json
 *   - os
 *   - re
 *   - uuid
 *   - datetime
 *   - typing
 *
 * Last Updated:
 *   - 2026-03-11 by Codex - 新增 DSPy 报告生成与约束评分模块
"""

from __future__ import annotations

import inspect
import json
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

REQUIRED_SECTION_IDS = [
    "core_findings",
    "method_overview",
    "experiments_and_evidence",
    "limitations",
    "reproducibility_actions",
]

REQUIRED_SECTION_TITLES = {
    "core_findings": "核心结论",
    "method_overview": "方法要点",
    "experiments_and_evidence": "实验与证据",
    "limitations": "局限性",
    "reproducibility_actions": "可复现实操建议",
}

DEFAULT_CHUNK_SIZE = 1200
DEFAULT_CHUNK_OVERLAP = 200
DEFAULT_MAX_REFINES = 3
DEFAULT_MIN_CONSTRAINT_SCORE = 0.72
DEFAULT_REPORT_TTL_HOURS = 168


def now_utc_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def resolve_report_ttl_hours() -> int:
    raw_value = str(os.environ.get("PAPER_REPORT_TTL_HOURS", str(DEFAULT_REPORT_TTL_HOURS))).strip()
    try:
        parsed = int(raw_value)
    except ValueError:
        parsed = DEFAULT_REPORT_TTL_HOURS
    return max(1, min(parsed, 24 * 30))


def resolve_report_max_refines() -> int:
    raw_value = str(os.environ.get("PAPER_REPORT_MAX_REFINES", str(DEFAULT_MAX_REFINES))).strip()
    try:
        parsed = int(raw_value)
    except ValueError:
        parsed = DEFAULT_MAX_REFINES
    return max(1, min(parsed, 8))


def resolve_min_constraint_score() -> float:
    raw_value = str(os.environ.get("PAPER_REPORT_CONSTRAINT_MIN_SCORE", str(DEFAULT_MIN_CONSTRAINT_SCORE))).strip()
    try:
        parsed = float(raw_value)
    except ValueError:
        parsed = DEFAULT_MIN_CONSTRAINT_SCORE
    return max(0.0, min(parsed, 1.0))


def normalize_report_text(value: str | None) -> str:
    normalized = re.sub(r"\s+", " ", str(value or "").strip())
    return normalized


def chunk_text(text: str, chunk_size: int = DEFAULT_CHUNK_SIZE, overlap: int = DEFAULT_CHUNK_OVERLAP) -> list[str]:
    normalized_text = str(text or "").strip()
    if not normalized_text:
        return []
    chunk_size = max(300, min(chunk_size, 4000))
    overlap = max(0, min(overlap, chunk_size // 2))
    chunks: list[str] = []
    cursor = 0
    text_length = len(normalized_text)
    while cursor < text_length:
        window = normalized_text[cursor : cursor + chunk_size].strip()
        if window:
            chunks.append(window)
        if cursor + chunk_size >= text_length:
            break
        cursor += chunk_size - overlap
    return chunks


def build_evidence_chunks(paper: dict[str, Any]) -> list[dict[str, Any]]:
    content = str(paper.get("content") or "").strip()
    summary = str(paper.get("summary") or "").strip()
    source_text = content or summary or str(paper.get("title") or "").strip()
    raw_chunks = chunk_text(source_text)
    evidence_chunks: list[dict[str, Any]] = []
    for index, chunk in enumerate(raw_chunks, start=1):
        evidence_chunks.append(
            {
                "id": f"chunk-{index}",
                "chunkId": f"chunk-{index}",
                "text": chunk,
                "sectionHint": REQUIRED_SECTION_TITLES.get(REQUIRED_SECTION_IDS[(index - 1) % len(REQUIRED_SECTION_IDS)], "Section"),
                "pageHint": None,
            }
        )
    if not evidence_chunks:
        evidence_chunks.append(
            {
                "id": "chunk-1",
                "chunkId": "chunk-1",
                "text": summary or "当前论文暂无可用正文，仅能基于元数据生成简报。",
                "sectionHint": "Metadata",
                "pageHint": None,
            }
        )
    return evidence_chunks


def safe_json_loads(raw_value: str) -> dict[str, Any]:
    try:
        parsed = json.loads(raw_value)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass
    return {}


def normalize_report_sections(raw_sections: Any, evidence_ids: set[str]) -> list[dict[str, Any]]:
    sections: list[dict[str, Any]] = []
    if not isinstance(raw_sections, list):
        raw_sections = []

    for section_index, section in enumerate(raw_sections):
        if not isinstance(section, dict):
            continue
        section_id = str(section.get("id") or REQUIRED_SECTION_IDS[min(section_index, len(REQUIRED_SECTION_IDS) - 1)]).strip()
        if not section_id:
            section_id = REQUIRED_SECTION_IDS[min(section_index, len(REQUIRED_SECTION_IDS) - 1)]
        title = normalize_report_text(section.get("title")) or REQUIRED_SECTION_TITLES.get(section_id, "章节")
        content = normalize_report_text(section.get("content"))
        raw_anchor_ids = section.get("anchorIds")
        if not isinstance(raw_anchor_ids, list):
            raw_anchor_ids = []
        normalized_anchor_ids: list[str] = []
        for item in raw_anchor_ids:
            anchor_id = str(item).strip()
            if anchor_id in evidence_ids and anchor_id not in normalized_anchor_ids:
                normalized_anchor_ids.append(anchor_id)
        sections.append(
            {
                "id": section_id,
                "title": title,
                "content": content,
                "anchorIds": normalized_anchor_ids,
                "confidence": "high" if len(normalized_anchor_ids) >= 2 else "medium",
            }
        )

    existing_ids = {section["id"] for section in sections}
    for required_id in REQUIRED_SECTION_IDS:
        if required_id in existing_ids:
            continue
        sections.append(
            {
                "id": required_id,
                "title": REQUIRED_SECTION_TITLES[required_id],
                "content": "",
                "anchorIds": [],
                "confidence": "low",
            }
        )
    return sections


def normalize_report_anchors(raw_anchors: Any, evidence_by_id: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    anchors: list[dict[str, Any]] = []
    if not isinstance(raw_anchors, list):
        raw_anchors = []

    seen_anchor_ids: set[str] = set()
    for anchor in raw_anchors:
        if not isinstance(anchor, dict):
            continue
        chunk_id = str(anchor.get("chunkId") or anchor.get("id") or "").strip()
        if not chunk_id or chunk_id not in evidence_by_id:
            continue
        if chunk_id in seen_anchor_ids:
            continue
        seen_anchor_ids.add(chunk_id)
        evidence_chunk = evidence_by_id[chunk_id]
        anchors.append(
            {
                "id": chunk_id,
                "chunkId": chunk_id,
                "excerpt": normalize_report_text(anchor.get("excerpt")) or evidence_chunk["text"][:220],
                "pageNumber": anchor.get("pageNumber") if isinstance(anchor.get("pageNumber"), int) else None,
                "score": 1.0 if normalize_report_text(anchor.get("excerpt")) else 0.6,
            }
        )

    if not anchors:
        first_evidence = next(iter(evidence_by_id.values()))
        anchors.append(
            {
                "id": str(first_evidence["id"]),
                "chunkId": str(first_evidence["chunkId"]),
                "excerpt": str(first_evidence["text"])[:220],
                "pageNumber": None,
                "score": 0.5,
            }
        )
    return anchors


def build_markdown(sections: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for section in sections:
        lines.append(f"## {section['title']}")
        lines.append("")
        lines.append(section["content"] or "该章节内容不足，建议手动补充。")
        if section["anchorIds"]:
            lines.append("")
            lines.append(f"证据锚点: {', '.join(section['anchorIds'])}")
        lines.append("")
    return "\n".join(lines).strip()


def evaluate_constraints(
    *,
    sections: list[dict[str, Any]],
    anchors: list[dict[str, Any]],
    evidence_by_id: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    failed_rules: list[str] = []
    section_by_id = {section["id"]: section for section in sections}

    missing_sections = [section_id for section_id in REQUIRED_SECTION_IDS if not normalize_report_text(section_by_id.get(section_id, {}).get("content"))]
    if missing_sections:
        failed_rules.append(f"缺少章节内容: {', '.join(missing_sections)}")

    all_anchor_ids = {str(anchor["id"]) for anchor in anchors}
    invalid_anchor_ids: list[str] = []
    for section in sections:
        for anchor_id in section.get("anchorIds", []):
            if anchor_id not in evidence_by_id:
                invalid_anchor_ids.append(anchor_id)
            if anchor_id not in all_anchor_ids:
                invalid_anchor_ids.append(anchor_id)
    if invalid_anchor_ids:
        failed_rules.append(f"存在无效锚点: {', '.join(sorted(set(invalid_anchor_ids)))}")

    uncovered_sections = [section["id"] for section in sections if not section.get("anchorIds")]
    if uncovered_sections:
        failed_rules.append(f"以下章节缺少证据锚点: {', '.join(uncovered_sections)}")

    score = 1.0
    if missing_sections:
        score -= 0.45
    if invalid_anchor_ids:
        score -= 0.35
    if uncovered_sections:
        score -= 0.2
    score = max(0.0, min(score, 1.0))

    min_score = resolve_min_constraint_score()
    return {
        "passed": score >= min_score and not failed_rules,
        "score": score,
        "failedRules": failed_rules,
    }


def build_fallback_report(paper: dict[str, Any], evidence_chunks: list[dict[str, Any]]) -> dict[str, Any]:
    sections: list[dict[str, Any]] = []
    evidence_ids = [str(chunk["id"]) for chunk in evidence_chunks]
    evidence_texts = [str(chunk["text"]) for chunk in evidence_chunks]

    for index, section_id in enumerate(REQUIRED_SECTION_IDS):
        chunk_id = evidence_ids[min(index, len(evidence_ids) - 1)]
        chunk_text_value = evidence_texts[min(index, len(evidence_texts) - 1)]
        prefix = {
            "core_findings": "基于当前可读内容，论文最核心结论是：",
            "method_overview": "方法层面可以提炼为：",
            "experiments_and_evidence": "实验与证据可观察到：",
            "limitations": "从可见文本看，潜在局限包括：",
            "reproducibility_actions": "如果要复现，建议优先执行：",
        }.get(section_id, "要点：")
        sections.append(
            {
                "id": section_id,
                "title": REQUIRED_SECTION_TITLES[section_id],
                "content": f"{prefix}{chunk_text_value[:280]}",
                "anchorIds": [chunk_id],
                "confidence": "medium",
            }
        )

    anchors = [
        {
            "id": str(chunk["id"]),
            "chunkId": str(chunk["chunkId"]),
            "excerpt": str(chunk["text"])[:220],
            "pageNumber": None,
            "score": 0.6,
        }
        for chunk in evidence_chunks[: min(8, len(evidence_chunks))]
    ]

    return {
        "summary": normalize_report_text(paper.get("summary")) or "当前基于可用内容生成了结构化简报。",
        "sections": sections,
        "anchors": anchors,
        "model": "local_fallback",
        "engine": "heuristic_fallback",
    }


def resolve_dspy_lm_kwargs(dspy_module: Any, api_key: str, base_url: str) -> dict[str, Any]:
    kwargs: dict[str, Any] = {"api_key": api_key}
    try:
        signature = inspect.signature(dspy_module.LM.__init__)
    except Exception:
        signature = None
    if signature is None:
        kwargs["base_url"] = base_url
        return kwargs
    if "api_base" in signature.parameters:
        kwargs["api_base"] = base_url
    elif "base_url" in signature.parameters:
        kwargs["base_url"] = base_url
    return kwargs


def generate_report_with_dspy(
    *,
    paper: dict[str, Any],
    evidence_chunks: list[dict[str, Any]],
) -> dict[str, Any]:
    api_key = (
        os.environ.get("AI_API_KEY")
        or os.environ.get("OPENAI_API_KEY")
        or os.environ.get("API_KEY")
        or ""
    ).strip()
    if not api_key:
        raise RuntimeError("未配置 AI_API_KEY，无法运行 DSPy 报告生成")

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
    dspy_model_name = model_name if "/" in model_name else f"openai/{model_name}"

    try:
        import dspy  # type: ignore
    except Exception as error:  # noqa: BLE001
        raise RuntimeError(f"当前环境未安装 dspy: {error}") from error

    lm_kwargs = resolve_dspy_lm_kwargs(dspy, api_key, base_url)
    lm = dspy.LM(dspy_model_name, **lm_kwargs)
    dspy.settings.configure(lm=lm)

    class PaperReportSignature(dspy.Signature):
        """根据论文证据输出结构化报告 JSON。"""

        paper_title = dspy.InputField(desc="论文标题")
        paper_summary = dspy.InputField(desc="论文摘要")
        evidence_json = dspy.InputField(desc="证据块数组 JSON")
        constraints = dspy.InputField(desc="必须满足的约束规则")
        feedback = dspy.InputField(desc="上一轮失败反馈，没有则传空字符串")
        report_json = dspy.OutputField(desc="报告 JSON 字符串")

    predictor = dspy.Predict(PaperReportSignature)
    constraint_text = (
        "必须返回 JSON 对象，包含 summary/sections/anchors。"
        "sections 必须包含 core_findings/method_overview/experiments_and_evidence/limitations/reproducibility_actions。"
        "每个 section 必须含 anchorIds，且只能引用 evidence_json 里的 id。"
    )
    evidence_json = json.dumps(
        [{"id": chunk["id"], "text": chunk["text"][:520]} for chunk in evidence_chunks[:40]],
        ensure_ascii=False,
    )
    max_refines = resolve_report_max_refines()
    feedback = ""
    parsed_payload: dict[str, Any] = {}
    evidence_by_id = {str(chunk["id"]): chunk for chunk in evidence_chunks}

    for _ in range(max_refines):
        if hasattr(dspy, "JSONAdapter"):
            with dspy.context(adapter=dspy.JSONAdapter()):
                result = predictor(
                    paper_title=str(paper.get("title") or ""),
                    paper_summary=str(paper.get("summary") or ""),
                    evidence_json=evidence_json,
                    constraints=constraint_text,
                    feedback=feedback,
                )
        else:
            result = predictor(
                paper_title=str(paper.get("title") or ""),
                paper_summary=str(paper.get("summary") or ""),
                evidence_json=evidence_json,
                constraints=constraint_text,
                feedback=feedback,
            )

        raw_report_json = getattr(result, "report_json", None)
        if raw_report_json is None and isinstance(result, dict):
            raw_report_json = result.get("report_json")
        parsed_payload = safe_json_loads(str(raw_report_json or "").strip())

        sections = normalize_report_sections(parsed_payload.get("sections"), set(evidence_by_id.keys()))
        anchors = normalize_report_anchors(parsed_payload.get("anchors"), evidence_by_id)
        constraints = evaluate_constraints(
            sections=sections,
            anchors=anchors,
            evidence_by_id=evidence_by_id,
        )
        if constraints["passed"]:
            return {
                "summary": normalize_report_text(parsed_payload.get("summary")) or str(paper.get("summary") or ""),
                "sections": sections,
                "anchors": anchors,
                "model": model_name,
                "engine": "dspy",
            }
        feedback = "; ".join(constraints["failedRules"]) or "请补齐缺失章节与锚点。"

    sections = normalize_report_sections(parsed_payload.get("sections"), set(evidence_by_id.keys()))
    anchors = normalize_report_anchors(parsed_payload.get("anchors"), evidence_by_id)
    return {
        "summary": normalize_report_text(parsed_payload.get("summary")) or str(paper.get("summary") or ""),
        "sections": sections,
        "anchors": anchors,
        "model": model_name,
        "engine": "dspy",
    }


def build_report_payload(paper: dict[str, Any], language: str = "zh-CN") -> dict[str, Any]:
    evidence_chunks = build_evidence_chunks(paper)
    evidence_by_id = {str(chunk["id"]): chunk for chunk in evidence_chunks}

    try:
        generated = generate_report_with_dspy(paper=paper, evidence_chunks=evidence_chunks)
    except Exception:
        generated = build_fallback_report(paper, evidence_chunks)

    sections = normalize_report_sections(generated.get("sections"), set(evidence_by_id.keys()))
    anchors = normalize_report_anchors(generated.get("anchors"), evidence_by_id)
    constraints = evaluate_constraints(
        sections=sections,
        anchors=anchors,
        evidence_by_id=evidence_by_id,
    )
    generated_at = now_utc_iso()
    expires_at = (datetime.now(tz=timezone.utc) + timedelta(hours=resolve_report_ttl_hours())).isoformat()
    markdown = build_markdown(sections)

    return {
        "reportId": str(uuid.uuid4()),
        "canonicalPaperId": str(paper.get("paperId") or ""),
        "paperId": str(paper.get("paperId") or ""),
        "sourcePaperId": str(paper.get("paperId") or ""),
        "title": str(paper.get("title") or "Untitled"),
        "summary": normalize_report_text(generated.get("summary")) or str(paper.get("summary") or ""),
        "sections": sections,
        "anchors": anchors,
        "markdown": markdown,
        "constraints": constraints,
        "status": "ready" if constraints["passed"] else "degraded",
        "model": str(generated.get("model") or "unknown"),
        "engine": str(generated.get("engine") or "dspy"),
        "language": language,
        "generatedAt": generated_at,
        "expiresAt": expires_at,
    }


#
# Code Review:
# - 报告生成链路优先保证“可校验结构 + 可降级输出”，即便模型输出异常也不会把阅读流程直接打断。
# - 约束规则显式落地为 `failedRules`，前端和运维都能直接看出是“缺章节”还是“锚点失效”。
# - DSPy 调用做了 API 形态探测与兜底，尽量降低不同版本参数差异导致的运行时脆弱性。
