/*
 * File: CodeEditor.tsx
 * Module: apps/web (编辑器组件)
 *
 * Responsibility:
 *   - 基于 CodeMirror 6 提供 LaTeX 文本编辑能力。
 *   - 在需要时接入 Yjs 实时协作，让单文件编辑、远端光标和共享同步都收敛在同一组件内。
 *
 * Runtime Logic Overview:
 *   1. 组件挂载时创建 CodeMirror `EditorView`。
 *   2. 若传入协作配置，则同时创建 `Y.Doc + WebsocketProvider + Awareness`。
 *   3. 本地与远端编辑都会通过统一的 `onChange` 回调同步到 React 状态层。
 *
 * Dependencies:
 *   - react
 *   - @codemirror/*
 *   - ../inline-completion
 *   - ../api
 *   - yjs
 *   - y-websocket
 *   - y-codemirror.next
 *
 * Last Updated:
 *   - 2026-03-07 by Codex - 接入 inline completion ghost text 与 Tab/Esc 行为
 */

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, type ViewUpdate } from "@codemirror/view";
import {
  history,
  historyKeymap,
  indentWithTab,
  defaultKeymap,
} from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
} from "@codemirror/autocomplete";
import {
  bracketMatching,
  foldGutter,
  indentOnInput,
  syntaxHighlighting,
  defaultHighlightStyle,
  StreamLanguage,
} from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { requestInlineCompletion } from "../api";
import {
  clearInlineSuggestionEffect,
  inlineCompletionExtensions,
  setInlineSuggestionEffect,
} from "../inline-completion";
import type { CollaboratorPresence, CollaboratorUser } from "../types";

export interface CodeEditorHandle {
  focus: () => void;
  getSelectionText: () => string;
  getSelectionInfo: () => {
    text: string;
    from: number;
    to: number;
    lineStart: number;
    lineEnd: number;
    columnStart: number;
    columnEnd: number;
  } | null;
  insertTextAtSelection: (text: string) => void;
  scrollToLine: (line: number) => void;
}

interface CollaborationConfig {
  enabled: boolean;
  roomName: string;
  serverUrl: string;
  params?: Record<string, string>;
  user: CollaboratorUser;
  onStatusChange?: (status: "connected" | "connecting" | "disconnected") => void;
  onCollaboratorsChange?: (collaborators: CollaboratorPresence[]) => void;
}

interface CodeEditorProps {
  value: string;
  readOnly?: boolean;
  onChange: (value: string) => void;
  collaboration?: CollaborationConfig;
  inlineCompletion?: {
    enabled: boolean;
    projectId: string;
    currentFilePath: string | null;
    recentCompileLog?: string;
  };
}

function createBaseExtensions({
  readOnly,
  onChange,
  collaboration,
  onViewUpdate,
}: {
  readOnly: boolean;
  onChange: (value: string) => void;
  collaboration: {
    ytext: Y.Text;
    awareness: WebsocketProvider["awareness"];
    undoManager: Y.UndoManager;
  } | null;
  onViewUpdate?: (update: ViewUpdate) => void;
}) {
  const latexLanguage = StreamLanguage.define(stex);
  const extensions = [
    lineNumbers(),
    foldGutter(),
    history(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    highlightSelectionMatches(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    latexLanguage,
    keymap.of([
      indentWithTab,
      ...defaultKeymap,
      ...historyKeymap,
      ...closeBracketsKeymap,
      ...searchKeymap,
      ...(collaboration ? yUndoManagerKeymap : []),
    ]),
    EditorView.lineWrapping,
    EditorView.theme({
      "&": {
        height: "100%",
        backgroundColor: "#fffdf8",
        color: "#1f2937",
        fontSize: "14px",
        fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      },
      ".cm-scroller": {
        overflow: "auto",
        lineHeight: "1.75",
        padding: "20px 0",
      },
      ".cm-content": {
        minHeight: "100%",
        padding: "0 24px 48px 8px",
        caretColor: "#0f766e",
      },
      ".cm-gutters": {
        backgroundColor: "#fffdf8",
        color: "#9ca3af",
        border: "none",
        paddingLeft: "8px",
      },
      ".cm-activeLineGutter": {
        color: "#4b5563",
      },
      ".cm-activeLine": {
        backgroundColor: "rgba(16, 185, 129, 0.08)",
      },
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
        backgroundColor: "rgba(45, 212, 191, 0.18)",
      },
      ".cm-inlineSuggestion": {
        color: "rgba(107, 114, 128, 0.8)",
        pointerEvents: "none",
        fontStyle: "italic",
      },
      "&.cm-focused": {
        outline: "none",
      },
    }),
    EditorView.editable.of(!readOnly),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) {
        onViewUpdate?.(update);
        return;
      }

      onChange(update.state.doc.toString());
      onViewUpdate?.(update);
    }),
    ...inlineCompletionExtensions,
  ];

  if (collaboration) {
    extensions.push(
      yCollab(collaboration.ytext, collaboration.awareness, {
        undoManager: collaboration.undoManager,
      }),
    );
  }

  return extensions;
}

const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor(
  { value, readOnly = false, onChange, collaboration, inlineCompletion },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const ydocRef = useRef<Y.Doc | null>(null);
  const latestOnChangeRef = useRef(onChange);
  const inlineTimerRef = useRef<number | null>(null);
  const inlineAbortRef = useRef<AbortController | null>(null);
  const inlineRequestIdRef = useRef(0);
  const latestInlineCompletionRef = useRef(inlineCompletion);

  latestOnChangeRef.current = onChange;
  latestInlineCompletionRef.current = inlineCompletion;

  function clearPendingInlineRequest() {
    if (inlineTimerRef.current) {
      window.clearTimeout(inlineTimerRef.current);
      inlineTimerRef.current = null;
    }

    inlineAbortRef.current?.abort();
    inlineAbortRef.current = null;
  }

  function clearInlineSuggestion(view?: EditorView | null) {
    clearPendingInlineRequest();
    (view ?? viewRef.current)?.dispatch({
      effects: clearInlineSuggestionEffect.of(null),
    });
  }

  function shouldTriggerInlineCompletion(prefix: string, suffix: string) {
    const linePrefix = prefix.split("\n").at(-1) ?? prefix;

    if (!linePrefix.trim()) {
      return false;
    }

    if (/[)\]}]$/.test(linePrefix) && suffix.startsWith("\n")) {
      return false;
    }

    return (
      /\\[a-zA-Z@]*$/.test(linePrefix) ||
      /\\(?:begin|end|section|subsection|subsubsection|chapter|cite|label|ref)\{[^}\n]*$/.test(linePrefix) ||
      /[A-Za-z0-9_}]$/.test(linePrefix)
    );
  }

  function scheduleInlineCompletion(view: EditorView) {
    const config = latestInlineCompletionRef.current;

    clearPendingInlineRequest();

    if (!config?.enabled || readOnly || !config.projectId || !config.currentFilePath) {
      view.dispatch({ effects: clearInlineSuggestionEffect.of(null) });
      return;
    }

    const selection = view.state.selection.main;

    if (!selection.empty) {
      view.dispatch({ effects: clearInlineSuggestionEffect.of(null) });
      return;
    }

    const cursorOffset = selection.head;
    const documentText = view.state.doc.toString();
    const prefix = documentText.slice(Math.max(0, cursorOffset - 1800), cursorOffset);
    const suffix = documentText.slice(cursorOffset, Math.min(documentText.length, cursorOffset + 800));

    if (!shouldTriggerInlineCompletion(prefix, suffix)) {
      view.dispatch({ effects: clearInlineSuggestionEffect.of(null) });
      return;
    }

    const requestId = ++inlineRequestIdRef.current;

    inlineTimerRef.current = window.setTimeout(() => {
      const controller = new AbortController();
      inlineAbortRef.current = controller;

      void requestInlineCompletion(
        config.projectId,
        {
          currentFilePath: config.currentFilePath,
          currentFileContent: documentText,
          recentCompileLog: config.recentCompileLog ?? "",
          cursorOffset,
          prefix,
          suffix,
        },
        controller.signal,
      )
        .then(({ completion }) => {
          if (!completion.text.trim()) {
            clearInlineSuggestion(viewRef.current);
            return;
          }

          if (requestId !== inlineRequestIdRef.current) {
            return;
          }

          const activeView = viewRef.current;

          if (!activeView) {
            return;
          }

          const currentSelection = activeView.state.selection.main;
          const currentText = activeView.state.doc.toString();

          if (!currentSelection.empty || currentSelection.head !== cursorOffset || currentText !== documentText) {
            return;
          }

          activeView.dispatch({
            effects: setInlineSuggestionEffect.of({
              from: cursorOffset,
              text: completion.text,
              source: completion.source,
              model: completion.model,
            }),
          });
        })
        .catch((error) => {
          if (error instanceof Error && error.name === "AbortError") {
            return;
          }

          viewRef.current?.dispatch({
            effects: clearInlineSuggestionEffect.of(null),
          });
        });
    }, 380);
  }

  useEffect(() => {
    if (!hostRef.current || viewRef.current) {
      return;
    }

    let collaborationBinding = null;

    if (collaboration?.enabled) {
      const ydoc = new Y.Doc();
      const provider = new WebsocketProvider(collaboration.serverUrl, collaboration.roomName, ydoc, {
        maxBackoffTime: 1500,
        params: collaboration.params,
      });
      const ytext = ydoc.getText("content");
      const undoManager = new Y.UndoManager(ytext);

      provider.awareness.setLocalStateField("user", collaboration.user);
      provider.on("status", (event: { status: "connected" | "connecting" | "disconnected" }) => {
        collaboration.onStatusChange?.(event.status);
      });

      const emitCollaborators = () => {
        const collaborators: CollaboratorPresence[] = [];

        provider.awareness.getStates().forEach((state, clientId) => {
          if (!state?.user) {
            return;
          }

          collaborators.push({
            clientId,
            user: state.user,
            isLocal: clientId === ydoc.clientID,
          });
        });

        collaboration.onCollaboratorsChange?.(collaborators);
      };

      provider.awareness.on("change", emitCollaborators);
      emitCollaborators();

      collaborationBinding = {
        provider,
        ydoc,
        ytext,
        undoManager,
        destroy() {
          provider.awareness.off("change", emitCollaborators);
          collaboration.onCollaboratorsChange?.([]);
          provider.destroy();
          ydoc.destroy();
        },
      };

      providerRef.current = provider;
      ydocRef.current = ydoc;
    }

    const state = EditorState.create({
      doc: collaborationBinding ? collaborationBinding.ytext.toString() : value,
      extensions: createBaseExtensions({
        readOnly,
        onChange: (nextValue) => latestOnChangeRef.current(nextValue),
        onViewUpdate(update) {
          if (!latestInlineCompletionRef.current?.enabled) {
            return;
          }

          if (update.docChanged || update.selectionSet) {
            scheduleInlineCompletion(update.view);
          }
        },
        collaboration: collaborationBinding
          ? {
              ytext: collaborationBinding.ytext,
              awareness: collaborationBinding.provider.awareness,
              undoManager: collaborationBinding.undoManager,
            }
          : null,
      }),
    });

    viewRef.current = new EditorView({
      state,
      parent: hostRef.current,
    });

    return () => {
      clearPendingInlineRequest();
      viewRef.current?.destroy();
      viewRef.current = null;
      providerRef.current = null;
      ydocRef.current = null;
      collaborationBinding?.destroy();
    };
  }, [collaboration, readOnly, value]);

  useEffect(() => {
    if (!viewRef.current) {
      return;
    }

    if (!inlineCompletion?.enabled) {
      clearInlineSuggestion(viewRef.current);
      return;
    }

    scheduleInlineCompletion(viewRef.current);
  }, [
    inlineCompletion?.enabled,
    inlineCompletion?.projectId,
    inlineCompletion?.currentFilePath,
    inlineCompletion?.recentCompileLog,
  ]);

  useEffect(() => {
    if (collaboration?.enabled) {
      return;
    }

    const view = viewRef.current;

    if (!view) {
      return;
    }

    const currentValue = view.state.doc.toString();

    if (currentValue === value) {
      return;
    }

    view.dispatch({
      changes: {
        from: 0,
        to: currentValue.length,
        insert: value,
      },
    });
  }, [collaboration?.enabled, value]);

  useImperativeHandle(
    ref,
    () => ({
      focus() {
        viewRef.current?.focus();
      },
      getSelectionText() {
        const view = viewRef.current;

        if (!view) {
          return "";
        }

        const { from, to } = view.state.selection.main;
        return from === to ? "" : view.state.sliceDoc(from, to);
      },
      getSelectionInfo() {
        const view = viewRef.current;

        if (!view) {
          return null;
        }

        const { from, to } = view.state.selection.main;
        const anchor = from === to ? view.state.selection.main.head : from;
        const focus = from === to ? view.state.selection.main.head : to;
        const startLine = view.state.doc.lineAt(anchor);
        const endLine = view.state.doc.lineAt(focus);

        return {
          text: from === to ? "" : view.state.sliceDoc(from, to),
          from,
          to,
          lineStart: startLine.number,
          lineEnd: endLine.number,
          columnStart: anchor - startLine.from + 1,
          columnEnd: focus - endLine.from + 1,
        };
      },
      insertTextAtSelection(text: string) {
        const view = viewRef.current;

        if (!view) {
          return;
        }

        const { from, to } = view.state.selection.main;
        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from + text.length },
        });
        view.focus();
      },
      scrollToLine(line: number) {
        const view = viewRef.current;

        if (!view) {
          return;
        }

        const lineInfo = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines)));
        view.dispatch({
          effects: EditorView.scrollIntoView(lineInfo.from, { y: "center" }),
          selection: { anchor: lineInfo.from },
        });
        view.focus();
      },
    }),
    [],
  );

  return <div ref={hostRef} className="code-editor-host" />;
});

export default CodeEditor;

/*
 * Code Review:
 * - 组件继续保持“编辑器实现细节内聚”的边界，外层只感知协作配置和回调，而不直接操作 Yjs。
 * - 当前协作集成优先绑定单个文件房间、Awareness 和共享撤销，已经覆盖真实多人编辑的核心体验。
 * - inline completion 的网络请求与 ghost text 状态都被收敛在组件内部，保证外层 `App` 不需要处理高频光标事件。
 * - 若后续增加离线缓存或评论锚点，应继续在此扩展编辑器扩展层，而不是把协作逻辑散落到 `App` 中。
 */
