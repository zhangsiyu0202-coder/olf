/*
 * File: PaperReaderAssistantPopover.tsx
 * Module: apps/web (论文阅读器 AI 交互弹层)
 *
 * Responsibility:
 *   - 在用户选中文本后展示上下文敏感的 AI 分析结果。
 *   - 提供追问输入、加载态和错误态展示。
 *
 * Dependencies:
 *   - react
 *   - lucide-react
 *   - ./paperReaderState
 *
 * Last Updated:
 *   - 2026-03-09 by Codex - 为论文阅读器新增 AI 交互弹层
 */

import { Bot, Loader2, Send, X } from "lucide-react";
import { useEffect, useMemo } from "react";
import type { AssistantPopoverState } from "./paperReaderState";

interface PaperReaderAssistantPopoverProps {
  state: AssistantPopoverState;
  onClose: () => void;
  onChangeFollowUp: (value: string) => void;
  onSubmitFollowUp: () => void;
}

function clampPosition(x: number, y: number) {
  const width = 420;
  const height = 420;

  return {
    left: Math.max(16, Math.min(x - width / 2, window.innerWidth - width - 16)),
    top: Math.max(16, Math.min(y + 18, window.innerHeight - height - 16)),
  };
}

export default function PaperReaderAssistantPopover({
  state,
  onClose,
  onChangeFollowUp,
  onSubmitFollowUp,
}: PaperReaderAssistantPopoverProps) {
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
      <button type="button" className="fixed inset-0 z-30 cursor-default bg-transparent" onClick={onClose} aria-label="关闭 AI 弹层" />
      <div
        className="fixed z-40 w-[26.25rem] overflow-hidden rounded-[30px] border border-indigo-200/40 bg-slate-950 shadow-2xl shadow-slate-900/35"
        style={position}
      >
        <div className="flex items-center justify-between border-b border-white/10 bg-gradient-to-r from-indigo-600 to-teal-500 px-5 py-4 text-white">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-white/15">
              <Bot className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-bold">AI Research Assistant</p>
              <p className="text-xs text-white/80">根据当前论文与选中文本生成解释</p>
            </div>
          </div>
          <button type="button" className="rounded-full p-2 text-white/80 transition hover:bg-white/10" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5 text-slate-100">
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-teal-200/80">Selected Context</p>
            <p className="mt-2 text-sm leading-6 text-slate-200">{state.selection.text}</p>
          </div>

          <div className="min-h-[9rem] rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-4">
            {state.isLoading ? (
              <div className="flex min-h-[9rem] flex-col items-center justify-center gap-3 text-center text-sm text-slate-300">
                <Loader2 className="h-6 w-6 animate-spin text-teal-300" />
                <p>正在分析论文上下文与选中片段...</p>
              </div>
            ) : state.errorText ? (
              <div className="min-h-[9rem] text-sm leading-6 text-rose-200">{state.errorText}</div>
            ) : (
              <pre className="whitespace-pre-wrap font-sans text-sm leading-6 text-slate-100">{state.response}</pre>
            )}
          </div>

          <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
            <input
              value={state.followUp}
              onChange={(event) => onChangeFollowUp(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  onSubmitFollowUp();
                }
              }}
              className="flex-1 bg-transparent py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500"
              placeholder="继续追问这段内容的背景、方法或实验意义"
            />
            <button
              type="button"
              disabled={state.isLoading || !state.followUp.trim()}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-teal-400 text-slate-950 transition hover:bg-teal-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
              onClick={onSubmitFollowUp}
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/*
 * Code Review:
 * - 弹层内部所有 AI 文本都按纯文本渲染，避免把模型输出当 HTML 注入到页面。
 * - 追问输入和首轮选区解释共用同一弹层状态，减少多轮对话时的 UI 跳动。
 * - 错误态和加载态占位统一在结果面板内部，用户不会因为请求失败丢失当前选区上下文。
 */
