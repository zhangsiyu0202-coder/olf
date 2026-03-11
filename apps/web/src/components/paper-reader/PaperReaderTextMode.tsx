/*
 * File: PaperReaderTextMode.tsx
 * Module: apps/web (论文阅读器全文模式)
 *
 * Responsibility:
 *   - 在 PDF 之外提供只读全文视图，服务 outline 回退定位和快速 skim。
 *   - 只做安全文本渲染，不承担批注持久化职责。
 *
 * Dependencies:
 *   - react
 *   - ./paperReaderOutline
 *
 * Last Updated:
 *   - 2026-03-09 by Codex - 为论文阅读器新增只读全文模式
 */

import { useEffect, useMemo, useRef } from "react";
import type { PaperReaderTextSection } from "./paperReaderOutline";

interface PaperReaderTextModeProps {
  sections: PaperReaderTextSection[];
  scrollTargetId: string | null;
}

export default function PaperReaderTextMode({ sections, scrollTargetId }: PaperReaderTextModeProps) {
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const normalizedSections = useMemo(() => sections.filter((section) => section.content.trim()), [sections]);

  useEffect(() => {
    if (!scrollTargetId) {
      return;
    }

    sectionRefs.current[scrollTargetId]?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, [scrollTargetId]);

  return (
    <div className="mx-auto flex w-full max-w-[850px] flex-col gap-6 px-4 pb-28 pt-6">
      {normalizedSections.map((section) => (
        <section
          key={section.id}
          ref={(node) => {
            sectionRefs.current[section.id] = node;
          }}
          className="rounded-[32px] border border-white/80 bg-white px-8 py-8 shadow-xl shadow-slate-900/8"
        >
          <div className="border-b border-slate-100 pb-4">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-slate-400">Readable Full Text</p>
            <h2 className="mt-3 text-2xl font-black text-slate-900">{section.title}</h2>
          </div>
          <div className="mt-5 space-y-5 text-[15px] leading-8 text-slate-700">
            {section.content
              .split(/\n{2,}/)
              .map((paragraph, index) => paragraph.trim())
              .filter(Boolean)
              .map((paragraph, index) => (
                <p key={`${section.id}-${index}`}>{paragraph}</p>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/*
 * Code Review:
 * - 全文模式只做安全文本展示，不复刻 PDF 标注系统，能把复杂度控制在“导航回退视图”范围内。
 * - 章节锚点和 outline 使用同一组 id，保证从左侧导航切换到全文时滚动目标稳定。
 * - 文本段落按空行切分，既保留原始内容顺序，也避免把整段全文渲染成单个巨型 `<pre>`。
 */
