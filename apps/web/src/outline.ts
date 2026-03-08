/*
 * File: outline.ts
 * Module: apps/web (LaTeX 大纲工具)
 *
 * Responsibility:
 *   - 从当前 LaTeX 文本中提取章节层级，供左侧目录大纲与定位功能复用。
 *
 * Runtime Logic Overview:
 *   1. 编辑器内容变更后调用 `buildOutline`。
 *   2. 解析 `section/subsection/subsubsection` 并返回扁平列表。
 *   3. 视图层根据行号滚动编辑器。
 *
 * Dependencies:
 *   - ./types
 *
 * Last Updated:
 *   - 2026-03-07 by Codex - 提取前端大纲解析工具
 */

import type { OutlineItem } from "./types";

const SECTION_PATTERN = /^\\(section|subsection|subsubsection)\{(.+)\}/;

export function buildOutline(content: string): OutlineItem[] {
  const lines = content.split("\n");
  const outline: OutlineItem[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index]?.match(SECTION_PATTERN);

    if (!match) {
      continue;
    }

    const level = match[1] === "section" ? 0 : match[1] === "subsection" ? 1 : 2;
    outline.push({
      id: `${index + 1}`,
      title: match[2] ?? "",
      level,
      line: index + 1,
    });
  }

  return outline;
}

/*
 * Code Review:
 * - 当前解析只覆盖核心章节命令，先满足论文编辑主流程，不提前扩展到全部 LaTeX 结构。
 * - 返回扁平列表而非树结构，能直接服务现有 UI，也简化滚动定位逻辑。
 * - 若后续支持 `paragraph`、`chapter` 或自定义命令，应优先在此集中扩展。
 */
