/*
 * File: PaperReaderPanel.tsx
 * Module: apps/web (论文阅读页面主容器)
 *
 * Responsibility:
 *   - 组装论文阅读页的三栏布局、工具栏状态机、评论弹层和 AI 弹层。
 *   - 将持久化批注、写作插入动作和论文阅读 UI 收敛到同一条主流程。
 *
 * Dependencies:
 *   - react
 *   - ./PaperPdfViewer
 *   - ./paper-reader/*
 *   - ../types
 *
 * Last Updated:
 *   - 2026-03-11 by Codex - 升级右侧为 Assistant + Notes 双标签，并接入报告状态与上下文注入
 */

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import PaperPdfViewer, { type PaperPdfViewerHandle } from "./PaperPdfViewer";
import PaperReaderAssistantPopover from "./paper-reader/PaperReaderAssistantPopover";
import PaperReaderCenterStage from "./paper-reader/PaperReaderCenterStage";
import PaperReaderCommentPopover from "./paper-reader/PaperReaderCommentPopover";
import PaperReaderLeftSidebar from "./paper-reader/PaperReaderLeftSidebar";
import { buildTextSections, deriveOutlineFromContent, mergePaperOutline, type PaperReaderOutlineItem } from "./paper-reader/paperReaderOutline";
import PaperReaderRightSidebar, { type AssistantContextItem } from "./paper-reader/PaperReaderRightSidebar";
import PaperReaderShell from "./paper-reader/PaperReaderShell";
import { createInitialPaperReaderState, paperReaderReducer, type ReaderSelectionPayload } from "./paper-reader/paperReaderState";
import PaperReaderTextMode from "./paper-reader/PaperReaderTextMode";
import type {
  PaperAssistantReply,
  PaperDetail,
  PaperNote,
  PaperReport,
  PaperReportState,
  ProjectPaperHighlight,
  ProjectPaperRecord,
} from "../types";

interface PaperReaderPanelProps {
  paper: PaperDetail | null;
  importedPaper: ProjectPaperRecord | null;
  pdfUrl: string | null;
  isLoading: boolean;
  isImporting: boolean;
  assistantReply: PaperAssistantReply | null;
  report: PaperReport | null;
  reportState: PaperReportState | null;
  notes: PaperNote[];
  isAskingAssistant: boolean;
  highlights: ProjectPaperHighlight[];
  onBackToSearch: () => void;
  onBackToWorkspace: () => void;
  onImportPaper: (paperId: string) => Promise<void>;
  onAskAssistant: (message: string) => Promise<PaperAssistantReply | null>;
  onAskSelectionAssistant: (selectionText: string, followUp?: string) => Promise<PaperAssistantReply | null>;
  onRegenerateReport: () => Promise<void>;
  onInsertCitation: () => Promise<void>;
  onInsertSummary: () => Promise<void>;
  onSaveReadingNote: () => Promise<void>;
  onCreateNote: (payload: {
    title: string;
    text: string;
    anchorId?: string | null;
    pageNumber?: number | null;
    contextText?: string | null;
  }) => Promise<void>;
  onUpdateNote: (
    note: PaperNote,
    patch: {
      title?: string;
      text?: string;
      anchorId?: string | null;
      pageNumber?: number | null;
      contextText?: string | null;
    },
  ) => Promise<void>;
  onDeleteNote: (note: PaperNote) => Promise<void>;
  onCreateHighlight: (payload: {
    kind: "highlight" | "comment";
    content: { text: string; image?: string };
    comment: { text: string; emoji: string };
    position: {
      boundingRect: Record<string, number>;
      rects: Array<Record<string, number>>;
      pageNumber: number;
      usePdfCoordinates?: boolean;
    };
  }) => Promise<void>;
  onDeleteHighlight: (highlight: ProjectPaperHighlight, options?: { skipConfirm?: boolean }) => Promise<void>;
}

function wait(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export default function PaperReaderPanel({
  paper,
  importedPaper,
  pdfUrl,
  isLoading,
  isImporting,
  assistantReply,
  report,
  reportState,
  notes,
  isAskingAssistant,
  highlights,
  onBackToSearch,
  onBackToWorkspace,
  onImportPaper,
  onAskAssistant,
  onAskSelectionAssistant,
  onRegenerateReport,
  onInsertCitation,
  onInsertSummary,
  onSaveReadingNote,
  onCreateNote,
  onUpdateNote,
  onDeleteNote,
  onCreateHighlight,
  onDeleteHighlight,
}: PaperReaderPanelProps) {
  const [state, dispatch] = useReducer(paperReaderReducer, undefined, createInitialPaperReaderState);
  const [pdfOutlineItems, setPdfOutlineItems] = useState<PaperReaderOutlineItem[]>([]);
  const [textScrollTargetId, setTextScrollTargetId] = useState<string | null>(null);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [assistantContexts, setAssistantContexts] = useState<AssistantContextItem[]>([]);
  const [latestSelection, setLatestSelection] = useState<ReaderSelectionPayload | null>(null);
  const pdfViewerRef = useRef<PaperPdfViewerHandle | null>(null);

  const textSections = useMemo(() => buildTextSections(paper?.content ?? ""), [paper?.content]);
  const contentOutline = useMemo(() => deriveOutlineFromContent(paper?.content ?? ""), [paper?.content]);
  const outlineItems = useMemo(() => mergePaperOutline(pdfOutlineItems, contentOutline), [contentOutline, pdfOutlineItems]);

  useEffect(() => {
    dispatch({ type: "SET_ACTIVE_OUTLINE", outlineId: outlineItems[0]?.id ?? null });
  }, [outlineItems]);

  useEffect(() => {
    dispatch({ type: "RESET" });
    setPdfOutlineItems([]);
    setTextScrollTargetId(null);
    setAssistantContexts([]);
    setLatestSelection(null);
  }, [paper?.paperId]);

  if (isLoading) {
    return <div className="empty-panel">论文内容加载中...</div>;
  }

  if (!paper) {
    return <div className="empty-panel">先从“搜索”页打开一篇论文，再进入阅读视图。</div>;
  }

  async function handleSubmitComment() {
    if (!state.commentPopover.selection || !state.commentPopover.draft.trim()) {
      return;
    }

    setIsSubmittingComment(true);

    try {
      await onCreateHighlight({
        kind: "comment",
        content: state.commentPopover.selection.content,
        comment: {
          text: state.commentPopover.draft.trim(),
          emoji: "评论",
        },
        position: state.commentPopover.selection.position,
      });
      dispatch({ type: "CLOSE_COMMENT_POPOVER" });
    } finally {
      setIsSubmittingComment(false);
    }
  }

  async function handleRunSelectionAssistant(selectionText: string, followUp = "") {
    if (!selectionText.trim()) {
      return;
    }

    dispatch({ type: "ASSISTANT_REQUEST_START" });
    const startedAt = Date.now();

    try {
      const reply = await onAskSelectionAssistant(selectionText.trim(), followUp.trim() || undefined);
      const elapsed = Date.now() - startedAt;

      if (elapsed < 400) {
        await wait(400 - elapsed);
      }

      dispatch({
        type: "ASSISTANT_REQUEST_SUCCESS",
        response: reply?.answer?.trim() || "研究助手没有返回可展示的内容。",
      });
    } catch (error) {
      const elapsed = Date.now() - startedAt;

      if (elapsed < 400) {
        await wait(400 - elapsed);
      }

      dispatch({
        type: "ASSISTANT_REQUEST_FAILURE",
        errorText: error instanceof Error ? error.message : "研究助手暂时不可用，请稍后再试。",
      });
    }
  }

  function pushAssistantContext(text: string, label: string) {
    const normalizedText = text.trim();
    if (!normalizedText) {
      return;
    }
    const contextLabel = label.trim() || "上下文";
    setAssistantContexts((current) => {
      const next: AssistantContextItem[] = [
        ...current,
        {
          id: `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          label: contextLabel,
          text: normalizedText,
        },
      ];
      return next.slice(-6);
    });
  }

  function buildPromptWithInjectedContexts(message: string) {
    const normalizedMessage = message.trim();
    if (!normalizedMessage) {
      return "";
    }
    if (assistantContexts.length === 0) {
      return normalizedMessage;
    }
    const contextBlocks = assistantContexts
      .map((item, index) => `[上下文 ${index + 1} | ${item.label}]\n${item.text}`)
      .join("\n\n");
    return `请优先结合以下上下文回答问题。\n\n${contextBlocks}\n\n用户问题：${normalizedMessage}`;
  }

  function handleOutlineSelect(item: PaperReaderOutlineItem) {
    dispatch({ type: "SET_ACTIVE_OUTLINE", outlineId: item.id });
    dispatch({ type: "TOGGLE_MOBILE_OUTLINE", nextValue: false });

    if (item.pageNumber) {
      dispatch({ type: "SET_READER_MODE", mode: "pdf" });
      setTextScrollTargetId(null);
      pdfViewerRef.current?.scrollToPage(item.pageNumber);
      return;
    }

    if (item.anchorId) {
      dispatch({ type: "SET_READER_MODE", mode: "text" });
      setTextScrollTargetId(item.anchorId);
      return;
    }

    window.alert("该目录项暂时不可定位");
  }

  const leftSidebar = (
    <PaperReaderLeftSidebar
      paper={paper}
      importedPaper={importedPaper}
      outlineItems={outlineItems}
      activeOutlineId={state.activeOutlineId}
      isMetadataExpanded={state.isMetadataExpanded}
      isImporting={isImporting}
      onBackToSearch={onBackToSearch}
      onBackToWorkspace={onBackToWorkspace}
      onOutlineSelect={handleOutlineSelect}
      onToggleMetadata={() => dispatch({ type: "TOGGLE_METADATA" })}
      onImportPaper={() => void onImportPaper(paper.paperId)}
      onInsertCitation={() => void onInsertCitation()}
      onInsertSummary={() => void onInsertSummary()}
      onSaveReadingNote={() => void onSaveReadingNote()}
    />
  );

  const rightSidebar = (
    <PaperReaderRightSidebar
      assistantReply={assistantReply}
      report={report}
      reportState={reportState}
      notes={notes}
      assistantContexts={assistantContexts}
      isAskingAssistant={isAskingAssistant}
      onAskAssistant={async (message) => {
        const prompt = buildPromptWithInjectedContexts(message);
        if (!prompt) {
          return;
        }
        await onAskAssistant(prompt);
      }}
      onRegenerateReport={onRegenerateReport}
      onActivateAssistantSelection={() => {
        dispatch({ type: "SET_READER_MODE", mode: "pdf" });
        dispatch({ type: "SET_TOOL", tool: "assistant" });
      }}
      onAddLatestSelectionContext={() => {
        if (!latestSelection?.text?.trim()) {
          window.alert("请先在 PDF 中选中一段文本，再添加上下文。");
          return;
        }
        pushAssistantContext(latestSelection.text, "选区");
      }}
      onRemoveAssistantContext={(contextId) => {
        setAssistantContexts((current) => current.filter((item) => item.id !== contextId));
      }}
      onCreateNote={onCreateNote}
      onUpdateNote={onUpdateNote}
      onDeleteNote={onDeleteNote}
      onUseNoteAsContext={(note) => {
        pushAssistantContext(note.text, note.title || "笔记");
      }}
    />
  );

  const centerStage = (
    <PaperReaderCenterStage
      title={paper.title}
      subtitle={paper.summary || "当前论文暂无摘要，可直接切到 PDF 或可读全文模式开始阅读。"}
      readerMode={state.readerMode}
      activeTool={state.activeTool}
      zoomLevel={state.zoomLevel}
      highlightCount={highlights.length}
      onSetReaderMode={(mode) => dispatch({ type: "SET_READER_MODE", mode })}
      onSetTool={(tool) => dispatch({ type: "SET_TOOL", tool })}
      onZoomIn={() => dispatch({ type: "ZOOM_IN" })}
      onZoomOut={() => dispatch({ type: "ZOOM_OUT" })}
      onToggleMobileOutline={() => dispatch({ type: "TOGGLE_MOBILE_OUTLINE" })}
      onToggleMobileInsights={() => dispatch({ type: "TOGGLE_MOBILE_INSIGHTS" })}
      content={
        state.readerMode === "pdf" ? (
          <PaperPdfViewer
            ref={pdfViewerRef}
            pdfUrl={pdfUrl}
            highlights={highlights}
            activeTool={state.activeTool}
            zoomLevel={state.zoomLevel}
            onCreateHighlight={onCreateHighlight}
            onOpenCommentComposer={(selection) => dispatch({ type: "OPEN_COMMENT_POPOVER", selection })}
            onOpenAssistantComposer={(selection) => {
              setLatestSelection(selection);
              dispatch({ type: "OPEN_ASSISTANT_POPOVER", selection });
              void handleRunSelectionAssistant(selection.text);
            }}
            onEraseHighlight={(highlight) => onDeleteHighlight(highlight, { skipConfirm: true })}
            onOutlineResolved={setPdfOutlineItems}
          />
        ) : (
          <PaperReaderTextMode sections={textSections} scrollTargetId={textScrollTargetId} />
        )
      }
    />
  );

  return (
    <>
      <PaperReaderShell
        leftSidebar={leftSidebar}
        centerStage={centerStage}
        rightSidebar={rightSidebar}
        mobileOutlineOpen={state.isMobileOutlineOpen}
        mobileInsightsOpen={state.isMobileInsightsOpen}
        onCloseMobileOutline={() => dispatch({ type: "TOGGLE_MOBILE_OUTLINE", nextValue: false })}
        onCloseMobileInsights={() => dispatch({ type: "TOGGLE_MOBILE_INSIGHTS", nextValue: false })}
      />

      <PaperReaderCommentPopover
        state={state.commentPopover}
        isSubmitting={isSubmittingComment}
        onChangeDraft={(draft) => dispatch({ type: "SET_COMMENT_DRAFT", draft })}
        onSubmit={() => void handleSubmitComment()}
        onClose={() => dispatch({ type: "CLOSE_COMMENT_POPOVER" })}
      />

      <PaperReaderAssistantPopover
        state={state.assistantPopover}
        onClose={() => dispatch({ type: "CLOSE_ASSISTANT_POPOVER" })}
        onChangeFollowUp={(followUp) => dispatch({ type: "SET_ASSISTANT_FOLLOW_UP", followUp })}
        onSubmitFollowUp={() =>
          void handleRunSelectionAssistant(
            state.assistantPopover.selection?.text ?? "",
            state.assistantPopover.followUp,
          )
        }
      />
    </>
  );
}

/*
 * Code Review:
 * - `PaperReaderPanel` 只保留编排和业务回调，不再自己承担大段布局与视觉细节，后续维护成本更低。
 * - 评论和 AI 弹层都围绕同一份 `ReaderSelectionPayload` 运转，能保证选区文本、位置和持久化坐标始终一致。
 * - outline 现在按“页码优先、锚点回退”的能力模型驱动跳转，避免把没有稳定页码的目录项误导成错误的 PDF 跳页。
 * - 阅读页“返回搜索”现在直接回顶栏一级搜索页，避免重新把论文搜索塞回工作台右侧工具面板。
 */
