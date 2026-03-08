"""
 * File: context_tools.py
 * Module: packages/ai-assistant (Python 上下文优化器)
 *
 * Responsibility:
 *   - 作为 Node AI 服务的可选增强后端，尝试调用 cased-kit、semchunk、LLMLingua。
 *   - 输出稳定 JSON，供上层统一构造 prompt 和 inline completion 上下文。
 *   - 在依赖缺失或初始化失败时，返回可解释的回退元信息，而不是让主链路崩溃。
 *
 * Runtime Logic Overview:
 *   1. 从 stdin 读取上下文请求。
 *   2. 提取项目结构、当前文件信号、语义分块和压缩后的上下文摘要。
 *   3. 以 JSON 写回 stdout，供 Node 进程合并为 `optimizedDigest`。
 *
 * Key Data Flow:
 *   - 输入：项目路径、当前文件内容、选中文本、编译日志、光标前后缀。
 *   - 输出：signals、repoSummary、semanticChunks、compressedContextText、optimizerMeta。
 *
 * Future Extension:
 *   - 可继续加入更细的标签索引、引用索引和跨文件依赖关系。
 *   - 若后续确认 cased-kit 的 LaTeX 语义收益足够高，可替换当前轻量文件扫描逻辑。
 *
 * Dependencies:
 *   - Python 3.10+
 *   - cased-kit (optional)
 *   - semchunk (optional)
 *   - LLMLingua (optional)
 *
 * Last Updated:
 *   - 2026-03-07 by Codex - 新增 AI 上下文增强 Python 适配器
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any

TEXT_FILE_EXTENSIONS = {".tex", ".bib", ".sty", ".cls", ".md", ".txt"}
MAX_FILE_COUNT = 48
MAX_CHUNK_COUNT = 3
MAX_COMPRESSED_LENGTH = 1800
_PROMPT_COMPRESSOR = None
_PROMPT_COMPRESSOR_ERROR = None
ENABLE_LLMLINGUA = os.environ.get("AI_ENABLE_LLMLINGUA", "0") == "1"


def trim_text(value: str, max_length: int) -> str:
    if not value:
        return ""

    if len(value) <= max_length:
        return value

    return f"{value[:max_length]}\n...[truncated]"


def split_into_paragraph_chunks(content: str) -> list[str]:
    if not content:
        return []

    return [chunk.strip() for chunk in re.split(r"\n{2,}", content) if chunk.strip()]


def extract_document_signals(content: str) -> dict[str, Any]:
    if not content:
        return {
            "documentClass": None,
            "packages": [],
            "sections": [],
            "labels": [],
            "customCommands": [],
        }

    document_class_match = re.search(r"\\documentclass(?:\[[^\]]+\])?\{([^}]+)\}", content)
    packages = re.findall(r"\\usepackage(?:\[[^\]]+\])?\{([^}]+)\}", content)
    sections = re.findall(r"\\(?:part|chapter|section|subsection|subsubsection)\{([^}]+)\}", content)
    labels = re.findall(r"\\label\{([^}]+)\}", content)
    custom_commands = [
        f"\\{match}"
        for match in re.findall(r"\\(?:newcommand|DeclareMathOperator)\*?\{\\([^}]+)\}", content)
    ]

    return {
        "documentClass": document_class_match.group(1) if document_class_match else None,
        "packages": packages[:10],
        "sections": sections[:12],
        "labels": labels[:12],
        "customCommands": custom_commands[:12],
    }


def extract_compile_line(log_text: str) -> int | None:
    if not log_text:
        return None

    match = re.search(r"\bl\.(\d+)\b", log_text)
    return int(match.group(1)) if match else None


def build_excerpt(payload: dict[str, Any]) -> str:
    selected_text = str(payload.get("selectedText") or "")
    content = str(payload.get("currentFileContent") or "")

    if selected_text.strip():
        return trim_text(selected_text.strip(), 1800)

    if not content:
        return ""

    compile_line = extract_compile_line(str(payload.get("recentCompileLog") or ""))

    if compile_line:
        lines = content.splitlines()
        start = max(0, compile_line - 6)
        end = min(len(lines), compile_line + 4)
        return trim_text("\n".join(lines[start:end]), 2200)

    chunks = split_into_paragraph_chunks(content)

    if len(chunks) <= 2:
        return trim_text(content, 2200)

    return trim_text("\n\n".join([chunks[0], chunks[1], chunks[-1]]), 2200)


def safe_import(module_name: str):
    try:
        module = __import__(module_name, fromlist=["*"])
        return module, None
    except Exception as error:  # noqa: BLE001
        return None, str(error)


def collect_project_inventory(project_root: str | None) -> dict[str, Any]:
    if not project_root:
        return {
            "relatedFiles": [],
            "bibliographyKeys": [],
            "includedFiles": [],
            "fileCount": 0,
            "overview": "当前没有项目目录可分析。",
        }

    root_path = Path(project_root)

    if not root_path.exists():
        return {
            "relatedFiles": [],
            "bibliographyKeys": [],
            "includedFiles": [],
            "fileCount": 0,
            "overview": "项目目录尚不存在，无法提取跨文件信号。",
        }

    files: list[str] = []
    bibliography_keys: list[str] = []
    included_files: list[str] = []

    for candidate in sorted(root_path.rglob("*")):
        if not candidate.is_file():
            continue

        if candidate.suffix.lower() not in TEXT_FILE_EXTENSIONS:
            continue

        relative_path = candidate.relative_to(root_path).as_posix()
        files.append(relative_path)

        if len(files) > MAX_FILE_COUNT:
            break

        if candidate.suffix.lower() == ".bib":
            try:
                content = candidate.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                content = candidate.read_text(encoding="utf-8", errors="ignore")

            bibliography_keys.extend(re.findall(r"@\w+\{([^,\s]+)", content))

        if candidate.suffix.lower() == ".tex":
            try:
                content = candidate.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                content = candidate.read_text(encoding="utf-8", errors="ignore")

            included_files.extend(
                re.findall(r"\\(?:input|include|bibliography)\{([^}]+)\}", content)
            )

    overview_lines = [
        f"项目文本文件数: {len(files)}",
        f"相关文件: {', '.join(files[:10]) or '无'}",
        f"引用文件/包含文件: {', '.join(included_files[:10]) or '无'}",
        f"参考文献键: {', '.join(bibliography_keys[:10]) or '无'}",
    ]

    kit_module, _ = safe_import("kit")

    if kit_module is not None:
        try:
            repository = kit_module.Repository(str(root_path))
            file_tree = repository.get_file_tree()
            if file_tree:
                overview_lines.append("cased-kit 文件树摘要:")
                overview_lines.append(trim_text(str(file_tree), 900))
        except Exception as error:  # noqa: BLE001
            overview_lines.append(f"cased-kit 摘要回退: {error}")

    return {
        "relatedFiles": files[:12],
        "bibliographyKeys": bibliography_keys[:12],
        "includedFiles": included_files[:12],
        "fileCount": len(files),
        "overview": "\n".join(overview_lines),
    }


def build_semantic_chunks(content: str) -> tuple[list[str], dict[str, Any]]:
    semchunk_module, import_error = safe_import("semchunk")

    if semchunk_module is None:
        chunks = [trim_text(chunk, 700) for chunk in split_into_paragraph_chunks(content)[:MAX_CHUNK_COUNT]]
        return chunks, {
            "available": False,
            "used": False,
            "reason": import_error or "semchunk 未安装",
        }

    try:
        if hasattr(semchunk_module, "chunkerify"):
            token_counter = lambda value: max(1, len(value) // 4)
            chunker = semchunk_module.chunkerify(token_counter, chunk_size=180)
            chunks = chunker(content)
        elif hasattr(semchunk_module, "semchunk"):
            chunks = semchunk_module.semchunk(content, 180)
        else:
            raise RuntimeError("未识别的 semchunk API")

        normalized = [trim_text(str(chunk), 700) for chunk in chunks if str(chunk).strip()]
        return normalized[:MAX_CHUNK_COUNT], {
            "available": True,
            "used": True,
            "version": getattr(semchunk_module, "__version__", None),
        }
    except Exception as error:  # noqa: BLE001
        chunks = [trim_text(chunk, 700) for chunk in split_into_paragraph_chunks(content)[:MAX_CHUNK_COUNT]]
        return chunks, {
            "available": True,
            "used": False,
            "reason": str(error),
            "version": getattr(semchunk_module, "__version__", None),
        }


def get_prompt_compressor():
    global _PROMPT_COMPRESSOR, _PROMPT_COMPRESSOR_ERROR

    if _PROMPT_COMPRESSOR is not None:
        return _PROMPT_COMPRESSOR

    if _PROMPT_COMPRESSOR_ERROR is not None:
        return None

    if not ENABLE_LLMLINGUA:
        _PROMPT_COMPRESSOR_ERROR = "默认关闭 LLMLingua 重型压缩器，可通过 AI_ENABLE_LLMLINGUA=1 显式开启"
        return None

    llmlingua_module, import_error = safe_import("llmlingua")

    if llmlingua_module is None:
        _PROMPT_COMPRESSOR_ERROR = import_error or "LLMLingua 未安装"
        return None

    try:
        from llmlingua import PromptCompressor

        _PROMPT_COMPRESSOR = PromptCompressor(
            model_name="microsoft/llmlingua-2-xlm-roberta-large-meetingbank",
            use_llmlingua2=True,
            device_map="cpu",
        )
        return _PROMPT_COMPRESSOR
    except Exception as error:  # noqa: BLE001
        _PROMPT_COMPRESSOR_ERROR = str(error)
        return None


def fallback_compress_text(text: str) -> str:
    chunks = split_into_paragraph_chunks(text)

    if not chunks:
        return trim_text(text, MAX_COMPRESSED_LENGTH)

    selected = chunks[:2]

    if len(chunks) > 2:
        selected.append(chunks[-1])

    return trim_text("\n\n".join(selected), MAX_COMPRESSED_LENGTH)


def compress_context_text(text: str) -> tuple[str, dict[str, Any]]:
    if not text:
        return "", {
            "available": False,
            "used": False,
            "reason": "没有可压缩内容",
        }

    compressor = get_prompt_compressor()

    if compressor is None:
        return fallback_compress_text(text), {
            "available": False,
            "used": False,
            "reason": _PROMPT_COMPRESSOR_ERROR or "LLMLingua 不可用",
        }

    try:
        result = compressor.compress_prompt(
            [text],
            target_token=800,
            instruction="请保留 LaTeX 语法、章节结构、标签和编译错误相关内容。",
            question="请为 LaTeX AI 助手保留最相关上下文。",
        )
        compressed_text = (
            result.get("compressed_prompt")
            or result.get("prompt_compressed")
            or result.get("compressed_prompt_list", [""])[0]
            or ""
        )
        normalized = trim_text(str(compressed_text), MAX_COMPRESSED_LENGTH)

        return normalized, {
            "available": True,
            "used": True,
            "originTokens": result.get("origin_tokens"),
            "compressedTokens": result.get("compressed_tokens"),
            "ratio": result.get("ratio"),
        }
    except Exception as error:  # noqa: BLE001
        return fallback_compress_text(text), {
            "available": True,
            "used": False,
            "reason": str(error),
        }


def build_completion_focus(prefix: str, suffix: str) -> dict[str, str]:
    return {
        "prefixWindow": prefix[-1400:],
        "suffixWindow": suffix[:800],
    }


def build_optimizer_meta() -> dict[str, Any]:
    cased_module, cased_error = safe_import("kit")

    return {
        "source": "python_optional",
        "casedKit": {
            "available": cased_module is not None,
            "used": cased_module is not None,
            "version": getattr(cased_module, "__version__", None) if cased_module is not None else None,
            "reason": cased_error,
        },
    }


def main() -> None:
    raw_input = sys.stdin.read().strip()
    payload = json.loads(raw_input or "{}")
    current_file_content = str(payload.get("currentFileContent") or "")
    signals = extract_document_signals(current_file_content)
    repo_summary = collect_project_inventory(payload.get("projectRoot"))
    semantic_chunks, semchunk_meta = build_semantic_chunks(current_file_content)
    compressed_context_text, llmlingua_meta = compress_context_text(
        "\n\n".join(
            part
            for part in [
                repo_summary.get("overview", ""),
                build_excerpt(payload),
                "\n\n".join(semantic_chunks),
                str(payload.get("recentCompileLog") or ""),
            ]
            if part
        )
    )
    optimizer_meta = build_optimizer_meta()
    optimizer_meta["semchunk"] = semchunk_meta
    optimizer_meta["llmLingua"] = llmlingua_meta

    result = {
        "signals": signals,
        "excerpt": build_excerpt(payload),
        "repoSummary": repo_summary,
        "semanticChunks": semantic_chunks,
        "compressedContextText": compressed_context_text,
        "optimizerMeta": optimizer_meta,
        "completionFocus": build_completion_focus(
            str(payload.get("prefix") or ""),
            str(payload.get("suffix") or ""),
        ),
    }
    sys.stdout.write(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()

"""
Code Review:
- Python 适配器当前只承担“可选增强”职责，不参与任何必须成功的业务逻辑，因此允许更激进地尝试第三方依赖并在失败时回退。
- `cased-kit` 在当前阶段主要用于声明性集成和运行时可用性探测，真正的 LaTeX 符号级深分析仍留给后续更有价值的场景。
- `LLMLingua` 可能因为模型下载或本地算力不足无法稳定启用，所以本文件始终保留纯文本压缩兜底，避免拖垮主链路。
"""
