/*
 * File: PaperSearchPanel.tsx
 * Module: apps/web (论文检索面板)
 *
 * Responsibility:
 *   - 承载论文检索、项目文献库展示与研究助手入口。
 *   - 只负责 UI 交互和表单状态，不直接发起网络请求。
 *
 * Dependencies:
 *   - react
 *   - ../types
 *
 * Last Updated:
 *   - 2026-03-08 by Codex - 升级为多源论文检索面板
 */

import { useState } from "react";
import type { PaperAssistantReply, PaperSearchResult, ProjectPaperRecord } from "../types";

interface PaperSearchPanelProps {
  papers: ProjectPaperRecord[];
  results: PaperSearchResult[];
  isSearching: boolean;
  isAskingAssistant: boolean;
  assistantReply: PaperAssistantReply | null;
  onSearch: (query: string) => Promise<void>;
  onOpenPaper: (paperId: string) => Promise<void>;
  onImportPaper: (paperId: string) => Promise<void>;
  onAskAssistant: (message: string) => Promise<void>;
}

function formatDate(value: string | null) {
  if (!value) {
    return "日期未知";
  }

  return new Date(value).toLocaleDateString("zh-CN");
}

export default function PaperSearchPanel({
  papers,
  results,
  isSearching,
  isAskingAssistant,
  assistantReply,
  onSearch,
  onOpenPaper,
  onImportPaper,
  onAskAssistant,
}: PaperSearchPanelProps) {
  const [query, setQuery] = useState("");
  const [assistantInput, setAssistantInput] = useState("");
  const importedPaperIds = new Set(papers.map((paper) => paper.paperId));

  return (
    <div className="paper-panel-content">
      <section className="paper-search-box">
        <div className="paper-search-row">
          <input
            value={query}
            className="paper-search-input"
            placeholder="例如：multimodal reasoning、RAG agent、1605.08386"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void onSearch(query);
              }
            }}
          />
          <button type="button" className="accent-button" onClick={() => void onSearch(query)} disabled={isSearching}>
            {isSearching ? "检索中..." : "检索论文"}
          </button>
        </div>
        <small>当前结果会聚合多个论文源；来源标签、可读状态和导入动作都会明确显示，不混成一团。</small>
      </section>

      <section className="paper-assistant-box">
        <div className="panel-toolbar">
          <span>研究助手</span>
        </div>
        <textarea
          className="assistant-input"
          placeholder="例如：帮我比较 2024-2025 年关于 multimodal reasoning 的代表论文"
          value={assistantInput}
          onChange={(event) => setAssistantInput(event.target.value)}
        />
        <div className="assistant-actions">
          <small>这里的 Agent/Tool 只服务论文检索与阅读场景，不影响写作区 AI。</small>
          <button
            type="button"
            className="accent-button"
            disabled={isAskingAssistant}
            onClick={() => void onAskAssistant(assistantInput)}
          >
            {isAskingAssistant ? "分析中..." : "提问"}
          </button>
        </div>
        {assistantReply ? (
          <div className="assistant-message assistant-message-assistant">
            <div className="assistant-bubble">
              <pre>{assistantReply.answer}</pre>
            </div>
          </div>
        ) : null}
      </section>

      <section className="paper-library-section">
        <div className="panel-toolbar">
          <span>项目文献库</span>
        </div>
        {papers.length === 0 ? <div className="empty-panel">当前项目还没有导入论文</div> : null}
        {papers.map((paper) => (
          <div key={`${paper.paperId}-${paper.updatedAt}`} className="paper-card">
            <div className="paper-card-header">
              <strong>{paper.title}</strong>
              <small>{formatDate(paper.published)}</small>
            </div>
            <p>{paper.authors.join(", ") || "作者未知"}</p>
            <small>
              来源：<code>{paper.sourceLabel}</code>
            </small>
            <small>
              引用键：<code>{paper.bibtexKey}</code>
            </small>
            <div className="assistant-code-actions">
              <button type="button" className="mini-button" onClick={() => void onOpenPaper(paper.paperId)}>
                打开阅读
              </button>
            </div>
          </div>
        ))}
      </section>

      <section className="paper-results-section">
        <div className="panel-toolbar">
          <span>检索结果</span>
        </div>
        {results.length === 0 ? <div className="empty-panel">输入主题后即可检索论文</div> : null}
        {results.map((paper) => (
          <div key={paper.paperId} className="paper-card">
            <div className="paper-card-header">
              <strong>{paper.title}</strong>
              <small>{formatDate(paper.published)}</small>
            </div>
            <p>{paper.authors.join(", ") || "作者未知"}</p>
            <small>
              来源：<code>{paper.sourceLabel}</code>
              {paper.fullTextAvailable ? " · 可读 PDF" : " · 摘要/元数据"}
            </small>
            <pre className="paper-summary">{paper.summary}</pre>
            <div className="paper-card-actions">
              <button type="button" className="mini-button" onClick={() => void onOpenPaper(paper.paperId)}>
                阅读
              </button>
              <button
                type="button"
                className="mini-button"
                onClick={() => void onImportPaper(paper.paperId)}
                disabled={importedPaperIds.has(paper.paperId)}
              >
                {importedPaperIds.has(paper.paperId) ? "已导入" : "导入引用"}
              </button>
              {paper.abstractUrl ? (
                <a className="mini-link-button" href={paper.abstractUrl} target="_blank" rel="noreferrer">
                  查看来源
                </a>
              ) : null}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

/*
 * Code Review:
 * - 检索面板同时呈现“项目文献库”和“外部搜索结果”，能让用户明确区分已导入资产与候选论文。
 * - Agent 入口被限定在研究面板内部，避免与写作区 AI 助手混淆。
 * - 搜索、导入和打开阅读全部通过回调抛给上层，保持该组件为纯 UI 容器。
 */
