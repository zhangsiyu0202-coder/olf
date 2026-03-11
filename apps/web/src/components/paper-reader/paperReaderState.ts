/*
 * File: paperReaderState.ts
 * Module: apps/web (论文阅读器本地状态机)
 *
 * Responsibility:
 *   - 统一维护论文阅读器的工具栏、弹层、缩放和响应式抽屉状态。
 *   - 用显式 reducer 代替分散 `useState`，让工具切换和弹层生命周期更可控。
 *
 * Runtime Logic Overview:
 *   1. `PaperReaderPanel` 初始化 reducer 状态。
 *   2. 子组件通过 action 驱动工具、缩放、折叠区和弹层切换。
 *   3. 选区、评论和 AI 响应都先进入 reducer，再映射为 UI。
 *
 * Dependencies:
 *   - TypeScript 类型系统
 *
 * Last Updated:
 *   - 2026-03-09 by Codex - 为分栏论文阅读页新增显式状态机
 */

export type PaperReaderTool = "cursor" | "highlight" | "comment" | "assistant" | "erase";

export type PaperReaderMode = "pdf" | "text";

export interface ReaderPointerPosition {
  x: number;
  y: number;
}

export interface ReaderSelectionPayload {
  text: string;
  content: {
    text: string;
    image?: string;
  };
  position: {
    boundingRect: Record<string, number>;
    rects: Array<Record<string, number>>;
    pageNumber: number;
    usePdfCoordinates?: boolean;
  };
  pointer: ReaderPointerPosition;
}

export interface CommentPopoverState {
  isOpen: boolean;
  draft: string;
  selection: ReaderSelectionPayload | null;
}

export interface AssistantPopoverState {
  isOpen: boolean;
  selection: ReaderSelectionPayload | null;
  response: string;
  followUp: string;
  isLoading: boolean;
  errorText: string | null;
}

export interface PaperReaderState {
  activeTool: PaperReaderTool;
  zoomLevel: number;
  readerMode: PaperReaderMode;
  activeOutlineId: string | null;
  isMetadataExpanded: boolean;
  isAiInsightsExpanded: boolean;
  isMobileOutlineOpen: boolean;
  isMobileInsightsOpen: boolean;
  commentPopover: CommentPopoverState;
  assistantPopover: AssistantPopoverState;
}

export type PaperReaderAction =
  | { type: "RESET" }
  | { type: "SET_TOOL"; tool: PaperReaderTool }
  | { type: "ZOOM_IN" }
  | { type: "ZOOM_OUT" }
  | { type: "SET_READER_MODE"; mode: PaperReaderMode }
  | { type: "SET_ACTIVE_OUTLINE"; outlineId: string | null }
  | { type: "TOGGLE_METADATA" }
  | { type: "TOGGLE_AI_INSIGHTS" }
  | { type: "TOGGLE_MOBILE_OUTLINE"; nextValue?: boolean }
  | { type: "TOGGLE_MOBILE_INSIGHTS"; nextValue?: boolean }
  | { type: "OPEN_COMMENT_POPOVER"; selection: ReaderSelectionPayload }
  | { type: "SET_COMMENT_DRAFT"; draft: string }
  | { type: "CLOSE_COMMENT_POPOVER" }
  | { type: "OPEN_ASSISTANT_POPOVER"; selection: ReaderSelectionPayload }
  | { type: "SET_ASSISTANT_FOLLOW_UP"; followUp: string }
  | { type: "ASSISTANT_REQUEST_START" }
  | { type: "ASSISTANT_REQUEST_SUCCESS"; response: string }
  | { type: "ASSISTANT_REQUEST_FAILURE"; errorText: string }
  | { type: "CLOSE_ASSISTANT_POPOVER" };

const MIN_ZOOM = 50;
const MAX_ZOOM = 200;

export function createInitialPaperReaderState(): PaperReaderState {
  return {
    activeTool: "cursor",
    zoomLevel: 100,
    readerMode: "pdf",
    activeOutlineId: null,
    isMetadataExpanded: true,
    isAiInsightsExpanded: true,
    isMobileOutlineOpen: false,
    isMobileInsightsOpen: false,
    commentPopover: {
      isOpen: false,
      draft: "",
      selection: null,
    },
    assistantPopover: {
      isOpen: false,
      selection: null,
      response: "",
      followUp: "",
      isLoading: false,
      errorText: null,
    },
  };
}

export function paperReaderReducer(state: PaperReaderState, action: PaperReaderAction): PaperReaderState {
  switch (action.type) {
    case "RESET":
      return createInitialPaperReaderState();
    case "SET_TOOL":
      return {
        ...state,
        activeTool: action.tool,
      };
    case "ZOOM_IN":
      return {
        ...state,
        zoomLevel: Math.min(state.zoomLevel + 10, MAX_ZOOM),
      };
    case "ZOOM_OUT":
      return {
        ...state,
        zoomLevel: Math.max(state.zoomLevel - 10, MIN_ZOOM),
      };
    case "SET_READER_MODE":
      return {
        ...state,
        readerMode: action.mode,
      };
    case "SET_ACTIVE_OUTLINE":
      return {
        ...state,
        activeOutlineId: action.outlineId,
      };
    case "TOGGLE_METADATA":
      return {
        ...state,
        isMetadataExpanded: !state.isMetadataExpanded,
      };
    case "TOGGLE_AI_INSIGHTS":
      return {
        ...state,
        isAiInsightsExpanded: !state.isAiInsightsExpanded,
      };
    case "TOGGLE_MOBILE_OUTLINE":
      return {
        ...state,
        isMobileOutlineOpen: action.nextValue ?? !state.isMobileOutlineOpen,
      };
    case "TOGGLE_MOBILE_INSIGHTS":
      return {
        ...state,
        isMobileInsightsOpen: action.nextValue ?? !state.isMobileInsightsOpen,
      };
    case "OPEN_COMMENT_POPOVER":
      return {
        ...state,
        commentPopover: {
          isOpen: true,
          draft: "",
          selection: action.selection,
        },
      };
    case "SET_COMMENT_DRAFT":
      return {
        ...state,
        commentPopover: {
          ...state.commentPopover,
          draft: action.draft,
        },
      };
    case "CLOSE_COMMENT_POPOVER":
      return {
        ...state,
        commentPopover: {
          isOpen: false,
          draft: "",
          selection: null,
        },
      };
    case "OPEN_ASSISTANT_POPOVER":
      return {
        ...state,
        assistantPopover: {
          isOpen: true,
          selection: action.selection,
          response: "",
          followUp: "",
          isLoading: false,
          errorText: null,
        },
      };
    case "SET_ASSISTANT_FOLLOW_UP":
      return {
        ...state,
        assistantPopover: {
          ...state.assistantPopover,
          followUp: action.followUp,
        },
      };
    case "ASSISTANT_REQUEST_START":
      return {
        ...state,
        assistantPopover: {
          ...state.assistantPopover,
          isLoading: true,
          errorText: null,
        },
      };
    case "ASSISTANT_REQUEST_SUCCESS":
      return {
        ...state,
        assistantPopover: {
          ...state.assistantPopover,
          isLoading: false,
          response: action.response,
          followUp: "",
          errorText: null,
        },
      };
    case "ASSISTANT_REQUEST_FAILURE":
      return {
        ...state,
        assistantPopover: {
          ...state.assistantPopover,
          isLoading: false,
          errorText: action.errorText,
        },
      };
    case "CLOSE_ASSISTANT_POPOVER":
      return {
        ...state,
        assistantPopover: {
          isOpen: false,
          selection: null,
          response: "",
          followUp: "",
          isLoading: false,
          errorText: null,
        },
      };
    default:
      return state;
  }
}

/*
 * Code Review:
 * - reducer 把阅读器的高频 UI 状态集中管理，后续继续加工具模式时不会把状态散到多个子组件。
 * - 缩放边界在 reducer 内收口，能避免按钮和外部调用各自维护一套 `50-200` 约束。
 * - 评论弹层和 AI 弹层都显式带上选区 payload，便于关闭或重试时不丢上下文。
 */
