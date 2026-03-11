/*
 * File: PaperReaderFloatingToolbar.tsx
 * Module: apps/web (论文阅读器悬浮工具栏)
 *
 * Responsibility:
 *   - 提供阅读模式切换和全局缩放控制。
 *   - 显式提示“当前模式需要的下一步操作”，减少伪工具栏误解。
 *
 * Dependencies:
 *   - react
 *   - lucide-react
 *   - ./paperReaderState
 *
 * Last Updated:
 *   - 2026-03-11 by Codex - 改为带标签的紧凑模式条，降低“图标伪交互”感
 */

import { Bot, Eraser, Highlighter, MessageSquare, MousePointer2, ZoomIn, ZoomOut } from "lucide-react";
import type { PaperReaderTool } from "./paperReaderState";

interface PaperReaderFloatingToolbarProps {
  activeTool: PaperReaderTool;
  zoomLevel: number;
  hintText: string;
  canErase: boolean;
  toolsDisabled?: boolean;
  onSetTool: (tool: PaperReaderTool) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

const toolDefinitions: Array<{
  value: PaperReaderTool;
  label: string;
  icon: typeof MousePointer2;
  activeClassName: string;
  idleClassName: string;
}> = [
  {
    value: "cursor",
    label: "游标",
    icon: MousePointer2,
    activeClassName: "bg-slate-900 text-white ring-slate-300",
    idleClassName: "text-slate-500 hover:bg-slate-100",
  },
  {
    value: "highlight",
    label: "高亮",
    icon: Highlighter,
    activeClassName: "bg-teal-600 text-white ring-teal-200",
    idleClassName: "text-teal-700 hover:bg-teal-50",
  },
  {
    value: "comment",
    label: "评论",
    icon: MessageSquare,
    activeClassName: "bg-amber-500 text-white ring-amber-200",
    idleClassName: "text-amber-600 hover:bg-amber-50",
  },
  {
    value: "assistant",
    label: "AI",
    icon: Bot,
    activeClassName: "bg-indigo-600 text-white ring-indigo-200",
    idleClassName: "text-indigo-600 hover:bg-indigo-50",
  },
  {
    value: "erase",
    label: "橡皮擦",
    icon: Eraser,
    activeClassName: "bg-rose-600 text-white ring-rose-200",
    idleClassName: "text-rose-600 hover:bg-rose-50",
  },
];

export default function PaperReaderFloatingToolbar({
  activeTool,
  zoomLevel,
  hintText,
  canErase,
  toolsDisabled = false,
  onSetTool,
  onZoomIn,
  onZoomOut,
}: PaperReaderFloatingToolbarProps) {
  return (
    <div className="pointer-events-auto fixed bottom-6 left-1/2 z-20 flex max-w-[calc(100vw-1rem)] -translate-x-1/2 items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-lg shadow-slate-900/10">
      <div className="flex items-center gap-1 border-r border-slate-200 pr-3">
        {toolDefinitions.map((tool) => {
          const Icon = tool.icon;
          const isActive = activeTool === tool.value;
          const isEraseTool = tool.value === "erase";
          const isDisabled = toolsDisabled || (isEraseTool && !canErase);
          const buttonTitle = isEraseTool && !canErase ? "当前没有可删除的高亮" : tool.label;

          return (
            <button
              key={tool.value}
              type="button"
              aria-pressed={isActive}
              title={buttonTitle}
              disabled={isDisabled}
              onClick={() => {
                if (isDisabled) {
                  return;
                }
                onSetTool(tool.value);
              }}
              className={`inline-flex h-10 items-center justify-center gap-1 rounded-xl px-2.5 text-xs font-semibold transition duration-200 ${
                isDisabled
                  ? "cursor-not-allowed bg-slate-100 text-slate-300"
                  : isActive
                    ? `${tool.activeClassName} ring-2`
                    : tool.idleClassName
              }`}
            >
              <Icon className="h-5 w-5" />
              <span className="hidden xl:inline">{tool.label}</span>
            </button>
          );
        })}
      </div>

      <div className="hidden min-w-[240px] max-w-[400px] text-xs font-semibold text-slate-500 lg:block">{hintText}</div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onZoomOut}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <div className="min-w-12 text-center text-sm font-bold text-slate-700">{zoomLevel}%</div>
        <button
          type="button"
          onClick={onZoomIn}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/*
 * Code Review:
 * - 工具按钮增加文本标签后，可发现性显著高于纯图标，减少“看得见但不知道是啥”的认知负担。
 * - 保留禁用态与提示文案，继续避免“按钮可点但没效果”的伪交互。
 * - 缩放控制维持独立分组，状态边界清晰。
 */
