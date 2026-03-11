/*
 * File: PaperReaderShell.tsx
 * Module: apps/web (论文阅读器布局壳)
 *
 * Responsibility:
 *   - 承载论文阅读页“左侧主阅读 + 右侧 Assistant 工作台”的双栏布局。
 *   - 处理桌面端 62/38 可拖拽分栏，以及窄屏抽屉态侧栏。
 *
 * Dependencies:
 *   - react
 *
 * Last Updated:
 *   - 2026-03-11 by Codex - 收口阅读页底板与移动端抽屉关闭交互，降低视觉噪声
 */

import { useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";

interface PaperReaderShellProps {
  leftSidebar: ReactNode;
  centerStage: ReactNode;
  rightSidebar: ReactNode;
  mobileOutlineOpen: boolean;
  mobileInsightsOpen: boolean;
  onCloseMobileOutline: () => void;
  onCloseMobileInsights: () => void;
}

const splitStorageKey = "paper-reader:right-pane-percent";
const defaultRightPanePercent = 38;
const minRightPanePercent = 28;
const maxRightPanePercent = 48;

export default function PaperReaderShell({
  leftSidebar,
  centerStage,
  rightSidebar,
  mobileOutlineOpen,
  mobileInsightsOpen,
  onCloseMobileOutline,
  onCloseMobileInsights,
}: PaperReaderShellProps) {
  const [rightPanePercent, setRightPanePercent] = useState(defaultRightPanePercent);

  useEffect(() => {
    try {
      const storedValue = window.localStorage.getItem(splitStorageKey);
      const parsedValue = Number(storedValue);
      if (!Number.isFinite(parsedValue)) {
        return;
      }
      setRightPanePercent(Math.max(minRightPanePercent, Math.min(maxRightPanePercent, parsedValue)));
    } catch {
      // 忽略本地存储不可用场景，继续使用默认比例。
    }
  }, []);

  function persistRightPanePercent(value: number) {
    try {
      window.localStorage.setItem(splitStorageKey, String(value));
    } catch {
      // 忽略写入失败，避免影响阅读主链路。
    }
  }

  function handleDragStart(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const viewportWidth = window.innerWidth;
    if (viewportWidth <= 1280) {
      return;
    }

    let nextPersistPercent = rightPanePercent;
    const onMouseMove = (moveEvent: MouseEvent) => {
      const nextRightPercent = ((viewportWidth - moveEvent.clientX) / viewportWidth) * 100;
      const clampedPercent = Math.max(minRightPanePercent, Math.min(maxRightPanePercent, nextRightPercent));
      nextPersistPercent = clampedPercent;
      setRightPanePercent(clampedPercent);
    };
    const onMouseUp = () => {
      persistRightPanePercent(nextPersistPercent);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  const leftPanePercent = 100 - rightPanePercent;

  return (
    <div className="relative flex min-h-[calc(100vh-64px)] w-full overflow-hidden bg-[linear-gradient(180deg,_#f7f8fa_0%,_#eff2f6_100%)] text-slate-900">
      <div className="relative hidden min-w-0 flex-1 xl:flex">
        <main
          className="relative min-w-0 border-r border-slate-200/85"
          style={{ width: `${leftPanePercent}%` }}
        >
          {centerStage}
        </main>

        <div
          role="separator"
          aria-orientation="vertical"
          className="group relative h-full w-2 cursor-col-resize bg-transparent"
          onMouseDown={handleDragStart}
        >
          <span className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 rounded-full bg-slate-300/80 transition group-hover:bg-sky-500/70" />
        </div>

        <aside
          className="h-full min-w-[360px] border-l border-slate-200/85 bg-slate-50"
          style={{ width: `${rightPanePercent}%` }}
        >
          {rightSidebar}
        </aside>
      </div>

      <main className="relative flex min-w-0 flex-1 xl:hidden">{centerStage}</main>

      {mobileOutlineOpen ? (
        <div className="absolute left-4 top-4 z-30 max-h-[88vh] w-[min(420px,calc(100%-2rem))] overflow-hidden rounded-[22px] border border-slate-200/90 bg-white shadow-2xl shadow-slate-900/12 xl:hidden">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Outline & Metadata</p>
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:border-slate-300 hover:text-slate-700"
              onClick={onCloseMobileOutline}
              aria-label="关闭目录抽屉"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {leftSidebar}
        </div>
      ) : null}

      {mobileOutlineOpen ? (
        <div className="absolute left-4 top-4 z-30 hidden max-h-[88vh] w-[420px] overflow-hidden rounded-[22px] border border-slate-200/90 bg-white shadow-2xl shadow-slate-900/12 xl:block">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Outline & Metadata</p>
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:border-slate-300 hover:text-slate-700"
              onClick={onCloseMobileOutline}
              aria-label="关闭目录抽屉"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {leftSidebar}
        </div>
      ) : null}

      {mobileInsightsOpen ? (
        <div className="absolute inset-x-4 bottom-4 z-30 max-h-[72vh] overflow-hidden rounded-[22px] border border-slate-200/90 bg-white shadow-2xl shadow-slate-900/15 xl:hidden">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Assistant Workspace</p>
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:border-slate-300 hover:text-slate-700"
              onClick={onCloseMobileInsights}
              aria-label="关闭助手抽屉"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {rightSidebar}
        </div>
      ) : null}
    </div>
  );
}

/*
 * Code Review:
 * - 背景和边框语义从“厚重玻璃卡片”收敛为中性分栏，避免阅读页视觉焦点被外层装饰抢走。
 * - 移动端抽屉新增显式关闭按钮，减少“侧栏盖住内容后无明显退出路径”的交互阻塞。
 * - 62/38 分栏拖拽与记忆逻辑保持不变，确保改版只动视觉与可用性，不破坏已有行为。
 */
