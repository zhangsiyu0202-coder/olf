"""
 * File: main.py
 * Module: apps/paper-service (论文搜索服务入口)
 *
 * Responsibility:
 *   - 提供独立部署到香港节点的论文搜索服务入口。
 *   - 复用 `packages/paper-assistant` 中的 FastAPI 应用定义，避免服务入口和论文能力实现混杂。
 *
 * Runtime Logic Overview:
 *   1. `uvicorn` 从本文件加载 `app`。
 *   2. 本文件把仓库根目录和论文模块目录加入导入路径。
 *   3. 实际路由与论文能力由 `paper_service_app.py` 提供。
 *
 * Dependencies:
 *   - pathlib
 *   - sys
 *   - packages/paper-assistant/src/paper_service_app.py
 *
 * Last Updated:
 *   - 2026-03-08 by Codex - 初始化独立论文搜索服务入口
"""

from __future__ import annotations

import sys
from pathlib import Path

current_file = Path(__file__).resolve()
repository_root = current_file.parents[2]
paper_assistant_source = repository_root / "packages" / "paper-assistant" / "src"

if str(paper_assistant_source) not in sys.path:
    sys.path.insert(0, str(paper_assistant_source))

from paper_service_app import app  # noqa: E402


#
# Code Review:
# - 独立服务入口保持极薄，只负责导入路径和 `app` 暴露，避免部署层把论文业务逻辑重新包一层。
# - 这里没有引入额外框架包装，优先保证香港节点部署时的可解释性和可维护性。
