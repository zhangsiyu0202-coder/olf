/*
 * File: PaperReaderPanel.tsx
 * Module: apps/web (论文阅读面板)
 *
 * Responsibility:
 *   - 展示当前选中论文的元数据、摘要、可读全文片段和 PDF 阅读器。
 *   - 提供研究助手提问和导入引用入口，形成“读论文 -> 导入写作”的闭环。
 *
 * Dependencies:
 *   - react
 *   - ./PaperPdfViewer
 *   - ../types
 *
 * Last Updated:
 *   - 2026-03-08 by Codex - 升级为多源论文阅读面板
 */

import { useRef, useState } from "react";
import PaperPdfViewer, { type PaperPdfViewerHandle } from "./PaperPdfViewer";
import type {
  PaperAssistantReply,
  PaperDetail,
  ProjectPaperHighlight,
  ProjectPaperRecord,
} from "../types";

interface PaperReaderPanelProps {
  paper: PaperDetail | null;
  importedPaper: ProjectPaperRecord | null;
  pdfUrl: string | null;
  isLoading: boolean;
  isImporting: boolean;
  isAskingAssistant: boolean;
  assistantReply: PaperAssistantReply | null;
  highlights: ProjectPaperHighlight[];
  onImportPaper: (paperId: string) => Promise<void>;
  onAskAssistant: (message: string, selectedPaperIds: string[]) => Promise<void>;
  onInsertCitation: () => Promise<void>;
  onInsertSummary: () => Promise<void>;
  onSaveReadingNote: () => Promise<void>;
  onCreateHighlight: (payload: {
    content: { text: string; image?: string };
    comment: { text: string; emoji: string };
    position: {
      boundingRect: Record<string, number>;
      rects: Array<Record<string, number>>;
      pageNumber: number;
      usePdfCoordinates?: boolean;
    };
  }) => Promise<void>;
  onInsertHighlight: (highlight: ProjectPaperHighlight) => Promise<void>;
  onEditHighlight: (highlight: ProjectPaperHighlight) => Promise<void>;
  onDeleteHighlight: (highlight: ProjectPaperHighlight) => Promise<void>;
}

function formatDate(value: string | null) {
  if (!value) {
    return "日期未知";
  }

  return new Date(value).toLocaleDateString("zh-CN");
}

export default function PaperReaderPanel({
  paper,
  importedPaper,
  pdfUrl,
  isLoading,
  isImporting,
  isAskingAssistant,
  assistantReply,
  highlights,
  onImportPaper,
  onAskAssistant,
  onInsertCitation,
  onInsertSummary,
  onSaveReadingNote,
  onCreateHighlight,
  onInsertHighlight,
  onEditHighlight,
  onDeleteHighlight,
}: PaperReaderPanelProps) {
  const [assistantInput, setAssistantInput] = useState("");
  const pdfViewerRef = useRef<PaperPdfViewerHandle | null>(null);

  if (isLoading) {
    return <div className="empty-panel">论文内容加载中...</div>;
  }

  if (!paper) {
    return <div className="empty-panel">先从“检索论文”里打开一篇论文，再进入阅读视图。</div>;
  }

  return (
    <div className="paper-reader-layout">
      <div className="paper-reader-meta">
        <div className="paper-card">
          <div className="paper-card-header">
            <strong>{paper.title}</strong>
            <small>{formatDate(paper.published)}</small>
          </div>
          <p>{paper.authors.join(", ") || "作者未知"}</p>
          <small>
            来源：<code>{paper.sourceLabel}</code>
            {paper.venue ? ` · ${paper.venue}` : ""}
            {paper.fullTextAvailable ? " · 可直接获取 PDF" : " · 当前仅保证摘要可读"}
          </small>
          <pre className="paper-summary">{paper.summary}</pre>
          <div className="paper-card-actions">
            <button
              type="button"
              className="mini-button"
              disabled={!!importedPaper || isImporting}
              onClick={() => void onImportPaper(paper.paperId)}
            >
              {importedPaper ? `已导入 · ${importedPaper.bibtexKey}` : isImporting ? "导入中..." : "导入当前项目"}
            </button>
            {paper.abstractUrl ? (
              <a className="mini-link-button" href={paper.abstractUrl} target="_blank" rel="noreferrer">
                查看来源
              </a>
            ) : null}
            <button type="button" className="mini-button" onClick={() => void onInsertCitation()}>
              插入 cite
            </button>
            <button type="button" className="mini-button" onClick={() => void onInsertSummary()}>
              插入总结
            </button>
            <button type="button" className="mini-button" onClick={() => void onSaveReadingNote()}>
              保存为笔记
            </button>
          </div>
        </div>

        <div className="paper-assistant-box">
          <div className="panel-toolbar">
            <span>阅读助手</span>
          </div>
          <textarea
            className="assistant-input"
            placeholder="例如：总结这篇论文的方法、贡献和实验结论"
            value={assistantInput}
            onChange={(event) => setAssistantInput(event.target.value)}
          />
          <div className="assistant-actions">
            <small>问题会带上当前论文 ID 和来源标签，优先围绕这篇论文回答。</small>
            <button
              type="button"
              className="accent-button"
              disabled={isAskingAssistant}
              onClick={() => void onAskAssistant(assistantInput, [paper.paperId])}
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
        </div>

        <div className="paper-card">
          <div className="paper-card-header">
            <strong>可读全文片段</strong>
            <small>{paper.contentSource}</small>
          </div>
          <pre className="paper-reader-content">{paper.content}</pre>
        </div>

        <div className="paper-card">
          <div className="paper-card-header">
            <strong>已保存摘录</strong>
            <small>{highlights.length} 条</small>
          </div>
          {highlights.length === 0 ? <small>在右侧 PDF 中框选文本后即可保存摘录。</small> : null}
          {highlights.map((highlight) => (
            <div key={highlight.id} className="paper-highlight-card">
              <div className="paper-highlight-card-header">
                <strong>{highlight.comment.emoji || "摘录"}</strong>
                <small>{formatDate(highlight.createdAt)}</small>
              </div>
              <p>{highlight.comment.text || "未填写备注"}</p>
              <pre className="paper-summary">{highlight.content.text}</pre>
              <div className="assistant-code-actions">
                <button
                  type="button"
                  className="mini-button"
                  onClick={() => pdfViewerRef.current?.scrollToHighlight(highlight.id)}
                >
                  回到 PDF 定位
                </button>
                <button
                  type="button"
                  className="mini-button"
                  onClick={() => void onInsertHighlight(highlight)}
                >
                  插入写作区
                </button>
                <button
                  type="button"
                  className="mini-button"
                  onClick={() => void onEditHighlight(highlight)}
                >
                  编辑备注
                </button>
                <button
                  type="button"
                  className="mini-button"
                  onClick={() => void onDeleteHighlight(highlight)}
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="paper-reader-pdf">
        <PaperPdfViewer
          ref={pdfViewerRef}
          pdfUrl={pdfUrl}
          highlights={highlights}
          onCreateHighlight={onCreateHighlight}
        />
      </div>
    </div>
  );
}

/*
 * Code Review:
 * - 阅读面板把元数据、全文片段和 PDF 视图并置，优先保证“边看边导入”的主流程，而不是先追求复杂标注系统。
 * - 导入状态直接映射到已导入论文记录，避免前端再维护一套本地真假状态。
 * - 研究助手问题显式附带当前论文 ID，减少 Agent 在多论文语境下答非所问的概率。
 */
