"""
 * File: paper_tools.py
 * Module: packages/paper-assistant (论文工具 CLI 包装层)
 *
 * Responsibility:
 *   - 作为 Node 主站本地回退模式下的 Python 入口，负责从标准输入读取动作并调用论文核心能力。
 *   - 保持 stdin/stdout JSON 协议稳定，使 Node 主站在本地模式和远端 HTTP 服务模式之间可以平滑切换。
 *
 * Runtime Logic Overview:
 *   1. Node 进程把动作与参数通过标准输入传入。
 *   2. 本脚本调用 `paper_core.py` 中的统一多源论文能力。
 *   3. 最终把结构化 JSON 写回标准输出。
 *
 * Dependencies:
 *   - json
 *   - packages/paper-assistant/src/paper_core.py
 *
 * Last Updated:
 *   - 2026-03-11 by Codex - 新增本地 CLI 报告生成功能
"""

from __future__ import annotations

import json
import sys
from typing import Any

from paper_core import (
    answer_with_agent,
    answer_with_fallback,
    build_bibtex,
    generate_paper_report,
    load_paper,
    load_paper_metadata,
    search_papers,
)
from search_contracts import DEFAULT_SEARCH_LIMIT


def read_payload() -> dict[str, Any]:
    raw = sys.stdin.read().strip()
    if not raw:
        return {}
    return json.loads(raw)


def write_payload(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))


def main() -> None:
    payload = read_payload()
    action = str(payload.get("action") or "").strip()

    if action == "search":
        write_payload(
            search_papers(
                str(payload.get("query") or ""),
                int(payload.get("limit") or DEFAULT_SEARCH_LIMIT),
                list(payload.get("sources") or []),
            )
        )
        return

    if action == "load":
        write_payload(load_paper(str(payload.get("paperId") or ""), int(payload.get("maxChars") or 16000)))
        return

    if action == "metadata":
        write_payload(load_paper_metadata(str(payload.get("paperId") or ""), int(payload.get("maxChars") or 6000)))
        return

    if action == "bibtex":
        write_payload(build_bibtex(str(payload.get("paperId") or "")))
        return

    if action == "agent":
        message = str(payload.get("message") or "").strip()
        selected_paper_ids = [str(item).strip() for item in list(payload.get("selectedPaperIds") or []) if str(item).strip()]
        if not message:
            raise ValueError("论文助手问题不能为空")
        try:
            write_payload(
                answer_with_agent(
                    message,
                    selected_paper_ids,
                    list(payload.get("sources") or []),
                )
            )
        except Exception as error:
            write_payload(answer_with_fallback(message, selected_paper_ids, str(error)))
        return

    if action == "report_generate":
        write_payload(
            generate_paper_report(
                str(payload.get("paperId") or ""),
                int(payload.get("maxChars") or 24000),
                str(payload.get("language") or "zh-CN"),
            )
        )
        return

    raise ValueError("不支持的论文动作")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        write_payload(
            {
                "error": {
                    "message": str(error),
                    "type": error.__class__.__name__,
                }
            }
        )
        raise SystemExit(1)


#
# Code Review:
# - CLI 包装层现在不再自己维护论文逻辑，只保留协议转换职责，避免本地模式和 HTTP 服务模式各跑一套实现。
# - 动作列表继续保持扁平简单，优先保证 Node 主站在没有远端论文服务时仍可本地跑通。
# - 后续若新增更多论文动作，应优先加到 `paper_core.py`，再由这里做薄封装，而不是反向在这里堆业务细节。
# - 默认搜索 limit 也改成复用统一契约，避免本地 CLI 回退模式和 HTTP 服务模式在召回规模上出现肉眼可见的差异。
