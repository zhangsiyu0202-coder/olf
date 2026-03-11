/*
 * File: PaperPdfViewer.tsx
 * Module: apps/web (论文 PDF 高亮阅读组件)
 *
 * Responsibility:
 *   - 基于 `react-pdf-highlighter` 提供 PDF 优先的论文阅读体验。
 *   - 将工具栏状态映射到 PDF 选区、高亮、评论、AI 和擦除交互。
 *
 * Runtime Logic Overview:
 *   1. 组件加载论文 PDF，并在容器宽度变化时保持 page-width 缩放。
 *   2. 用户根据当前工具模式创建高亮、评论或 AI 选区。
 *   3. 已保存批注会以热区形式回显，并支持跳页和擦除删除。
 *
 * Dependencies:
 *   - react
 *   - react-pdf-highlighter
 *   - ./paper-reader/paperReaderOutline
 *   - ./paper-reader/paperReaderState
 *
 * Last Updated:
 *   - 2026-03-11 by Codex - 将目录提取升级为 PDF 文本层重建优先，并把 PDF 原生书签降为辅助线索
 */

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ComponentProps } from "react";
import { Highlight, PdfHighlighter, PdfLoader, Popup } from "react-pdf-highlighter";
import type { IHighlight, ScaledPosition } from "react-pdf-highlighter";
import "react-pdf-highlighter/dist/style.css";
import type { ProjectPaperHighlight } from "../types";
import { buildRebuiltOutline, type PaperReaderOutlineItem, type PaperReaderPdfTextLine } from "./paper-reader/paperReaderOutline";
import type { ReaderSelectionPayload, ReaderPointerPosition, PaperReaderTool } from "./paper-reader/paperReaderState";

type LoadedPdfDocument = Parameters<ComponentProps<typeof PdfLoader>["children"]>[0];

export interface PaperPdfViewerHandle {
  scrollToHighlight: (highlightId: string) => void;
  scrollToPage: (pageNumber: number) => void;
}

interface PaperPdfViewerProps {
  pdfUrl: string | null;
  highlights: ProjectPaperHighlight[];
  activeTool: PaperReaderTool;
  zoomLevel: number;
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
  onOpenCommentComposer: (selection: ReaderSelectionPayload) => void;
  onOpenAssistantComposer: (selection: ReaderSelectionPayload) => void;
  onEraseHighlight: (highlight: ProjectPaperHighlight) => Promise<void>;
  onOutlineResolved: (items: PaperReaderOutlineItem[]) => void;
}

function normalizePosition(position: ScaledPosition) {
  return {
    boundingRect: {
      x1: position.boundingRect.x1,
      y1: position.boundingRect.y1,
      x2: position.boundingRect.x2,
      y2: position.boundingRect.y2,
      width: position.boundingRect.width,
      height: position.boundingRect.height,
      pageNumber: position.boundingRect.pageNumber ?? position.pageNumber,
    },
    rects: position.rects.map((rect) => ({
      x1: rect.x1,
      y1: rect.y1,
      x2: rect.x2,
      y2: rect.y2,
      width: rect.width,
      height: rect.height,
      pageNumber: rect.pageNumber ?? position.pageNumber,
    })),
    pageNumber: position.pageNumber,
    ...(typeof position.usePdfCoordinates === "boolean"
      ? { usePdfCoordinates: position.usePdfCoordinates }
      : {}),
  };
}

async function resolveOutlineDestinationPage(
  pdfDocument: LoadedPdfDocument,
  destination: unknown,
): Promise<number | null> {
  let normalizedDestination = destination;

  if (typeof normalizedDestination === "string") {
    normalizedDestination = await pdfDocument.getDestination(normalizedDestination);
  }

  if (!Array.isArray(normalizedDestination) || normalizedDestination.length === 0) {
    return null;
  }

  const pageRef = normalizedDestination[0];

  if (typeof pageRef === "number") {
    return pageRef + 1;
  }

  if (!pageRef || typeof pageRef !== "object") {
    return null;
  }

  const pageIndex = await pdfDocument.getPageIndex(pageRef as never);
  return pageIndex + 1;
}

async function flattenPdfOutline(
  pdfDocument: LoadedPdfDocument,
  items: Array<{
    title?: string;
    dest?: unknown;
    items?: Array<unknown>;
  }>,
  level = 1,
): Promise<PaperReaderOutlineItem[]> {
  const flattened: PaperReaderOutlineItem[] = [];

  for (const [index, item] of items.entries()) {
    const title = String(item.title ?? "").replace(/\s+/g, " ").trim();
    const pageNumber = await resolveOutlineDestinationPage(pdfDocument, item.dest);

    if (title) {
      flattened.push({
        id: `pdf-outline-${level}-${index}-${pageNumber ?? "x"}`,
        title,
        level,
        pageNumber,
        anchorId: null,
        source: "pdf_bookmark",
        confidence: pageNumber ? "high" : "medium",
      });
    }

    if (Array.isArray(item.items) && item.items.length > 0) {
      const childItems = await flattenPdfOutline(
        pdfDocument,
        item.items as Array<{ title?: string; dest?: unknown; items?: Array<unknown> }>,
        level + 1,
      );
      flattened.push(...childItems);
    }
  }

  return flattened.slice(0, 24);
}

interface PdfTextContentItem {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
}

interface PdfGroupedLine {
  y: number;
  lastX: number;
  lineHeight: number;
  text: string;
}

function isPdfTextContentItem(value: unknown) {
  if (!value || typeof value !== "object") {
    return false;
  }

  return typeof (value as PdfTextContentItem).str === "string" && Array.isArray((value as PdfTextContentItem).transform);
}

function appendTextFragment(currentText: string, nextText: string, gap: number) {
  if (!currentText) {
    return nextText;
  }

  if (!nextText) {
    return currentText;
  }

  if (/[\-(/[{]$/.test(currentText) || /^[,.;:!?%)\]}]/.test(nextText) || gap <= 1.5) {
    return `${currentText}${nextText}`;
  }

  return `${currentText} ${nextText}`;
}

async function extractPdfTextLines(pdfDocument: LoadedPdfDocument, maxPages = 48): Promise<PaperReaderPdfTextLine[]> {
  const lineItems: PaperReaderPdfTextLine[] = [];
  const totalPages = Number(pdfDocument.numPages ?? 0);
  const pageLimit = Math.min(totalPages || maxPages, maxPages);

  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
    const page = await pdfDocument.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const items = (textContent.items ?? [])
      .flatMap((rawItem) => {
        if (!isPdfTextContentItem(rawItem)) {
          return [];
        }

        const item = rawItem as PdfTextContentItem;
        return [
          {
            text: String(item.str ?? "").replace(/\s+/g, " ").trim(),
            x: Number(item.transform?.[4] ?? 0),
            y: Number(item.transform?.[5] ?? 0),
            width: Number(item.width ?? 0),
            height: Math.abs(Number(item.height ?? item.transform?.[0] ?? 0)),
          },
        ];
      })
      .filter((item) => item.text);

    items.sort((left, right) => {
      if (Math.abs(left.y - right.y) <= 2) {
        return left.x - right.x;
      }

      return right.y - left.y;
    });

    const groupedLines: PdfGroupedLine[] = [];

    for (const item of items) {
      const currentLine = groupedLines[groupedLines.length - 1] ?? null;
      const tolerance = currentLine ? Math.max(2, currentLine.lineHeight * 0.35, item.height * 0.35) : 0;

      if (currentLine && Math.abs(currentLine.y - item.y) <= tolerance) {
        const gap = item.x - currentLine.lastX;
        currentLine.text = appendTextFragment(currentLine.text, item.text, gap);
        currentLine.lastX = item.x + item.width;
        currentLine.lineHeight = Math.max(currentLine.lineHeight, item.height);
        continue;
      }

      groupedLines.push({
        y: item.y,
        lastX: item.x + item.width,
        lineHeight: item.height,
        text: item.text,
      });
    }

    for (const line of groupedLines) {
      const normalizedText = line.text.replace(/\s+/g, " ").trim();
      if (!normalizedText) {
        continue;
      }

      lineItems.push({
        text: normalizedText,
        pageNumber,
      });
    }
  }

  return lineItems;
}

function resolveCursorClassName(activeTool: PaperReaderTool) {
  switch (activeTool) {
    case "assistant":
      return "cursor-help";
    case "erase":
      return "cursor-not-allowed";
    case "highlight":
    case "comment":
      return "cursor-text";
    default:
      return "cursor-auto";
  }
}

function buildFallbackPointer(position: ScaledPosition): ReaderPointerPosition {
  return {
    x: Math.round(window.innerWidth / 2),
    y: Math.round(Math.min(window.innerHeight - 160, Math.max(96, position.boundingRect.y1 + 120))),
  };
}

function isValidSelection(content: { text?: string; image?: string }) {
  const normalized = (content.text ?? "").trim();

  if (!normalized) {
    return false;
  }

  return normalized.length >= 3 && normalized.length <= 200;
}

function PaperPdfDocumentView({
  pdfDocument,
  highlights,
  activeTool,
  zoomLevel,
  onCreateHighlight,
  onOpenCommentComposer,
  onOpenAssistantComposer,
  onEraseHighlight,
  onOutlineResolved,
  scrollToHighlightRef,
  highlighterRef,
}: {
  pdfDocument: LoadedPdfDocument;
  highlights: ProjectPaperHighlight[];
  activeTool: PaperReaderTool;
  zoomLevel: number;
  onCreateHighlight: PaperPdfViewerProps["onCreateHighlight"];
  onOpenCommentComposer: PaperPdfViewerProps["onOpenCommentComposer"];
  onOpenAssistantComposer: PaperPdfViewerProps["onOpenAssistantComposer"];
  onEraseHighlight: PaperPdfViewerProps["onEraseHighlight"];
  onOutlineResolved: PaperPdfViewerProps["onOutlineResolved"];
  scrollToHighlightRef: React.MutableRefObject<((highlight: ProjectPaperHighlight) => void) | null>;
  highlighterRef: React.MutableRefObject<PdfHighlighter<IHighlight> | null>;
}) {
  const lastPointerRef = useRef<ReaderPointerPosition | null>(null);
  const stageWidth = useMemo(() => Math.max(520, Math.round(850 * (zoomLevel / 100))), [zoomLevel]);

  useEffect(() => {
    let isActive = true;

    void (async () => {
      const [outline, pdfTextLines] = await Promise.all([
        pdfDocument.getOutline(),
        extractPdfTextLines(pdfDocument),
      ]);

      if (!isActive) {
        return;
      }

      const bookmarkHints = await flattenPdfOutline(
        pdfDocument,
        ((outline ?? []) as Array<{ title?: string; dest?: unknown; items?: Array<unknown> }>),
      );
      const rebuiltOutline = buildRebuiltOutline(pdfTextLines, bookmarkHints);

      if (isActive) {
        onOutlineResolved(rebuiltOutline);
      }
    })();

    return () => {
      isActive = false;
    };
  }, [onOutlineResolved, pdfDocument]);

  return (
    <div className="paper-pdf-shell flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-slate-200/80 px-5 py-4 text-sm text-slate-500">
        <span>当前模式：{activeTool === "cursor" ? "游标" : activeTool}</span>
        <small>{highlights.length} 条已保存批注</small>
      </div>

      <div className={`paper-pdf-canvas min-h-0 flex-1 overflow-auto p-4 ${resolveCursorClassName(activeTool)}`}>
        <div
          className="mx-auto rounded-[32px] border border-white/70 bg-white shadow-2xl shadow-slate-900/10"
          style={{ width: `${stageWidth}px` }}
          onMouseUpCapture={(event) => {
            lastPointerRef.current = {
              x: event.clientX,
              y: event.clientY,
            };
          }}
        >
          <PdfHighlighter<ProjectPaperHighlight>
            ref={highlighterRef as never}
            pdfDocument={pdfDocument}
            enableAreaSelection={() => false}
            highlights={highlights}
            pdfScaleValue="page-width"
            onScrollChange={() => undefined}
            scrollRef={(scrollTo) => {
              scrollToHighlightRef.current = scrollTo;
            }}
            onSelectionFinished={(position, content, hideTipAndSelection) => {
              if (activeTool === "cursor" || activeTool === "erase") {
                hideTipAndSelection();
                return null;
              }

              if (!isValidSelection(content)) {
                hideTipAndSelection();
                return null;
              }

              const normalizedSelection: ReaderSelectionPayload = {
                text: (content.text ?? "").trim(),
                content: content.image
                  ? { text: (content.text ?? "").trim(), image: content.image }
                  : { text: (content.text ?? "").trim() },
                position: normalizePosition(position),
                pointer: lastPointerRef.current ?? buildFallbackPointer(position),
              };

              if (activeTool === "highlight") {
                void onCreateHighlight({
                  kind: "highlight",
                  content: normalizedSelection.content,
                  comment: {
                    text: "",
                    emoji: "高亮",
                  },
                  position: normalizedSelection.position,
                }).finally(() => {
                  hideTipAndSelection();
                });
                return null;
              }

              if (activeTool === "comment") {
                onOpenCommentComposer(normalizedSelection);
                hideTipAndSelection();
                return null;
              }

              onOpenAssistantComposer(normalizedSelection);
              hideTipAndSelection();
              return null;
            }}
            highlightTransform={(highlight, _index, setTip, hideTip, _viewportToScaled, _screenshot, isScrolledTo) => {
              const isComment = highlight.kind === "comment";
              const isEraseMode = activeTool === "erase";
              const popupContent = (
                <div className="paper-highlight-popup">
                  <strong>{isComment ? "评论" : "高亮"}</strong>
                  <p>{highlight.comment.text || (isComment ? "未填写评论" : "无备注")}</p>
                  <small>{highlight.content.text || "无文本内容"}</small>
                </div>
              );

              return (
                <Popup
                  key={highlight.id}
                  popupContent={popupContent}
                  onMouseOver={(contentNode) => {
                    if (!isEraseMode) {
                      setTip(highlight, () => contentNode);
                    }
                  }}
                  onMouseOut={hideTip}
                >
                  <div
                    role={isEraseMode ? "button" : undefined}
                    tabIndex={isEraseMode ? 0 : -1}
                    onClick={(event) => {
                      if (!isEraseMode) {
                        return;
                      }

                      event.stopPropagation();
                      void onEraseHighlight(highlight);
                    }}
                    onKeyDown={(event) => {
                      if (!isEraseMode) {
                        return;
                      }

                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        void onEraseHighlight(highlight);
                      }
                    }}
                    className={isEraseMode ? "paper-highlight-hotspot-erasing" : ""}
                  >
                    <Highlight
                      isScrolledTo={isScrolledTo}
                      position={highlight.position}
                      comment={highlight.comment}
                    />
                  </div>
                </Popup>
              );
            }}
          />
        </div>
      </div>
    </div>
  );
}

const PaperPdfViewer = forwardRef<PaperPdfViewerHandle, PaperPdfViewerProps>(function PaperPdfViewer(
  {
    pdfUrl,
    highlights,
    activeTool,
    zoomLevel,
    onCreateHighlight,
    onOpenCommentComposer,
    onOpenAssistantComposer,
    onEraseHighlight,
    onOutlineResolved,
  },
  ref,
) {
  const scrollToHighlightRef = useRef<((highlight: ProjectPaperHighlight) => void) | null>(null);
  const highlighterRef = useRef<PdfHighlighter<IHighlight> | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      scrollToHighlight(highlightId: string) {
        const targetHighlight = highlights.find((item) => item.id === highlightId) ?? null;

        if (!targetHighlight) {
          return;
        }

        scrollToHighlightRef.current?.(targetHighlight);
      },
      scrollToPage(pageNumber: number) {
        highlighterRef.current?.viewer?.scrollPageIntoView({
          pageNumber,
        });
      },
    }),
    [highlights],
  );

  useEffect(() => {
    if (!pdfUrl) {
      onOutlineResolved([]);
    }
  }, [onOutlineResolved, pdfUrl]);

  if (!pdfUrl) {
    return <div className="empty-panel">当前论文还没有可用 PDF</div>;
  }

  return (
    <div className="paper-pdf-shell h-full">
      <PdfLoader
        url={pdfUrl}
        beforeLoad={<div className="empty-panel">PDF 加载中...</div>}
        onError={(error) => setErrorText(error.message)}
      >
        {(pdfDocument) => (
          <PaperPdfDocumentView
            pdfDocument={pdfDocument}
            highlights={highlights}
            activeTool={activeTool}
            zoomLevel={zoomLevel}
            onCreateHighlight={onCreateHighlight}
            onOpenCommentComposer={onOpenCommentComposer}
            onOpenAssistantComposer={onOpenAssistantComposer}
            onEraseHighlight={onEraseHighlight}
            onOutlineResolved={onOutlineResolved}
            scrollToHighlightRef={scrollToHighlightRef}
            highlighterRef={highlighterRef}
          />
        )}
      </PdfLoader>

      {errorText ? <small className="panel-error">{errorText}</small> : null}
    </div>
  );
});

export default PaperPdfViewer;

/*
 * Code Review:
 * - 选区逻辑完全跟随 `activeTool` 分流，避免旧版内置 Tip 弹层和新阅读器状态机并存造成双状态源。
 * - PDF 缩放通过 page-width + 容器宽度联动实现，而不是对画布做 CSS transform，能更稳地保持高亮坐标一致。
 * - 目录重建现在同时消费 PDF 文本层和 PDF 书签，书签只负责提供补充线索，不再直接决定阅读器显示的目录结构。
 */
