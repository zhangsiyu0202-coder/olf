"""
 * File: base.py
 * Module: packages/paper-assistant (论文搜索 adapter 基类)
 *
 * Responsibility:
 *   - 定义论文搜索 adapter 的最小接口，确保聚合层可以一致地调度不同来源。
 *
 * Dependencies:
 *   - typing
 *
 * Last Updated:
 *   - 2026-03-10 by Codex - 新增论文搜索 adapter 协议定义
"""

from __future__ import annotations

from typing import Any, Protocol


class SearchAdapter(Protocol):
    source: str

    def search(self, query: str, limit: int) -> list[dict[str, Any]]:
        """Search papers from a single source."""


#
# Code Review:
# - 这里故意只保留极薄接口，避免 adapter 基类反向承载重试、日志和状态逻辑，那些应继续留在 orchestrator。
