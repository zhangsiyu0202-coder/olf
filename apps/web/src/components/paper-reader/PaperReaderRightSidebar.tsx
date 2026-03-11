/*
 * File: PaperReaderRightSidebar.tsx
 * Module: apps/web (论文阅读器右侧 Assistant + Notes 栏)
 *
 * Responsibility:
 *   - 在阅读页右侧提供 Assistant 与 My Notes 双标签交互。
 *   - 展示结构化报告、上下文注入、提问输入和私有笔记管理入口。
 *
 * Dependencies:
 *   - react
 *   - lucide-react
 *   - ../../types
 *
 * Last Updated:
 *   - 2026-03-11 by Codex - 参考 UI 案例收口信息密度，并为长文本增加折叠阅读
 */

import { Bot, FilePenLine, Loader2, Plus, Sparkles, StickyNote, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { PaperAssistantReply, PaperNote, PaperReport, PaperReportState } from "../../types";

export interface AssistantContextItem {
  id: string;
  label: string;
  text: string;
}

interface PaperReaderRightSidebarProps {
  assistantReply: PaperAssistantReply | null;
  report: PaperReport | null;
  reportState: PaperReportState | null;
  notes: PaperNote[];
  assistantContexts: AssistantContextItem[];
  isAskingAssistant: boolean;
  onAskAssistant: (message: string) => Promise<void>;
  onRegenerateReport: () => Promise<void>;
  onActivateAssistantSelection: () => void;
  onAddLatestSelectionContext: () => void;
  onRemoveAssistantContext: (contextId: string) => void;
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
  onUseNoteAsContext: (note: PaperNote) => void;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function resolveReportStatusLabel(state: PaperReportState | null) {
  if (!state) {
    return "未生成";
  }
  if (state.status === "queued") {
    return "排队中";
  }
  if (state.status === "running") {
    return "生成中";
  }
  if (state.status === "ready") {
    return state.isStale ? "已过期（自动刷新中）" : "可用";
  }
  if (state.status === "degraded") {
    return "降级可用";
  }
  return "生成失败";
}

function resolveReportStatusTone(status: PaperReportState["status"] | null | undefined) {
  if (status === "ready") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "degraded") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  if (status === "running" || status === "queued") {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }
  return "border-rose-200 bg-rose-50 text-rose-700";
}

function previewText(rawText: string, maxLength = 420) {
  const normalized = rawText.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) {
    return {
      text: normalized,
      truncated: false,
    };
  }
  return {
    text: `${normalized.slice(0, maxLength)}...`,
    truncated: true,
  };
}

export default function PaperReaderRightSidebar({
  assistantReply,
  report,
  reportState,
  notes,
  assistantContexts,
  isAskingAssistant,
  onAskAssistant,
  onRegenerateReport,
  onActivateAssistantSelection,
  onAddLatestSelectionContext,
  onRemoveAssistantContext,
  onCreateNote,
  onUpdateNote,
  onDeleteNote,
  onUseNoteAsContext,
}: PaperReaderRightSidebarProps) {
  const [activeTab, setActiveTab] = useState<"assistant" | "notes">("assistant");
  const [assistantInput, setAssistantInput] = useState("");
  const [newNoteTitle, setNewNoteTitle] = useState("");
  const [newNoteText, setNewNoteText] = useState("");
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [isSummaryExpanded, setIsSummaryExpanded] = useState(false);
  const [expandedSectionMap, setExpandedSectionMap] = useState<Record<string, boolean>>({});

  const reportFailedRules = useMemo(
    () => (report?.constraints?.failedRules ?? []).filter((item) => String(item).trim().length > 0),
    [report?.constraints?.failedRules],
  );
  const summaryPreview = useMemo(() => {
    if (!report?.summary) {
      return {
        text: "报告已生成，但摘要为空。",
        truncated: false,
      };
    }
    return isSummaryExpanded ? { text: report.summary, truncated: false } : previewText(report.summary, 520);
  }, [isSummaryExpanded, report?.summary]);

  async function handleSubmitAssistantPrompt() {
    const normalizedInput = assistantInput.trim();
    if (!normalizedInput) {
      return;
    }
    await onAskAssistant(normalizedInput);
    setAssistantInput("");
  }

  async function handleCreateNote() {
    const title = newNoteTitle.trim() || "未命名笔记";
    const text = newNoteText.trim();
    if (!text) {
      return;
    }
    setIsSavingNote(true);
    try {
      await onCreateNote({
        title,
        text,
      });
      setNewNoteTitle("");
      setNewNoteText("");
    } finally {
      setIsSavingNote(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-3 bg-slate-50 px-4 py-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => setActiveTab("assistant")}
            className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
              activeTab === "assistant"
                ? "bg-slate-900 text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            Assistant 工作台
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("notes")}
            className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
              activeTab === "notes"
                ? "bg-slate-900 text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            My Notes
          </button>
        </div>
      </div>

      {activeTab === "assistant" ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <section className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
            <button
              type="button"
              className="group rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition hover:-translate-y-[1px] hover:border-slate-300 hover:shadow-md"
              onClick={onActivateAssistantSelection}
            >
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Highlight & Ask</p>
              <p className="mt-1.5 text-sm font-semibold text-slate-900 group-hover:text-slate-950">
                进入选区提问
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-500">框选 PDF 文本后立即发问，自动带入原文上下文。</p>
            </button>
            <button
              type="button"
              className="group rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition hover:-translate-y-[1px] hover:border-slate-300 hover:shadow-md"
              onClick={onAddLatestSelectionContext}
            >
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Add Context</p>
              <p className="mt-1.5 text-sm font-semibold text-slate-900 group-hover:text-slate-950">注入最近选区</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">把刚才选中的段落加入上下文，继续多轮追问。</p>
            </button>
          </section>

          <section className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Structured Report</p>
                <div className="mt-1 flex items-center gap-2">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${resolveReportStatusTone(reportState?.status ?? null)}`}
                  >
                    {resolveReportStatusLabel(reportState)}
                  </span>
                  {reportState?.isStale ? <span className="text-xs text-slate-500">旧报告刷新中</span> : null}
                </div>
              </div>
              <button
                type="button"
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                onClick={() => void onRegenerateReport()}
              >
                重算
              </button>
            </div>

            <div className="max-h-full space-y-3 overflow-y-auto px-4 py-4">
              {report ? (
                <>
                  <article className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm leading-6 text-slate-100">
                    <div className="mb-1.5 flex items-center gap-2 text-cyan-300">
                      <Sparkles className="h-4 w-4" />
                      <span className="text-[11px] font-bold uppercase tracking-[0.12em]">
                        {report.model || report.engine}
                      </span>
                    </div>
                    <p>{summaryPreview.text}</p>
                    {summaryPreview.truncated ? (
                      <button
                        type="button"
                        className="mt-2 text-xs font-semibold text-cyan-300 transition hover:text-cyan-200"
                        onClick={() => setIsSummaryExpanded(true)}
                      >
                        展开摘要
                      </button>
                    ) : null}
                  </article>

                  {report.sections.map((section) => (
                    <article key={section.id} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <h4 className="text-sm font-semibold text-slate-900">{section.title}</h4>
                      <p className="mt-1.5 text-sm leading-6 text-slate-700">
                        {expandedSectionMap[section.id]
                          ? section.content || "该章节暂无稳定内容。"
                          : previewText(section.content || "该章节暂无稳定内容。", 240).text}
                      </p>
                      {!expandedSectionMap[section.id] &&
                      previewText(section.content || "该章节暂无稳定内容。", 240).truncated ? (
                        <button
                          type="button"
                          className="mt-1 text-xs font-semibold text-slate-600 transition hover:text-slate-900"
                          onClick={() =>
                            setExpandedSectionMap((current) => ({
                              ...current,
                              [section.id]: true,
                            }))
                          }
                        >
                          展开内容
                        </button>
                      ) : null}
                      {section.anchorIds.length > 0 ? (
                        <p className="mt-1.5 text-xs text-slate-500">锚点: {section.anchorIds.join(", ")}</p>
                      ) : null}
                    </article>
                  ))}

                  {!report.constraints.passed && reportFailedRules.length > 0 ? (
                    <article className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                      <p className="font-semibold">报告约束未完全满足（降级可用）</p>
                      <ul className="mt-2 list-disc space-y-1 pl-5">
                        {reportFailedRules.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </article>
                  ) : null}
                </>
              ) : (
                <article className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                  {reportState?.status === "queued" || reportState?.status === "running" ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      报告正在生成中，稍后会自动刷新。
                    </span>
                  ) : (
                    "尚未拿到可展示的报告。你可以手动点击“重算”触发生成。"
                  )}
                </article>
              )}

              {assistantContexts.length > 0 ? (
                <article className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Injected Context</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {assistantContexts.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700 transition hover:bg-sky-100"
                        title={item.text}
                        onClick={() => onRemoveAssistantContext(item.id)}
                      >
                        {item.label} ×
                      </button>
                    ))}
                  </div>
                </article>
              ) : null}

              {assistantReply ? (
                <article className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Latest Answer</p>
                  <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap font-sans text-sm leading-6 text-slate-700">
                    {assistantReply.answer}
                  </pre>
                  <button
                    type="button"
                    className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                    onClick={() =>
                      void onCreateNote({
                        title: "Assistant 摘要",
                        text: assistantReply.answer,
                      })
                    }
                  >
                    保存为笔记
                  </button>
                </article>
              ) : null}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex items-end gap-2">
              <textarea
                rows={2}
                value={assistantInput}
                onChange={(event) => setAssistantInput(event.target.value)}
                placeholder="Ask anything about this paper..."
                className="min-h-[60px] flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-slate-400 focus:bg-white"
              />
              <button
                type="button"
                disabled={isAskingAssistant || !assistantInput.trim()}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                onClick={() => void handleSubmitAssistantPrompt()}
              >
                {isAskingAssistant ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
              </button>
            </div>
          </section>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Create Note</p>
            <input
              value={newNoteTitle}
              onChange={(event) => setNewNoteTitle(event.target.value)}
              placeholder="笔记标题（可选）"
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-400 focus:bg-white"
            />
            <textarea
              rows={4}
              value={newNoteText}
              onChange={(event) => setNewNoteText(event.target.value)}
              placeholder="记录你的理解、疑问或复现实验计划..."
              className="mt-2 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-400 focus:bg-white"
            />
            <button
              type="button"
              disabled={isSavingNote || !newNoteText.trim()}
              className="mt-2 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              onClick={() => void handleCreateNote()}
            >
              {isSavingNote ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              保存笔记
            </button>
          </section>

          <section className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">My Notes</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{notes.length} 条笔记</p>
            </div>
            <div className="max-h-full space-y-3 overflow-y-auto px-4 py-4">
              {notes.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                  当前论文还没有私有笔记。
                </div>
              ) : null}

              {notes.map((note) => (
                <article key={note.id} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{note.title || "未命名笔记"}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {note.pageNumber ? `P${note.pageNumber} · ` : ""}
                        {formatDate(note.updatedAt)}
                      </p>
                    </div>
                    <StickyNote className="mt-0.5 h-4 w-4 text-slate-400" />
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{note.text}</p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-100"
                      onClick={() => onUseNoteAsContext(note)}
                    >
                      加入上下文
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-100"
                      onClick={() => {
                        const nextText = window.prompt("编辑笔记内容", note.text);
                        if (nextText === null) {
                          return;
                        }
                        void onUpdateNote(note, { text: nextText });
                      }}
                    >
                      <FilePenLine className="mr-1 inline h-3 w-3" />
                      编辑
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100"
                      onClick={() => void onDeleteNote(note)}
                    >
                      <Trash2 className="mr-1 inline h-3 w-3" />
                      删除
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

/*
 * Code Review:
 * - 右栏样式改为“分段 tabs + 紧凑卡片 + 低噪声边框”后，信息密度和扫描效率比原先大圆角堆叠更稳。
 * - 报告摘要与章节加了折叠逻辑，避免上游抽取文本过长时直接把侧栏撑爆影响可读性。
 * - 交互能力保持不变，仍支持上下文注入、报告重算、笔记 CRUD 和“答案保存为笔记”闭环。
 */
