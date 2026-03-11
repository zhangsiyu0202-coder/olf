"""
 * File: __init__.py
 * Module: packages/paper-assistant (论文搜索 adapter 包)
 *
 * Responsibility:
 *   - 暴露搜索 adapter 包边界，便于聚合层按来源注册与导入。
 *
 * Last Updated:
 *   - 2026-03-10 by Codex - 初始化论文搜索 adapter 包
"""


#
# Code Review:
# - adapter 包入口保持空实现，只承担 Python 包边界职责，避免把注册或运行时代码偷偷塞进 `__init__` 里。
