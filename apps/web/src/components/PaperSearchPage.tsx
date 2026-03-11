/*
 * File: PaperSearchPage.tsx
 * Module: apps/web (独立论文搜索页)
 *
 * Responsibility:
 *   - 提供页面级论文搜索入口，承载关键词输入、来源勾选和结果卡片展示。
 *   - 让用户从顶栏直接进入论文搜索，而不是再经过工作台右侧窄面板。
 *
 * Dependencies:
 *   - react
 *   - ../types
 *
 * Last Updated:
 *   - 2026-03-11 by Codex - 收缩为三源搜索页，并保留 OpenAlex 发现源
 */

import { useMemo, useState } from "react";
import type { PaperDetail, PaperSearchResult, PaperSourceStatus, ProjectPaperRecord } from "../types";

interface PaperSearchPageProps {
  activeProjectName: string;
  hasActiveProject: boolean;
  results: PaperSearchResult[];
  sourceStatuses: PaperSourceStatus[];
  importedPapers: ProjectPaperRecord[];
  activePaper: PaperDetail | null;
  isSearching: boolean;
  onSearch: (query: string, sources?: string[]) => Promise<void>;
  onOpenPaper: (paperId: string) => Promise<void>;
  onImportPaper: (paperId: string) => Promise<void>;
  onResumeReading: () => void;
}

const sourceOptions = [
  { value: "arxiv", label: "arXiv" },
  { value: "pubmed", label: "PubMed" },
  { value: "openalex", label: "OpenAlex" },
];

function formatDate(value: string | null) {
  if (!value) {
    return "日期未知";
  }

  return new Date(value).toLocaleDateString("zh-CN");
}

export default function PaperSearchPage({
  activeProjectName,
  hasActiveProject,
  results,
  sourceStatuses,
  importedPapers,
  activePaper,
  isSearching,
  onSearch,
  onOpenPaper,
  onImportPaper,
  onResumeReading,
}: PaperSearchPageProps) {
  const [query, setQuery] = useState("");
  const [selectedSources, setSelectedSources] = useState(sourceOptions.map((option) => option.value));
  const importedPaperIds = useMemo(() => new Set(importedPapers.map((paper) => paper.paperId)), [importedPapers]);
  const importedPaperDois = useMemo(
    () => new Set(importedPapers.map((paper) => String(paper.doi ?? "").trim().toLowerCase()).filter(Boolean)),
    [importedPapers],
  );
  const selectedSourceLabels = useMemo(
    () => sourceOptions.filter((option) => selectedSources.includes(option.value)).map((option) => option.label),
    [selectedSources],
  );
  const degradedStatuses = sourceStatuses.filter((status) => !status.ok);
  const isEmptyState = !isSearching && results.length === 0;
  const canSearch = hasActiveProject && selectedSources.length > 0;

  function toggleSource(source: string) {
    setSelectedSources((current) =>
      current.includes(source) ? current.filter((item) => item !== source) : [...current, source],
    );
  }

  return (
    <main className="paper-search-page">
      <section className="paper-search-page-shell">
        <div className="paper-search-hero">
          <div className="paper-search-hero-copy">
            <small>Research Search</small>
            <h1>检索论文</h1>
            <p>
              聚合 arXiv、PubMed 和 OpenAlex 结果；OpenAlex 负责快速发现，阅读时会自动尝试解析到可读源。
            </p>
          </div>

          <div className="paper-search-hero-meta">
            <span>当前项目：{hasActiveProject ? activeProjectName : "未选择项目"}</span>
            {activePaper ? (
              <button type="button" className="mini-button" onClick={onResumeReading}>
                回到上次阅读
              </button>
            ) : null}
          </div>
        </div>

        <section className="paper-search-page-card paper-search-controls">
          <div className="paper-search-page-row">
            <input
              value={query}
              className="paper-search-page-input"
              placeholder="例如：multimodal reasoning、RAG agent、1605.08386"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                      void onSearch(query, selectedSources);
                }
              }}
              disabled={!canSearch || isSearching}
            />
            <button
              type="button"
              className="accent-button"
              onClick={() => void onSearch(query, selectedSources)}
              disabled={!canSearch || isSearching}
            >
              {isSearching ? "检索中..." : "检索论文"}
            </button>
          </div>

          <div className="paper-search-source-switch" role="tablist" aria-label="论文来源过滤">
            {sourceOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`paper-search-source-pill${selectedSources.includes(option.value) ? " paper-search-source-pill-active" : ""}`}
                onClick={() => toggleSource(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="paper-search-page-hint">
            {!hasActiveProject
              ? "请先选择一个项目，再检索并导入论文。"
              : selectedSources.length === 0
                ? "请至少勾选一个论文来源后再发起检索。"
                : `当前已勾选 ${selectedSourceLabels.join("、")}；其中 OpenAlex 是发现源，阅读时会自动解析到 arXiv 或 PubMed。`}
          </div>
        </section>

        <section className="paper-search-page-summary">
          <div>
            <strong>{results.length}</strong>
            <span> 篇候选论文</span>
          </div>
          {sourceStatuses.length > 0 ? <small>本次检索涉及 {sourceStatuses.length} 个来源</small> : null}
        </section>

        {sourceStatuses.length > 0 ? (
          <section className="paper-search-page-summary paper-search-source-statuses">
            {sourceStatuses.map((status) => (
              <span
                key={`${status.source}-${status.durationMs}`}
                className={`paper-search-status-pill${status.ok ? "" : " paper-search-status-pill-error"}`}
              >
                {status.sourceLabel} · {status.ok ? `${status.resultCount} 条` : `已降级${status.errorCode ? ` · ${status.errorCode}` : ""}`}
              </span>
            ))}
          </section>
        ) : null}

        {degradedStatuses.length > 0 ? (
          <section className="paper-search-page-empty">
            <strong>部分来源本次已自动降级</strong>
            <p>{degradedStatuses.map((status) => `${status.sourceLabel}${status.errorMessage ? `：${status.errorMessage}` : ""}`).join("；")}</p>
          </section>
        ) : null}

        {isEmptyState ? (
          <section className="paper-search-page-empty">
            <strong>{sourceStatuses.length > 0 ? "本次检索没有返回候选论文" : "输入主题后即可检索论文"}</strong>
            <p>
              {sourceStatuses.length > 0
                ? "可以调整关键词，或改勾选其它来源后重新搜索。"
                : "先输入关键词，再从结果卡片里直接打开阅读或导入引用。"}
            </p>
          </section>
        ) : null}

        {results.length > 0 ? (
          <section className="paper-search-result-grid">
            {results.map((paper) => {
              const alreadyImported =
                importedPaperIds.has(paper.paperId) ||
                (paper.doi ? importedPaperDois.has(String(paper.doi).trim().toLowerCase()) : false);

              return (
                <article key={paper.paperId} className="paper-search-result-card">
                <div className="paper-search-result-header">
                  <div>
                    <strong>{paper.title}</strong>
                    <small>{paper.authors.join(", ") || "作者未知"}</small>
                  </div>
                  <span>{formatDate(paper.published)}</span>
                </div>

                <div className="paper-search-result-meta">
                  <span>{paper.sourceLabel}</span>
                  <span>{paper.fullTextAvailable ? "可读 PDF" : "摘要 / 元数据"}</span>
                  {paper.venue ? <span>{paper.venue}</span> : null}
                </div>

                <pre className="paper-summary">{paper.summary}</pre>

                <div className="paper-card-actions">
                  <button type="button" className="mini-button" onClick={() => void onOpenPaper(paper.paperId)}>
                    阅读
                  </button>
                  <button
                    type="button"
                    className="mini-button"
                    onClick={() => void onImportPaper(paper.paperId)}
                    disabled={!hasActiveProject || alreadyImported}
                  >
                    {alreadyImported ? "已导入" : "导入引用"}
                  </button>
                  {paper.abstractUrl ? (
                    <a className="mini-link-button" href={paper.abstractUrl} target="_blank" rel="noreferrer">
                      查看来源
                    </a>
                  ) : null}
                </div>
                </article>
              );
            })}
          </section>
        ) : null}
      </section>
    </main>
  );
}

/*
 * Code Review:
 * - 搜索页现在把“发现源 + 可读源”语义直接说清楚，用户不会再误以为 OpenAlex 自己能提供全文。
 * - 导入按钮除了看 `paperId`，还会用 DOI 感知已导入状态，避免 discovery 结果解析成 canonical 可读源后，列表里继续显示“可重复导入”的错觉。
 * - 回到上次阅读按钮只在存在 `activePaper` 时显示，既保留上下文连续性，也不强迫新用户理解阅读页状态。
 */
