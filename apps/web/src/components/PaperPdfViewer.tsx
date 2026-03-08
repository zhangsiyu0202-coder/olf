/*
 * File: PaperPdfViewer.tsx
 * Module: apps/web (论文 PDF 高亮阅读组件)
 *
 * Responsibility:
 *   - 基于 `react-pdf-highlighter` 提供可摘录、可高亮的论文 PDF 阅读体验。
 *   - 负责渲染已保存摘录，并把用户新建摘录通过回调抛给上层持久化。
 *
 * Runtime Logic Overview:
 *   1. 组件加载受保护的 PDF URL。
 *   2. 用户在 PDF 中选中文本后，可填写一句摘录备注并保存。
 *   3. 已保存摘录会以高亮形式回显，并支持从外部列表滚动定位。
 *
 * Dependencies:
 *   - react
 *   - react-pdf-highlighter
 *
 * Last Updated:
 *   - 2026-03-08 by Codex - 将论文 PDF 阅读器升级为可摘录高亮视图
 */

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { Highlight, PdfHighlighter, PdfLoader, Popup, Tip } from "react-pdf-highlighter";
import "react-pdf-highlighter/dist/style.css";
import type { ProjectPaperHighlight } from "../types";

export interface PaperPdfViewerHandle {
  scrollToHighlight: (highlightId: string) => void;
}

interface PaperPdfViewerProps {
  pdfUrl: string | null;
  highlights: ProjectPaperHighlight[];
  onCreateHighlight: (payload: {
    content: { text: string; image?: string };
    comment: { text: string; emoji: string };
    position: {
      boundingRect: Record<string, number>;
      rects: Array<Record<string, number>>;
      pageNumber: number;
      usePdfCoordinates?: boolean;
    };
  }) => Promise<void>;
}

const PaperPdfViewer = forwardRef<PaperPdfViewerHandle, PaperPdfViewerProps>(function PaperPdfViewer(
  { pdfUrl, highlights, onCreateHighlight },
  ref,
) {
  const scrollToHighlightRef = useRef<((highlight: ProjectPaperHighlight) => void) | null>(null);
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
    }),
    [highlights],
  );

  if (!pdfUrl) {
    return <div className="empty-panel">当前论文还没有可用 PDF</div>;
  }

  function normalizePosition(position: {
    boundingRect: {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      width: number;
      height: number;
      pageNumber?: number;
    };
    rects: Array<{
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      width: number;
      height: number;
      pageNumber?: number;
    }>;
    pageNumber: number;
    usePdfCoordinates?: boolean;
  }) {
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

  return (
    <div className="paper-pdf-shell">
      <div className="paper-pdf-toolbar">
        <span>在 PDF 中框选文本即可保存摘录</span>
        <small>{highlights.length} 条已保存摘录</small>
      </div>

      <div className="paper-pdf-canvas paper-pdf-highlighter-shell">
        <PdfLoader
          url={pdfUrl}
          beforeLoad={<div className="empty-panel">PDF 加载中...</div>}
          onError={(error) => setErrorText(error.message)}
        >
          {(pdfDocument) => (
            <PdfHighlighter<ProjectPaperHighlight>
              pdfDocument={pdfDocument}
              enableAreaSelection={() => false}
              highlights={highlights}
              pdfScaleValue="page-width"
              onScrollChange={() => undefined}
              scrollRef={(scrollTo) => {
                scrollToHighlightRef.current = scrollTo;
              }}
              onSelectionFinished={(position, content, hideTipAndSelection) => (
                <Tip
                  onOpen={() => undefined}
                  onConfirm={(comment) => {
                    void onCreateHighlight({
                      content: content.image
                        ? {
                            text: content.text ?? "",
                            image: content.image,
                          }
                        : {
                            text: content.text ?? "",
                          },
                      comment,
                      position: normalizePosition(position),
                    }).finally(() => {
                      hideTipAndSelection();
                    });
                  }}
                />
              )}
              highlightTransform={(highlight, index, setTip, hideTip, _viewportToScaled, _screenshot, isScrolledTo) => (
                <Popup
                  key={highlight.id}
                  popupContent={
                    <div className="paper-highlight-popup">
                      <strong>{highlight.comment.emoji || "摘录"}</strong>
                      <p>{highlight.comment.text || "未填写备注"}</p>
                      <small>{highlight.content.text || "无文本内容"}</small>
                    </div>
                  }
                  onMouseOver={(popupContent) => {
                    setTip(highlight, () => popupContent);
                  }}
                  onMouseOut={hideTip}
                >
                  <Highlight
                    isScrolledTo={isScrolledTo}
                    position={highlight.position}
                    comment={highlight.comment}
                  />
                </Popup>
              )}
            />
          )}
        </PdfLoader>
      </div>

      {errorText ? <small className="panel-error">{errorText}</small> : null}
    </div>
  );
});

export default PaperPdfViewer;

/*
 * Code Review:
 * - 当前实现只启用文本摘录，不启用区域截图选择，先把最常用的论文阅读主流程做稳。
 * - 摘录一律通过回调交给上层持久化，组件本身不直接写 API，保持阅读器与业务状态解耦。
 * - `scrollRef` 被封装成组件句柄，便于外部摘录列表触发“回到 PDF 定位”。
 */
