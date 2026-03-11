/*
 * File: paperReaderOutline.ts
 * Module: apps/web (论文阅读器大纲与全文切分工具)
 *
 * Responsibility:
 *   - 从 PDF 文本层、PDF 原生书签和回退全文文本中重建应用自有目录。
 *   - 为阅读器左侧导航和全文模式提供统一的目录项与锚点结构。
 *
 * Runtime Logic Overview:
 *   1. 先从 `paper.content` 切分出文本章节，作为全文锚点后备来源。
 *   2. 再从 PDF.js 文本层里识别候选标题，并结合 PDF 书签补页码与标题线索。
 *   3. 最终以应用自有规则合并三路目录项，优先保留结构稳定的重建结果。
 *
 * Dependencies:
 *   - 无
 *
 * Last Updated:
 *   - 2026-03-11 by Codex - 将目录重建升级为 PDF 文本层优先、书签补充、文本锚点兜底的混合策略
 */

export type PaperReaderOutlineSource = "rebuilt" | "pdf_bookmark" | "text_fallback";
export type PaperReaderOutlineConfidence = "high" | "medium" | "low";

export interface PaperReaderOutlineItem {
  id: string;
  title: string;
  level: number;
  pageNumber: number | null;
  anchorId: string | null;
  source: PaperReaderOutlineSource;
  confidence: PaperReaderOutlineConfidence;
}

export interface PaperReaderTextSection {
  id: string;
  title: string;
  content: string;
}

export interface PaperReaderPdfTextLine {
  text: string;
  pageNumber: number;
}

const COMMON_HEADINGS = new Set([
  "abstract",
  "introduction",
  "background",
  "related work",
  "method",
  "methods",
  "methodology",
  "approach",
  "approaches",
  "materials and methods",
  "experiments",
  "experimental setup",
  "results",
  "discussion",
  "conclusion",
  "conclusions",
  "future work",
  "acknowledgements",
  "acknowledgments",
  "appendix",
  "references",
]);

function normalizeOutlineTitle(title: string) {
  return title
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, " ")
    .trim();
}

function normalizeAnchorTitle(title: string) {
  const normalized = normalizeOutlineTitle(title);
  return normalized || "正文";
}

function stripHeadingNumbering(title: string) {
  return normalizeOutlineTitle(title)
    .replace(/^(?:chapter|section)\s+/i, "")
    .replace(/^\d+(?:\.\d+)*[.)]?\s+/, "")
    .trim();
}

function normalizeOutlineKey(title: string) {
  return stripHeadingNumbering(title)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .trim();
}

function slugify(value: string, index: number) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || `section-${index + 1}`;
}

function clampOutlineLevel(level: number) {
  return Math.max(1, Math.min(level, 3));
}

function deriveOutlineLevel(title: string) {
  const numberedMatch = normalizeOutlineTitle(title).match(/^(\d+(?:\.\d+)*)[.)]?\s+/);
  if (!numberedMatch) {
    return 1;
  }

  const numbering = numberedMatch[1] ?? "";
  return clampOutlineLevel(numbering ? numbering.split(".").length : 1);
}

function looksLikeDotLeader(text: string) {
  return /\.{4,}/.test(text) || /·{4,}/.test(text) || /…{2,}/.test(text);
}

function looksLikeFormulaNoise(text: string) {
  return /[=<>+\-*/^_{}\\]{3,}/.test(text) || /[∈∀∑∫≈≤≥→←]/.test(text);
}

function looksLikeSentence(text: string) {
  const normalized = normalizeOutlineTitle(text);
  if (normalized.split(" ").length >= 14) {
    return true;
  }

  return /[.!?;:]$/.test(normalized);
}

function isLikelyNoiseLine(line: string) {
  const value = normalizeOutlineTitle(line);

  if (!value) {
    return true;
  }

  if (value.length < 3 || value.length > 140) {
    return true;
  }

  if (looksLikeDotLeader(value)) {
    return true;
  }

  if (/^\d+\s*$/.test(value) || /^page\s+\d+$/i.test(value)) {
    return true;
  }

  if (/^arxiv\b/i.test(value) || /^preprint\b/i.test(value)) {
    return true;
  }

  if (looksLikeFormulaNoise(value) && !/^\d+(?:\.\d+)*\s+/.test(value)) {
    return true;
  }

  if (/^[^A-Za-z\u4e00-\u9fff]*$/.test(value)) {
    return true;
  }

  return false;
}

function detectHeadingConfidence(line: string): PaperReaderOutlineConfidence | null {
  const value = normalizeOutlineTitle(line);

  if (!value || isLikelyNoiseLine(value)) {
    return null;
  }

  if (COMMON_HEADINGS.has(normalizeOutlineKey(value))) {
    return "high";
  }

  if (/^\d+(?:\.\d+)*[.)]?\s+\S+/.test(value)) {
    return "high";
  }

  if (/^[A-Z][A-Z\s-]{4,}$/.test(value) && value.split(" ").length <= 10) {
    return "medium";
  }

  if (/^[A-Z][A-Za-z0-9-]*(?:\s+[A-Z][A-Za-z0-9-]*){0,7}$/.test(value) && !looksLikeSentence(value)) {
    return "medium";
  }

  return null;
}

function createOutlineItemId(source: PaperReaderOutlineSource, title: string, index: number, pageNumber: number | null) {
  return `${source}:${slugify(title, index)}:${pageNumber ?? "x"}:${index}`;
}

function sameOutlineIdentity(left: PaperReaderOutlineItem, right: PaperReaderOutlineItem) {
  const leftKey = normalizeOutlineKey(left.title);
  const rightKey = normalizeOutlineKey(right.title);

  if (!leftKey || !rightKey) {
    return false;
  }

  return leftKey === rightKey;
}

function preferConfidence(
  current: PaperReaderOutlineConfidence,
  incoming: PaperReaderOutlineConfidence,
): PaperReaderOutlineConfidence {
  const order = {
    low: 0,
    medium: 1,
    high: 2,
  };

  return order[incoming] > order[current] ? incoming : current;
}

function dedupeAdjacentOutlineItems(items: PaperReaderOutlineItem[]) {
  const deduped: PaperReaderOutlineItem[] = [];

  for (const item of items) {
    const previous = deduped[deduped.length - 1] ?? null;

    if (previous && sameOutlineIdentity(previous, item)) {
      deduped[deduped.length - 1] = {
        ...previous,
        pageNumber: previous.pageNumber ?? item.pageNumber,
        anchorId: previous.anchorId ?? item.anchorId,
        confidence: preferConfidence(previous.confidence, item.confidence),
      };
      continue;
    }

    deduped.push(item);
  }

  return deduped;
}

function mergeOutlineCollections(collections: PaperReaderOutlineItem[][]) {
  const merged: PaperReaderOutlineItem[] = [];

  for (const collection of collections) {
    for (const item of collection) {
      const normalizedTitle = normalizeOutlineTitle(item.title);
      if (!normalizedTitle) {
        continue;
      }

      const existing = merged.find((entry) => sameOutlineIdentity(entry, item));

      if (!existing) {
        merged.push({
          ...item,
          title: normalizedTitle,
          level: clampOutlineLevel(item.level),
        });
        continue;
      }

      existing.pageNumber = existing.pageNumber ?? item.pageNumber;
      existing.anchorId = existing.anchorId ?? item.anchorId;
      existing.confidence = preferConfidence(existing.confidence, item.confidence);
      existing.level = Math.min(existing.level, clampOutlineLevel(item.level));
    }
  }

  return dedupeAdjacentOutlineItems(merged);
}

export function buildTextSections(content: string): PaperReaderTextSection[] {
  const lines = content.split(/\r?\n/);
  const sections: PaperReaderTextSection[] = [];
  let currentTitle = "正文";
  let currentBuffer: string[] = [];

  function flushSection(indexHint: number) {
    const joined = currentBuffer.join("\n").trim();

    if (!joined) {
      currentBuffer = [];
      return;
    }

    const normalizedTitle = normalizeAnchorTitle(currentTitle);
    sections.push({
      id: slugify(normalizedTitle, indexHint),
      title: normalizedTitle,
      content: joined,
    });
    currentBuffer = [];
  }

  lines.forEach((rawLine, index) => {
    const line = normalizeOutlineTitle(rawLine);
    const headingConfidence = detectHeadingConfidence(line);

    if (headingConfidence) {
      flushSection(sections.length);
      currentTitle = line;
      return;
    }

    currentBuffer.push(rawLine);

    if (index === lines.length - 1) {
      flushSection(sections.length);
    }
  });

  if (sections.length === 0) {
    return [
      {
        id: "full-text",
        title: "全文",
        content: content.trim(),
      },
    ];
  }

  return sections;
}

export function deriveOutlineFromContent(content: string): PaperReaderOutlineItem[] {
  return buildTextSections(content)
    .filter((section) => section.content.trim())
    .slice(0, 24)
    .map((section, index) => ({
      id: createOutlineItemId("text_fallback", section.title, index, null),
      title: section.title,
      level: deriveOutlineLevel(section.title),
      pageNumber: null,
      anchorId: section.id,
      source: "text_fallback" as const,
      confidence: detectHeadingConfidence(section.title) ? "medium" : "low",
    }));
}

export function buildRebuiltOutline(
  pdfTextLines: PaperReaderPdfTextLine[],
  pdfBookmarks: PaperReaderOutlineItem[],
): PaperReaderOutlineItem[] {
  const rebuiltFromText: PaperReaderOutlineItem[] = [];

  pdfTextLines.forEach((line, index) => {
    const normalizedTitle = normalizeOutlineTitle(line.text);
    const confidence = detectHeadingConfidence(normalizedTitle);

    if (!confidence) {
      return;
    }

    if (looksLikeSentence(normalizedTitle) && confidence !== "high") {
      return;
    }

    rebuiltFromText.push({
      id: createOutlineItemId("rebuilt", normalizedTitle, index, line.pageNumber),
      title: normalizedTitle,
      level: deriveOutlineLevel(normalizedTitle),
      pageNumber: line.pageNumber,
      anchorId: null,
      source: "rebuilt",
      confidence,
    });
  });

  const normalizedBookmarks: PaperReaderOutlineItem[] = pdfBookmarks.map((item, index) => {
    const confidence: PaperReaderOutlineConfidence = item.pageNumber ? "high" : "medium";

    return {
      ...item,
      id: createOutlineItemId("pdf_bookmark", item.title, index, item.pageNumber),
      level: clampOutlineLevel(item.level),
      source: "pdf_bookmark",
      confidence,
      anchorId: item.anchorId ?? null,
    };
  });

  return mergeOutlineCollections([rebuiltFromText, normalizedBookmarks]).slice(0, 32);
}

export function mergePaperOutline(
  rebuiltOutline: PaperReaderOutlineItem[],
  contentOutline: PaperReaderOutlineItem[],
  structuredOutline: PaperReaderOutlineItem[] = [],
): PaperReaderOutlineItem[] {
  return mergeOutlineCollections([structuredOutline, rebuiltOutline, contentOutline]).slice(0, 32);
}

/*
 * Code Review:
 * - 目录重建现在以 PDF 文本层识别结果为主，PDF 书签只做页码补全和线索补充，避免“有书签就全信”的脆弱策略。
 * - 回退全文文本仍然会生成锚点，但默认只承担缺页码时的导航兜底，不再冒充第一真相来源。
 * - 合并阶段统一按标题身份做去重与字段补齐，能在不引入复杂解析服务的前提下把三路信号收敛成一份稳定目录。
 */
