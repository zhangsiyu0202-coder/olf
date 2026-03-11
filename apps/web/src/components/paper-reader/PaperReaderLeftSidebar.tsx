/*
 * File: PaperReaderLeftSidebar.tsx
 * Module: apps/web (论文阅读器左侧导航栏)
 *
 * Responsibility:
 *   - 展示返回动作、论文概览、outline 列表和折叠元数据区。
 *   - 保留导入引用、插入 cite、插入总结和保存笔记等阅读到写作闭环动作。
 *
 * Dependencies:
 *   - react
 *   - lucide-react
 *   - ./paperReaderOutline
 *   - ../../types
 *
 * Last Updated:
 *   - 2026-03-11 by Codex - 收口左栏卡片层级与留白，提升目录区可读性
 */

import { ChevronDown, ChevronUp, FileOutput, FilePenLine, LibraryBig, NotebookPen } from "lucide-react";
import type { PaperDetail, ProjectPaperRecord } from "../../types";
import type { PaperReaderOutlineItem } from "./paperReaderOutline";

interface PaperReaderLeftSidebarProps {
  paper: PaperDetail;
  importedPaper: ProjectPaperRecord | null;
  outlineItems: PaperReaderOutlineItem[];
  activeOutlineId: string | null;
  isMetadataExpanded: boolean;
  isImporting: boolean;
  onBackToSearch: () => void;
  onBackToWorkspace: () => void;
  onOutlineSelect: (item: PaperReaderOutlineItem) => void;
  onToggleMetadata: () => void;
  onImportPaper: () => void;
  onInsertCitation: () => void;
  onInsertSummary: () => void;
  onSaveReadingNote: () => void;
}

function formatYear(value: string | null) {
  if (!value) {
    return "未知";
  }

  return new Date(value).getFullYear().toString();
}

function resolveOutlineMetaLabel(item: PaperReaderOutlineItem) {
  if (item.pageNumber) {
    return `P${item.pageNumber}`;
  }

  if (item.anchorId) {
    return null;
  }

  return "待定位";
}

export default function PaperReaderLeftSidebar({
  paper,
  importedPaper,
  outlineItems,
  activeOutlineId,
  isMetadataExpanded,
  isImporting,
  onBackToSearch,
  onBackToWorkspace,
  onOutlineSelect,
  onToggleMetadata,
  onImportPaper,
  onInsertCitation,
  onInsertSummary,
  onSaveReadingNote,
}: PaperReaderLeftSidebarProps) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-4 bg-slate-50 p-4">
      <div className="space-y-2.5">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            onClick={onBackToSearch}
          >
            返回检索
          </button>
          <button
            type="button"
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            onClick={onBackToWorkspace}
          >
            返回工作台
          </button>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Paper Overview</p>
          <h1 className="mt-2 text-lg font-black leading-snug text-slate-900">{paper.title}</h1>
          <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-600">{paper.summary || "当前论文暂无摘要。"} </p>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold text-slate-600">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">{paper.sourceLabel}</span>
            {paper.venue ? (
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">{paper.venue}</span>
            ) : null}
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">{formatYear(paper.published)}</span>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Outline</p>
        </div>
        <div className="max-h-full space-y-1.5 overflow-y-auto px-3 py-3">
          {outlineItems.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-500">
              该论文暂未重建出稳定目录，可直接使用 PDF 阅读。
            </div>
          ) : null}
          {outlineItems.map((item) => {
            const metaLabel = resolveOutlineMetaLabel(item);
            const isLocatable = Boolean(item.pageNumber || item.anchorId);

            return (
              <button
                key={item.id}
                type="button"
                disabled={!isLocatable}
                title={!isLocatable ? "该目录项暂时不可定位" : item.title}
                onClick={() => onOutlineSelect(item)}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${
                  activeOutlineId === item.id
                    ? "border border-slate-900 bg-slate-900 text-white"
                    : "border border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50"
                } ${!isLocatable ? "cursor-not-allowed opacity-60 hover:bg-transparent" : ""}`}
              >
                <span className="line-clamp-2 flex-1 pr-3">{item.title}</span>
                {metaLabel ? (
                  <span className="text-[11px] font-bold uppercase tracking-[0.2em] opacity-75">{metaLabel}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <button
          type="button"
          className="flex w-full items-center justify-between text-left"
          onClick={onToggleMetadata}
        >
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Metadata</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">作者、来源与导入动作</p>
          </div>
          {isMetadataExpanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
        </button>

        {isMetadataExpanded ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
              <p className="font-semibold text-slate-900">作者</p>
              <p className="mt-1">{paper.authors.join(", ") || "作者未知"}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">发表年份</p>
                <p className="mt-2 font-semibold text-slate-900">{formatYear(paper.published)}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">可读状态</p>
                <p className="mt-2 font-semibold text-slate-900">{paper.fullTextAvailable ? "可直接获取 PDF" : "摘要 / 元数据"}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                disabled={!!importedPaper || isImporting}
                onClick={onImportPaper}
              >
                <LibraryBig className="h-4 w-4" />
                {importedPaper ? "已导入" : isImporting ? "导入中" : "导入引用"}
              </button>
              <button
                type="button"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                onClick={onInsertCitation}
              >
                <FilePenLine className="h-4 w-4" />
                插入 cite
              </button>
              <button
                type="button"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                onClick={onInsertSummary}
              >
                <FileOutput className="h-4 w-4" />
                插入总结
              </button>
              <button
                type="button"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                onClick={onSaveReadingNote}
              >
                <NotebookPen className="h-4 w-4" />
                保存笔记
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/*
 * Code Review:
 * - 左栏从“大圆角大留白”改为中密度卡片后，目录扫描效率更高，避免信息块像海报式堆叠。
 * - 行为入口保持不变，仍完整保留导入、插入 cite、插入总结和保存笔记动作，避免改皮肤时丢能力。
 * - outline 与 metadata 的信息语义继续稳定，仅调整视觉层级，不引入额外状态复杂度。
 */
