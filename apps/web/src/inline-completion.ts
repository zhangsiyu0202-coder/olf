/*
 * File: inline-completion.ts
 * Module: apps/web (编辑器内联补全)
 *
 * Responsibility:
 *   - 为 CodeMirror 6 提供 ghost text 展示、Tab 接受、Esc 拒绝等 inline completion 基础能力。
 *   - 把补全状态与装饰逻辑收敛在独立模块，避免 `CodeEditor` 组件被状态机细节淹没。
 *
 * Runtime Logic Overview:
 *   1. 外层组件在拿到补全文本后，通过 effect 写入本模块的状态字段。
 *   2. 本模块把补全文本渲染为光标后的 ghost text。
 *   3. 用户按 Tab 时接受补全，按 Esc 时清空补全。
 *
 * Dependencies:
 *   - @codemirror/state
 *   - @codemirror/view
 *
 * Last Updated:
 *   - 2026-03-07 by Codex - 新增 CodeMirror inline completion 状态与 ghost text 渲染
 */

import { Prec, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, keymap } from "@codemirror/view";

export interface InlineSuggestionState {
  from: number;
  text: string;
  source: string;
  model: string;
}

export const setInlineSuggestionEffect = StateEffect.define<InlineSuggestionState | null>();
export const clearInlineSuggestionEffect = StateEffect.define<null>();

class InlineSuggestionWidget extends WidgetType {
  constructor(private readonly text: string) {
    super();
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-inlineSuggestion";
    span.textContent = this.text;
    return span;
  }
}

function buildInlineSuggestionDecorations(suggestion: InlineSuggestionState | null) {
  if (!suggestion?.text) {
    return Decoration.none;
  }

  return Decoration.set([
    Decoration.widget({
      widget: new InlineSuggestionWidget(suggestion.text),
      side: 1,
    }).range(suggestion.from),
  ]);
}

export const inlineSuggestionField = StateField.define<InlineSuggestionState | null>({
  create() {
    return null;
  },
  update(value, transaction) {
    let nextValue = value ? { ...value, from: transaction.changes.mapPos(value.from) } : null;

    if (transaction.docChanged || transaction.selection) {
      nextValue = null;
    }

    for (const effect of transaction.effects) {
      if (effect.is(setInlineSuggestionEffect)) {
        nextValue = effect.value ? { ...effect.value } : null;
      }

      if (effect.is(clearInlineSuggestionEffect)) {
        nextValue = null;
      }
    }

    return nextValue;
  },
  provide(field) {
    return EditorView.decorations.from(field, buildInlineSuggestionDecorations);
  },
});

function getInlineSuggestion(state: EditorView["state"]) {
  return state.field(inlineSuggestionField, false);
}

export function clearInlineSuggestion(view: EditorView) {
  const suggestion = getInlineSuggestion(view.state);

  if (!suggestion) {
    return false;
  }

  view.dispatch({
    effects: clearInlineSuggestionEffect.of(null),
  });
  return true;
}

export function acceptInlineSuggestion(view: EditorView) {
  const suggestion = getInlineSuggestion(view.state);

  if (!suggestion?.text) {
    return false;
  }

  view.dispatch({
    changes: {
      from: suggestion.from,
      to: suggestion.from,
      insert: suggestion.text,
    },
    selection: {
      anchor: suggestion.from + suggestion.text.length,
    },
    effects: clearInlineSuggestionEffect.of(null),
    userEvent: "input.complete.inline",
  });
  return true;
}

export const inlineCompletionExtensions = [
  inlineSuggestionField,
  Prec.highest(
    keymap.of([
      {
        key: "Tab",
        run: acceptInlineSuggestion,
      },
      {
        key: "Escape",
        run: clearInlineSuggestion,
      },
    ]),
  ),
];

/*
 * Code Review:
 * - 内联补全状态被限制为单一 suggestion，先满足 Copilot 风格的 ghost text 体验，不提前引入候选列表复杂度。
 * - 状态字段在文档变更和选区变化时主动失效，避免旧建议悬挂在错误位置。
 * - 若后续要支持多光标或多候选，可在本模块内部扩展，而不需要改动 `CodeEditor` 的外部 API。
 */
