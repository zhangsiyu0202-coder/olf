/*
 * File: paper-refs.js
 * Module: packages/shared (论文标识工具)
 *
 * Responsibility:
 *   - 统一维护论文来源、来源标签和跨模块通用的论文引用键规则。
 *   - 避免 API、仓储和论文服务各自解析 `paperId`，导致多源接入后规则分叉。
 *
 * Runtime Logic Overview:
 *   1. 论文搜索结果会生成 `source:sourceId` 形式的稳定 `paperId`。
 *   2. API、仓储和高亮模块通过本文件解析或兼容旧的单源 `arXiv` 论文 ID。
 *   3. 前后续新增论文源时，只需要在这里追加来源表，不必改调用方判断逻辑。
 *
 * Dependencies:
 *   - 无
 *
 * Last Updated:
 *   - 2026-03-11 by Codex - 收缩为三源来源表
 */

const knownPaperSources = new Set(["arxiv", "pubmed", "openalex"]);

const sourceLabels = {
  arxiv: "arXiv",
  pubmed: "PubMed",
  openalex: "OpenAlex",
};

export function getPaperSourceLabel(source) {
  return sourceLabels[source] ?? source ?? "Unknown";
}

export function splitPaperReference(paperId) {
  const normalizedId = String(paperId ?? "").trim();

  if (!normalizedId) {
    throw new Error("论文 ID 不能为空");
  }

  if (/^https?:\/\/arxiv\.org\/abs\//i.test(normalizedId)) {
    const sourceId = normalizedId.replace(/^https?:\/\/arxiv\.org\/abs\//i, "").replace(/\.pdf$/i, "");
    return {
      paperId: `arxiv:${sourceId}`,
      source: "arxiv",
      sourceId,
      legacyId: sourceId,
    };
  }

  const delimiterIndex = normalizedId.indexOf(":");
  const sourceCandidate = delimiterIndex > 0 ? normalizedId.slice(0, delimiterIndex) : "";

  if (knownPaperSources.has(sourceCandidate)) {
    const sourceId = normalizedId.slice(delimiterIndex + 1).trim();

    if (!sourceId) {
      throw new Error("论文来源 ID 不能为空");
    }

    return {
      paperId: `${sourceCandidate}:${sourceId}`,
      source: sourceCandidate,
      sourceId,
      legacyId: sourceId,
    };
  }

  if (delimiterIndex > 0) {
    throw new Error("当前尚不支持该论文来源");
  }

  const sourceId = normalizedId.replace(/\.pdf$/i, "");
  return {
    paperId: `arxiv:${sourceId}`,
    source: "arxiv",
    sourceId,
    legacyId: sourceId,
  };
}

export function normalizePaperReference(paperId) {
  return splitPaperReference(paperId).paperId;
}

/*
 * Code Review:
 * - 多源论文接入后，`paperId` 必须从“某个站点的裸 ID”升级为稳定的跨源引用键，否则仓储、摘录和 API 路由都会继续默认等于 arXiv。
 * - 未知 `source:*` 前缀现在会直接报错，避免被错误兜底成 arXiv 并污染项目文献库。
 * - 来源标签和解析规则都放在一个无副作用工具里，三源入口可以在这里集中维护。
 */
