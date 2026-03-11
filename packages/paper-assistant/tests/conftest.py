"""
 * File: conftest.py
 * Module: packages/paper-assistant (pytest 测试引导)
 *
 * Responsibility:
 *   - 为论文搜索层测试补充 `src` 目录导入路径，确保测试可直接导入 adapter 与聚合层模块。
 *
 * Last Updated:
 *   - 2026-03-10 by Codex - 新增 paper-assistant pytest 路径引导
"""

from __future__ import annotations

import sys
from pathlib import Path

tests_root = Path(__file__).resolve().parent
source_root = tests_root.parent / "src"

if str(source_root) not in sys.path:
    sys.path.insert(0, str(source_root))


#
# Code Review:
# - 测试层显式把 `src` 注入导入路径，避免依赖运行目录偶然正确，保证本地与 CI 的测试入口行为一致。
