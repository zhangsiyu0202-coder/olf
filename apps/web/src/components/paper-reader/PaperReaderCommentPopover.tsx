/*
 * File: PaperReaderCommentPopover.tsx
 * Module: apps/web (论文阅读器评论弹层)
 *
 * Responsibility:
 *   - 在用户选中文本后，以视口安全位置渲染评论输入框。
 *   - 管理评论输入、提交禁用态和关闭交互。
 *
 * Dependencies:
 *   - react
 *   - lucide-react
 *   - ./paperReaderState
 *
 * Last Updated:
 *   - 2026-03-09 by Codex - 为论文阅读器新增评论浮层
 */

import { MessageSquare, X } from "lucide-react";
import { useEffect, useMemo } from "react";
import type { CommentPopoverState } from "./paperReaderState";

interface PaperReaderCommentPopoverProps {
  state: CommentPopoverState;
  isSubmitting: boolean;
  onChangeDraft: (draft: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}

function clampPosition(x: number, y: number) {
  const width = 352;
  const height = 280;

  return {
    left: Math.max(16, Math.min(x - width / 2, window.innerWidth - width - 16)),
    top: Math.max(16, Math.min(y + 16, window.innerHeight - height - 16)),
  };
}

export default function PaperReaderCommentPopover({
  state,
  isSubmitting,
  onChangeDraft,
  onSubmit,
  onClose,
}: PaperReaderCommentPopoverProps) {
  const position = useMemo(() => {
    if (!state.selection) {
      return null;
    }

    return clampPosition(state.selection.pointer.x, state.selection.pointer.y);
  }, [state.selection]);

  useEffect(() => {
    if (!state.isOpen) {
      return undefined;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, state.isOpen]);

  if (!state.isOpen || !state.selection || !position) {
    return null;
  }

  return (
    <>
      <button type="button" className="fixed inset-0 z-30 cursor-default bg-transparent" onClick={onClose} aria-label="关闭评论输入框" />
      <div
        className="fixed z-40 w-[22rem] rounded-[28px] border border-white/80 bg-white p-5 shadow-2xl shadow-slate-900/20"
        style={position}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
              <MessageSquare className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-bold text-slate-900">添加评论</p>
              <p className="text-xs text-slate-500">评论会和这段 PDF 文本一起持久化。</p>
            </div>
          </div>
          <button type="button" className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <blockquote className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700">
          {state.selection.text}
        </blockquote>

        <textarea
          autoFocus
          value={state.draft}
          onChange={(event) => onChangeDraft(event.target.value)}
          className="mt-4 h-28 w-full resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-amber-300 focus:ring-4 focus:ring-amber-100"
          placeholder="记录你的判断、疑问或后续写作要点..."
        />

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300"
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            disabled={!state.draft.trim() || isSubmitting}
            className="rounded-full bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:bg-amber-300"
            onClick={onSubmit}
          >
            {isSubmitting ? "保存中..." : "保存评论"}
          </button>
        </div>
      </div>
    </>
  );
}

/*
 * Code Review:
 * - 弹层位置用视口 clamp，而不是简单按鼠标坐标硬摆，能避免用户在边缘选区时出现弹层被裁掉。
 * - 评论内容单独保存在 draft，关闭时不污染已持久化 highlight 数据。
 * - 遮罩层用透明按钮承载 outside click，逻辑简单且不依赖第三方弹层库。
 */
