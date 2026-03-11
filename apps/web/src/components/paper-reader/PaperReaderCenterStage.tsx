/*
 * File: PaperReaderCenterStage.tsx
 * Module: apps/web (论文阅读器中央主阅读面)
 *
 * Responsibility:
 *   - 承载 PDF / 全文双模式切换、移动端抽屉入口和中央滚动阅读区。
 *   - 把模式栏、阅读状态提示和主阅读面组合成沉浸式主视图。
 *
 * Dependencies:
 *   - react
 *   - lucide-react
 *   - ./PaperReaderFloatingToolbar
 *
 * Last Updated:
 *   - 2026-03-11 by Codex - 收口顶部信息条密度与文案视觉层级
 */

import { LayoutPanelLeft, PanelRightClose, PanelRightOpen, ScrollText } from "lucide-react";
import type { ReactNode } from "react";
import PaperReaderFloatingToolbar from "./PaperReaderFloatingToolbar";
import type { PaperReaderMode, PaperReaderTool } from "./paperReaderState";

interface PaperReaderCenterStageProps {
  title: string;
  subtitle: string;
  readerMode: PaperReaderMode;
  activeTool: PaperReaderTool;
  zoomLevel: number;
  highlightCount: number;
  onSetReaderMode: (mode: PaperReaderMode) => void;
  onSetTool: (tool: PaperReaderTool) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onToggleMobileOutline: () => void;
  onToggleMobileInsights: () => void;
  content: ReactNode;
}

const toolLabels: Record<PaperReaderTool, string> = {
  cursor: "浏览",
  highlight: "高亮模式",
  comment: "评论模式",
  assistant: "AI 提问模式",
  erase: "橡皮擦模式",
};

function resolveModeHint(activeTool: PaperReaderTool, readerMode: PaperReaderMode, highlightCount: number) {
  if (readerMode !== "pdf") {
    return "当前在文本模式，批注工具仅在 PDF 模式生效。";
  }

  switch (activeTool) {
    case "highlight":
      return "请在 PDF 中拖选文本，松开后会直接保存高亮。";
    case "comment":
      return "请在 PDF 中拖选文本，随后会弹出评论输入框。";
    case "assistant":
      return "请在 PDF 中拖选文本，研究助手会基于选区回答。";
    case "erase":
      return highlightCount > 0 ? "点击任意高亮即可删除。" : "当前没有可删除的高亮。";
    default:
      return "浏览模式：可滚动阅读、点击目录跳转、查看已有高亮。";
  }
}

export default function PaperReaderCenterStage({
  title,
  subtitle,
  readerMode,
  activeTool,
  zoomLevel,
  highlightCount,
  onSetReaderMode,
  onSetTool,
  onZoomIn,
  onZoomOut,
  onToggleMobileOutline,
  onToggleMobileInsights,
  content,
}: PaperReaderCenterStageProps) {
  const toolsDisabled = readerMode !== "pdf";
  const modeHint = resolveModeHint(activeTool, readerMode, highlightCount);

  return (
    <section className="relative flex min-w-0 flex-1 flex-col">
      <div className="border-b border-slate-200 bg-white px-4 py-3 md:px-6">
        <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Paper Reader</p>
              <h1 className="mt-1.5 truncate text-2xl font-black text-slate-900 md:text-[30px]">{title}</h1>
              <p className="mt-1.5 max-w-3xl text-sm leading-6 text-slate-600">{subtitle}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-900"
                onClick={onToggleMobileOutline}
                title="打开目录与元数据侧栏"
                aria-label="打开目录与元数据侧栏"
              >
                <LayoutPanelLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-900"
                onClick={onToggleMobileInsights}
                title="打开 Assistant 侧栏"
                aria-label="打开 Assistant 侧栏"
              >
                <PanelRightOpen className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
              <button
                type="button"
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  readerMode === "pdf" ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
                }`}
                onClick={() => onSetReaderMode("pdf")}
              >
                PDF
              </button>
              <button
                type="button"
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  readerMode === "text" ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
                }`}
                onClick={() => onSetReaderMode("text")}
              >
                可读全文
              </button>
            </div>

            <div className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-500">
              <ScrollText className="h-4 w-4" />
              {readerMode === "pdf" ? "PDF 模式支持持久化批注" : "全文模式用于快速 skim 与大纲定位"}
            </div>

            <div className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-500">
              <PanelRightClose className="h-4 w-4" />
              当前模式：{toolLabels[activeTool]}
            </div>
          </div>
        </div>
      </div>

      <div className="paper-reader-stage relative flex-1 overflow-y-auto">{content}</div>

      <PaperReaderFloatingToolbar
        activeTool={activeTool}
        zoomLevel={zoomLevel}
        hintText={modeHint}
        canErase={highlightCount > 0}
        toolsDisabled={toolsDisabled}
        onSetTool={onSetTool}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
      />
    </section>
  );
}

/*
 * Code Review:
 * - 头部信息条改为中密度布局，避免标题区过厚挤压 PDF 主阅读高度。
 * - 控件造型和边框语义与左右侧栏统一，减少页面内组件风格割裂感。
 * - 行为逻辑不变，仅做视觉与排版收口，回归风险可控。
 */
