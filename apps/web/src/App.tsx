/*
 * File: App.tsx
 * Module: apps/web (工作台主界面)
 *
 * Responsibility:
 *   - 以“考拉论文”模板为审美基线，承载项目、文件、编辑、编译、快照和 AI 助手的主工作台。
 *   - 协调 React 状态、CodeMirror 编辑器和后端 API 的交互。
 *
 * Runtime Logic Overview:
 *   1. 启动后加载项目列表并自动选择活动项目。
 *   2. 左侧展示项目、文件树与大纲，中间提供 CodeMirror 编辑器。
 *   3. 工作台右侧以“工具内容区 + 贴边工具栏”承载面板导航，论文阅读作为独立页面视图呈现。
 *
 * Dependencies:
 *   - react
 *   - ./api
 *   - ./types
 *   - ./components/CodeEditor
 *   - ./outline
 *
 * Last Updated:
 *   - 2026-03-11 by Codex - 将论文检索默认规模回收到 200，并保留后端手工扩召回能力
 */

import {
  Suspense,
  lazy,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  startTransition,
} from "react";
import AuthScreen from "./components/AuthScreen";
import CodeEditor, { type CodeEditorHandle } from "./components/CodeEditor";
import ExplorePage from "./components/ExplorePage";
import GlobalSearchDropdown from "./components/GlobalSearchDropdown";
import PaperSearchPage from "./components/PaperSearchPage";
import UserSpacePage from "./components/user-space/UserSpacePage";
import {
  acceptProjectInvitation,
  addOrganizationMemberByEmail,
  addTeamMemberByEmail,
  ApiRequestError,
  appendCurrentUserQuery,
  clearAssistantConversation,
  compileProject,
  createOrganizationWorkspace,
  createProjectComment,
  createProject,
  createProjectFromTemplate,
  createProjectInWorkspace,
  createProjectDirectory,
  createProjectFile,
  createProjectInvitation,
  createTeamWorkspace,
  deleteProjectPaperHighlight,
  deleteProject,
  deleteProjectEntry,
  diagnoseCompileFailure,
  explainSelection,
  generateCompileFix,
  getProjectPaper,
  createProjectPaperHighlight,
  createProjectPaperNote,
  ensureProjectPaperReport,
  getCurrentUser,
  getCompileJob,
  getAssistantConversation,
  getInvitationPreview,
  getProjectPaperReport,
  getTemplateDetail,
  importProjectPaper,
  listTemplates,
  listProjectPaperNotes,
  listProjectPaperHighlights,
  listProjectPaperLibrary,
  getProjectSettings,
  getWorkspaces,
  getProjectTree,
  improveSelection,
  askProjectPaperAssistant,
  listOrganizationMembers,
  listOrganizationTeams,
  listProjectAuditLogs,
  listProjectComments,
  listProjectInvitations,
  listProjectMembers,
  listProjects,
  listSnapshots,
  listProjectVersionEvents,
  listTeamMembers,
  logoutCurrentSession,
  moveProjectEntry,
  readProjectFile,
  removeProjectMember,
  renameProject,
  revokeProjectInvitation,
  restoreSnapshot,
  resolveProjectComment,
  replyProjectComment,
  regenerateProjectPaperReport,
  searchGlobalResources,
  searchProjectPapers,
  streamAssistantChat,
  updateProjectPaperNote,
  updateProjectPaperHighlight,
  updateProjectFile,
  updateProjectSettings,
  deleteProjectPaperNote,
} from "./api";
import {
  createCollaborationRoomName,
  getCollaborationServerUrl,
} from "./collaboration";
import { buildOutline } from "./outline";
import {
  decorateSessionUser,
} from "./session";
import type {
  AuditLogRecord,
  AssistantDiagnosis,
  AssistantMessage,
  CollaboratorPresence,
  CompileDiagnostic,
  CompileJobRecord,
  FileNode,
  GlobalSearchGroup,
  GlobalSearchItem,
  OrganizationSummary,
  OutlineItem,
  PaperAssistantReply,
  PaperDetail,
  PaperNote,
  PaperReport,
  PaperReportState,
  PaperSourceStatus,
  ProjectPaperHighlight,
  ProjectTemplateDetail,
  ProjectTemplateSummary,
  PaperSearchResult,
  ProjectCompileSettings,
  ProjectCommentRecord,
  ProjectInvitation,
  ProjectMember,
  ProjectPaperRecord,
  ProjectSummary,
  SessionUser,
  SnapshotRecord,
  TeamSummary,
  VersionEventRecord,
  WorkspaceMembershipRecord,
  WorkspaceSummary,
} from "./types";
import type { UserSpaceProjectContext } from "./components/user-space/userSpaceTypes";

type AppView = "templates" | "search" | "workspace" | "paper-reader" | "user-space";
type PrimaryAppView = Exclude<AppView, "user-space">;

type RightTab =
  | "pdf"
  | "assistant"
  | "snapshots"
  | "logs"
  | "comments"
  | "members"
  | "audit";

const PaperReaderPanel = lazy(() => import("./components/PaperReaderPanel"));
const defaultPaperSources = ["arxiv", "pubmed", "openalex"];
const defaultPaperAssistantSources = ["arxiv", "pubmed"];
const defaultPaperSearchLimit = 200;

const rightTabDefinitions: Array<{ value: RightTab; label: string }> = [
  { value: "pdf", label: "PDF 预览" },
  { value: "assistant", label: "AI 助手" },
  { value: "snapshots", label: "快照历史" },
  { value: "logs", label: "编译日志" },
  { value: "comments", label: "评论批注" },
  { value: "members", label: "成员邀请" },
  { value: "audit", label: "审计回放" },
];

function createAssistantIntro(projectName: string): AssistantMessage {
  return {
    role: "assistant",
    content:
      `当前项目：${projectName}。\n` +
      "可以问我当前文件结构、LaTeX 语法、最近一次编译错误，或让我给出可直接插入的代码片段。",
  };
}

const assistantStreamingPlaceholder = "AI 正在推理，请稍候...";

function formatDate(value: string) {
  return new Date(value).toLocaleString("zh-CN");
}

function extractFirstCodeBlock(text: string) {
  const match = text.match(/```(?:latex)?\n([\s\S]*?)```/i);
  return match ? match[1]?.trim() ?? null : null;
}

function isTextFile(filePath: string | null) {
  return !!filePath && /\.(tex|bib|sty|cls|txt|md|log)$/i.test(filePath);
}

function formatPaperCitationSnippet(citeKey: string, targetFilePath: string | null) {
  if (targetFilePath?.toLowerCase().endsWith(".md")) {
    return `[@${citeKey}]`;
  }

  return `\\cite{${citeKey}}`;
}

function formatPaperSummarySnippet({
  paper,
  citeKey,
  summaryText,
  targetFilePath,
}: {
  paper: PaperDetail;
  citeKey: string;
  summaryText: string;
  targetFilePath: string | null;
}) {
  const cleanedSummary = summaryText.trim();
  const citation = formatPaperCitationSnippet(citeKey, targetFilePath);

  if (targetFilePath?.toLowerCase().endsWith(".md")) {
    return [
      `### ${paper.title}`,
      "",
      cleanedSummary,
      "",
      `引用：${citation}`,
      "",
    ].join("\n");
  }

  return [
    `% Paper note: ${paper.title}`,
    `\\paragraph{${paper.title.replace(/[{}]/g, "")}.}`,
    `${cleanedSummary}`,
    "",
    `${citation}`,
    "",
  ].join("\n");
}

function buildReadingNoteContent({
  paper,
  citeKey,
  assistantReply,
}: {
  paper: PaperDetail;
  citeKey: string;
  assistantReply: PaperAssistantReply | null;
}) {
  return [
    `## ${paper.title}`,
    "",
    `- Source: ${paper.sourceLabel}`,
    `- Authors: ${paper.authors.join(", ") || "Unknown"}`,
    `- Published: ${paper.published ?? "Unknown"}`,
    `- Paper ID: ${paper.paperId}`,
    `- Cite: \\cite{${citeKey}}`,
    "",
    "### Abstract Summary",
    paper.summary.trim(),
    "",
    "### Reading Note",
    (assistantReply?.answer || "暂无额外阅读总结。").trim(),
    "",
    "---",
    "",
  ].join("\n");
}

function formatPaperHighlightSnippet({
  paper,
  highlight,
  citeKey,
  targetFilePath,
}: {
  paper: PaperDetail;
  highlight: ProjectPaperHighlight;
  citeKey: string;
  targetFilePath: string | null;
}) {
  const citation = formatPaperCitationSnippet(citeKey, targetFilePath);
  const excerpt = highlight.content.text.trim();
  const noteText = highlight.comment.text.trim();

  if (targetFilePath?.toLowerCase().endsWith(".md")) {
    return [
      `> ${excerpt}`,
      "",
      noteText ? `备注：${noteText}` : null,
      `来源：${paper.title} ${citation}`,
      "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    `% Highlight from ${paper.title}`,
    "\\begin{quote}",
    excerpt,
    "\\end{quote}",
    noteText ? `% Note: ${noteText}` : null,
    citation,
    "",
  ]
    .filter(Boolean)
    .join("\n");
}

function collectTexFilePaths(nodes: FileNode[]): string[] {
  const paths: string[] = [];

  for (const node of nodes) {
    if (node.type === "directory") {
      paths.push(...collectTexFilePaths(node.children ?? []));
      continue;
    }

    if (/\.tex$/i.test(node.path)) {
      paths.push(node.path);
    }
  }

  return paths;
}

function findFileNodeByPath(nodes: FileNode[], targetPath: string): FileNode | null {
  for (const node of nodes) {
    if (node.type === "file" && node.path === targetPath) {
      return node;
    }

    if (node.type === "directory") {
      const nestedMatch = findFileNodeByPath(node.children ?? [], targetPath);

      if (nestedMatch) {
        return nestedMatch;
      }
    }
  }

  return null;
}

function formatCollaboratorLabel(name: string) {
  const normalizedName = name.trim().replace(/\s+/g, "");
  return normalizedName.slice(0, 2) || "协作";
}

function formatProjectRoleLabel(role: "owner" | "editor" | "commenter" | "viewer" | null) {
  switch (role) {
    case "owner":
      return "所有者";
    case "editor":
      return "编辑者";
    case "commenter":
      return "评论者";
    case "viewer":
      return "查看者";
    default:
      return "未加入项目";
  }
}

function formatWorkspaceRoleLabel(role: string | null) {
  switch (role) {
    case "owner":
      return "所有者";
    case "admin":
      return "管理员";
    case "member":
      return "成员";
    case "billing_viewer":
      return "账单只读";
    case "maintainer":
      return "维护者";
    default:
      return "成员";
  }
}

function getWorkspaceKey(workspace: WorkspaceSummary) {
  return `${workspace.type}:${workspace.type === "team" ? workspace.teamId : workspace.organizationId ?? workspace.id}`;
}

function formatAuditActionLabel(action: string) {
  return action.replaceAll(".", " / ");
}

function formatVersionEventLabel(eventType: string) {
  return eventType.replaceAll("_", " ");
}

function extractInvitationToken(rawValue: string) {
  const trimmedValue = rawValue.trim();

  if (!trimmedValue) {
    return "";
  }

  try {
    const url = new URL(trimmedValue);
    return url.searchParams.get("invite") ?? trimmedValue;
  } catch {
    return trimmedValue;
  }
}

function resolveInitialAppView(): AppView {
  const view = new URLSearchParams(window.location.search).get("view");
  if (view === "templates" || view === "explore") {
    return "templates";
  }

  if (view === "search") {
    return "search";
  }

  if (view === "user-space") {
    return "user-space";
  }

  return "workspace";
}

function syncAppViewToUrl(view: AppView) {
  const url = new URL(window.location.href);

  if (view === "templates") {
    url.searchParams.set("view", "templates");
  } else if (view === "search") {
    url.searchParams.set("view", "search");
  } else if (view === "user-space") {
    url.searchParams.set("view", "user-space");
  } else {
    url.searchParams.delete("view");
  }

  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function formatCollaborationStatus(
  status: "connected" | "connecting" | "disconnected",
  enabled: boolean,
  collaboratorCount: number,
) {
  if (!enabled) {
    return "当前文件未开启实时协作";
  }

  if (status === "connecting") {
    return "实时协作连接中...";
  }

  if (status === "disconnected") {
    return "实时协作已断开，等待重连";
  }

  if (collaboratorCount <= 1) {
    return "实时协作已连接，当前仅你在线";
  }

  return `实时协作已连接，共 ${collaboratorCount} 人在线`;
}

function ProjectCard({
  project,
  active,
  onSelect,
}: {
  project: ProjectSummary;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button type="button" className={`project-card${active ? " project-card-active" : ""}`} onClick={onSelect}>
      <div className="project-card-name">{project.name}</div>
      <div className="project-card-meta">
        {formatProjectRoleLabel(project.currentUserRole)} · {project.memberCount} 人 · {formatDate(project.updatedAt)}
      </div>
    </button>
  );
}

function FileTreeNode({
  node,
  activeFilePath,
  onOpenFile,
}: {
  node: FileNode;
  activeFilePath: string | null;
  onOpenFile: (node: FileNode) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  if (node.type === "directory") {
    return (
      <div className="file-tree-node">
        <button type="button" className="file-tree-directory" onClick={() => setExpanded((value) => !value)}>
          <span>{expanded ? "▾" : "▸"}</span>
          <span>{node.name}</span>
        </button>
        {expanded ? (
          <div className="file-tree-children">
            {(node.children ?? []).map((child) => (
              <FileTreeNode
                key={child.id}
                node={child}
                activeFilePath={activeFilePath}
                onOpenFile={onOpenFile}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`file-tree-file${activeFilePath === node.path ? " file-tree-file-active" : ""}`}
      onClick={() => onOpenFile(node)}
    >
      <span className="file-tree-file-name">{node.name}</span>
      <span className="file-tree-file-path">{node.path}</span>
    </button>
  );
}

function OutlineButton({ item, onJump }: { item: OutlineItem; onJump: (line: number) => void }) {
  return (
    <button type="button" className="toc-item" onClick={() => onJump(item.line)}>
      <span className="toc-item-main" data-level={item.level}>
        <strong>{item.level === 0 ? item.line : "•"}</strong>
        <span>{item.title}</span>
      </span>
      <small>L{item.line}</small>
    </button>
  );
}

function RightTabButton({
  value,
  label,
  active,
  onClick,
}: {
  value: RightTab;
  label: string;
  active: boolean;
  onClick: (value: RightTab) => void;
}) {
  function renderIcon() {
    switch (value) {
      case "pdf":
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 3.5h7l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 20V5A1.5 1.5 0 0 1 7.5 3.5z" />
            <path d="M14 3.5V8h4" />
            <path d="M8.5 12.5h7" />
            <path d="M8.5 16h7" />
          </svg>
        );
      case "assistant":
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3.5l1.4 4.1L17.5 9l-4.1 1.4L12 14.5l-1.4-4.1L6.5 9l4.1-1.4L12 3.5z" />
            <path d="M18.5 14l.9 2.6L22 17.5l-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9.9-2.6z" />
            <path d="M5.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z" />
          </svg>
        );
      case "snapshots":
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 6v6l3.5 2" />
            <circle cx="12" cy="12" r="7.5" />
            <path d="M5.5 4.5L3 7" />
            <path d="M18.5 4.5L21 7" />
          </svg>
        );
      case "logs":
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 7l-3 3 3 3" />
            <path d="M11 16h7" />
            <path d="M11 10h7" />
            <path d="M7.5 4.5h11A1.5 1.5 0 0 1 20 6v12a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 6 18V6a1.5 1.5 0 0 1 1.5-1.5z" />
          </svg>
        );
      case "comments":
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 6.5h12A2.5 2.5 0 0 1 20.5 9v6A2.5 2.5 0 0 1 18 17.5H11l-4.5 3V17.5H6A2.5 2.5 0 0 1 3.5 15V9A2.5 2.5 0 0 1 6 6.5z" />
            <path d="M8 11h8" />
            <path d="M8 14h5" />
          </svg>
        );
      case "members":
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="9" r="3" />
            <circle cx="16.5" cy="10" r="2.5" />
            <path d="M4.5 18c.9-2.4 2.9-3.8 5.5-3.8s4.6 1.4 5.5 3.8" />
            <path d="M14.5 17.5c.6-1.6 2-2.6 3.8-2.6 1.1 0 2.1.4 2.8 1.1" />
          </svg>
        );
      case "audit":
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3.5l7 2.5v5.8c0 4.3-2.7 8.1-7 9.7-4.3-1.6-7-5.4-7-9.7V6z" />
            <path d="M9.5 12.5l1.7 1.7 3.8-4.2" />
          </svg>
        );
      default:
        return null;
    }
  }

  return (
    <button
      type="button"
      className={`right-tab${active ? " right-tab-active" : ""}`}
      title={label}
      aria-label={label}
      onClick={() => onClick(value)}
    >
      <span className="right-tab-icon" aria-hidden="true">
        {renderIcon()}
      </span>
    </button>
  );
}

export default function App() {
  const editorRef = useRef<CodeEditorHandle | null>(null);
  const compilePollTimerRef = useRef<number | null>(null);
  const globalSearchRef = useRef<HTMLDivElement | null>(null);
  const globalSearchTimerRef = useRef<number | null>(null);
  const [appView, setAppView] = useState<AppView>(resolveInitialAppView);
  const [lastPrimaryAppView, setLastPrimaryAppView] = useState<PrimaryAppView>("workspace");
  const [authReady, setAuthReady] = useState(false);
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [personalWorkspace, setPersonalWorkspace] = useState<WorkspaceSummary | null>(null);
  const [organizationWorkspaces, setOrganizationWorkspaces] = useState<OrganizationSummary[]>([]);
  const [teamWorkspaces, setTeamWorkspaces] = useState<TeamSummary[]>([]);
  const [selectedWorkspaceKey, setSelectedWorkspaceKey] = useState<string | null>(null);
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMembershipRecord[]>([]);
  const [workspaceTeams, setWorkspaceTeams] = useState<TeamSummary[]>([]);
  const [templateCatalog, setTemplateCatalog] = useState<ProjectTemplateSummary[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<ProjectTemplateDetail | null>(null);
  const [templateQuery, setTemplateQuery] = useState("");
  const [templateSourceType, setTemplateSourceType] = useState("all");
  const [isTemplateCatalogLoading, setIsTemplateCatalogLoading] = useState(false);
  const [isTemplateCreating, setIsTemplateCreating] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeProjectName, setActiveProjectName] = useState("未选择项目");
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [editorValue, setEditorValue] = useState("");
  const deferredEditorValue = useDeferredValue(editorValue);
  const [statusText, setStatusText] = useState("同步完成");
  const [snapshots, setSnapshots] = useState<SnapshotRecord[]>([]);
  const [rightTab, setRightTab] = useState<RightTab>("pdf");
  const [compileLog, setCompileLog] = useState("尚未触发编译");
  const [activeCompileJob, setActiveCompileJob] = useState<CompileJobRecord | null>(null);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([
    createAssistantIntro("未选择项目"),
  ]);
  const [assistantInput, setAssistantInput] = useState("");
  const [isAssistantStreaming, setIsAssistantStreaming] = useState(false);
  const [assistantSuggestions, setAssistantSuggestions] = useState<string[]>([
    "解释一下当前文件的结构",
    "结合最近一次编译日志，告诉我错误怎么修",
    "给我一个可以直接插入的 LaTeX 示例",
  ]);
  const [projectPaperLibrary, setProjectPaperLibrary] = useState<ProjectPaperRecord[]>([]);
  const [paperSearchResults, setPaperSearchResults] = useState<PaperSearchResult[]>([]);
  const [paperSearchSourceStatuses, setPaperSearchSourceStatuses] = useState<PaperSourceStatus[]>([]);
  const [activePaper, setActivePaper] = useState<PaperDetail | null>(null);
  const [activePaperHighlights, setActivePaperHighlights] = useState<ProjectPaperHighlight[]>([]);
  const [activePaperReport, setActivePaperReport] = useState<PaperReport | null>(null);
  const [activePaperReportState, setActivePaperReportState] = useState<PaperReportState | null>(null);
  const [activePaperNotes, setActivePaperNotes] = useState<PaperNote[]>([]);
  const [paperAssistantReply, setPaperAssistantReply] = useState<PaperAssistantReply | null>(null);
  const [isPaperSearching, setIsPaperSearching] = useState(false);
  const [isPaperLoading, setIsPaperLoading] = useState(false);
  const [isPaperImporting, setIsPaperImporting] = useState(false);
  const [isPaperAssistantLoading, setIsPaperAssistantLoading] = useState(false);
  const [isPaperReportRegenerating, setIsPaperReportRegenerating] = useState(false);
  const [compileDiagnosis, setCompileDiagnosis] = useState<AssistantDiagnosis | null>(null);
  const [projectMembers, setProjectMembers] = useState<ProjectMember[]>([]);
  const [projectInvitations, setProjectInvitations] = useState<ProjectInvitation[]>([]);
  const [projectComments, setProjectComments] = useState<ProjectCommentRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [versionEvents, setVersionEvents] = useState<VersionEventRecord[]>([]);
  const [compileSettings, setCompileSettings] = useState<ProjectCompileSettings | null>(null);
  const [compileSettingsDraft, setCompileSettingsDraft] = useState<ProjectCompileSettings | null>(null);
  const [collaborationStatus, setCollaborationStatus] = useState<
    "connected" | "connecting" | "disconnected"
  >("disconnected");
  const [collaborators, setCollaborators] = useState<CollaboratorPresence[]>([]);
  const [globalSearchQuery, setGlobalSearchQuery] = useState("");
  const [globalSearchGroups, setGlobalSearchGroups] = useState<GlobalSearchGroup[]>([]);
  const [isGlobalSearching, setIsGlobalSearching] = useState(false);
  const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState(false);

  const outline = useMemo(() => buildOutline(deferredEditorValue), [deferredEditorValue]);
  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );
  const activeImportedPaper = useMemo(
    () => (activePaper ? projectPaperLibrary.find((paper) => paper.paperId === activePaper.paperId) ?? null : null),
    [activePaper, projectPaperLibrary],
  );
  const allWorkspaces = useMemo<WorkspaceSummary[]>(() => {
    const entries: WorkspaceSummary[] = [];

    if (personalWorkspace) {
      entries.push(personalWorkspace);
    }

    entries.push(
      ...organizationWorkspaces.map((organization) => ({
        id: organization.id,
        type: "organization" as const,
        name: organization.name,
        organizationId: organization.id,
        teamId: null,
        currentUserRole: organization.currentUserRole,
      })),
    );

    entries.push(
      ...teamWorkspaces.map((team) => ({
        id: team.id,
        type: "team" as const,
        name: team.name,
        organizationId: team.organizationId,
        teamId: team.id,
        currentUserRole: team.currentUserRole,
      })),
    );

    return entries;
  }, [organizationWorkspaces, personalWorkspace, teamWorkspaces]);
  const activeWorkspace = useMemo(
    () => allWorkspaces.find((workspace) => getWorkspaceKey(workspace) === selectedWorkspaceKey) ?? personalWorkspace,
    [allWorkspaces, personalWorkspace, selectedWorkspaceKey],
  );
  const visibleProjects = useMemo(() => {
    if (!activeWorkspace) {
      return projects;
    }

    return projects.filter((project) => {
      if (activeWorkspace.type === "personal") {
        return project.workspaceType === "personal";
      }

      if (activeWorkspace.type === "organization") {
        return project.workspaceType === "organization" && project.organizationId === activeWorkspace.organizationId;
      }

      return project.workspaceType === "team" && project.teamId === activeWorkspace.teamId;
    });
  }, [activeWorkspace, projects]);
  const canManageProjectMembers = activeProject?.currentUserRole === "owner";
  const activeFileComments = useMemo(
    () => projectComments.filter((comment) => (activeFileId ? comment.fileId === activeFileId : true)),
    [activeFileId, projectComments],
  );
  const texFileOptions = useMemo(() => collectTexFilePaths(fileTree), [fileTree]);
  const hasUnsavedCompileSettings =
    !!compileSettings &&
    !!compileSettingsDraft &&
    (compileSettings.rootFile !== compileSettingsDraft.rootFile ||
      compileSettings.compileEngine !== compileSettingsDraft.compileEngine);
  const collaborationConfig = useMemo(() => {
    if (!sessionUser || !activeProjectId || !activeFileId || !activeFilePath || !isTextFile(activeFilePath)) {
      return null;
    }

    return {
      enabled: true,
      roomName: createCollaborationRoomName(activeProjectId, activeFileId),
      serverUrl: getCollaborationServerUrl(),
      user: sessionUser,
      onStatusChange: setCollaborationStatus,
      onCollaboratorsChange: setCollaborators,
    };
  }, [activeFileId, activeFilePath, activeProjectId, sessionUser]);
  const visibleCollaborators = useMemo(() => {
    if (collaborators.length > 0) {
      return [...collaborators].sort((left, right) => Number(right.isLocal) - Number(left.isLocal));
    }

    if (!collaborationConfig) {
      return [];
    }

    return sessionUser
      ? [
          {
            clientId: -1,
            user: sessionUser,
            isLocal: true,
          },
        ]
      : [];
  }, [collaborationConfig, collaborators, sessionUser]);
  const collaborationSummary = useMemo(
    () => formatCollaborationStatus(collaborationStatus, !!collaborationConfig, visibleCollaborators.length),
    [collaborationConfig, collaborationStatus, visibleCollaborators.length],
  );

  useEffect(() => {
    void bootstrap();

    return () => {
      stopCompilePolling();
    };
  }, []);

  useEffect(() => {
    syncAppViewToUrl(appView);
  }, [appView]);

  useEffect(() => {
    if (appView !== "user-space") {
      setLastPrimaryAppView(appView);
    }
  }, [appView]);

  useEffect(() => {
    if (!sessionUser) {
      setTemplateCatalog([]);
      setSelectedTemplateId(null);
      setSelectedTemplate(null);
      return;
    }

    void refreshTemplateCatalog().catch((error) => {
      if (handleUnauthorizedError(error)) {
        return;
      }

      setStatusText(error instanceof Error ? error.message : "加载模板目录失败");
    });
  }, [sessionUser]);

  useEffect(() => {
    if (!selectedTemplateId || !sessionUser) {
      setSelectedTemplate(null);
      return;
    }

    setSelectedTemplate((current) => (current?.id === selectedTemplateId ? current : null));

    void loadTemplateDetail(selectedTemplateId).catch((error) => {
      if (handleUnauthorizedError(error)) {
        return;
      }

      setStatusText(error instanceof Error ? error.message : "加载模板详情失败");
    });
  }, [selectedTemplateId, sessionUser]);

  useEffect(() => {
    if (!activeProjectId || !activePaper || appView !== "paper-reader") {
      return undefined;
    }

    const currentStatus = activePaperReportState?.status;
    if (currentStatus !== "queued" && currentStatus !== "running") {
      return undefined;
    }

    const timer = window.setInterval(() => {
      void refreshPaperReportForReader(activeProjectId, activePaper.paperId).catch((error) => {
        if (handleUnauthorizedError(error)) {
          return;
        }
        setStatusText(error instanceof Error ? error.message : "刷新论文报告状态失败");
      });
    }, 2600);

    return () => {
      window.clearInterval(timer);
    };
  }, [activePaper, activePaperReportState?.status, activeProjectId, appView]);

  useEffect(() => {
    if (!isGlobalSearchOpen) {
      return;
    }

    function handleDocumentPointerDown(event: MouseEvent) {
      if (!globalSearchRef.current?.contains(event.target as Node)) {
        setIsGlobalSearchOpen(false);
      }
    }

    document.addEventListener("mousedown", handleDocumentPointerDown);
    return () => {
      document.removeEventListener("mousedown", handleDocumentPointerDown);
    };
  }, [isGlobalSearchOpen]);

  useEffect(() => {
    const normalizedQuery = globalSearchQuery.trim();

    if (globalSearchTimerRef.current) {
      window.clearTimeout(globalSearchTimerRef.current);
      globalSearchTimerRef.current = null;
    }

    if (!sessionUser || normalizedQuery.length < 2) {
      setIsGlobalSearching(false);
      setGlobalSearchGroups([]);
      return;
    }

    setIsGlobalSearching(true);
    globalSearchTimerRef.current = window.setTimeout(() => {
      void (async () => {
        try {
          const payload = await searchGlobalResources(normalizedQuery, activeProjectId);
          setGlobalSearchGroups(payload.groups);
        } catch (error) {
          if (handleUnauthorizedError(error)) {
            return;
          }

          setGlobalSearchGroups([]);
          setStatusText(error instanceof Error ? error.message : "全局搜索失败");
        } finally {
          setIsGlobalSearching(false);
        }
      })();
    }, 240);

    return () => {
      if (globalSearchTimerRef.current) {
        window.clearTimeout(globalSearchTimerRef.current);
        globalSearchTimerRef.current = null;
      }
    };
  }, [activeProjectId, globalSearchQuery, sessionUser]);

  useEffect(() => {
    if (!activeProjectId) {
      setFileTree([]);
      setActiveFileId(null);
      setActiveFilePath(null);
      setSnapshots([]);
      setProjectPaperLibrary([]);
      setPaperSearchResults([]);
      setPaperSearchSourceStatuses([]);
      setActivePaper(null);
      setActivePaperHighlights([]);
      setPaperAssistantReply(null);
      setProjectComments([]);
      setProjectMembers([]);
      setProjectInvitations([]);
      setAuditLogs([]);
      setVersionEvents([]);
      setCompileSettings(null);
      setCompileSettingsDraft(null);
      setCollaborators([]);
      setCollaborationStatus("disconnected");
      return;
    }

    void refreshProjectResources(activeProjectId).catch((error) => {
      if (handleUnauthorizedError(error)) {
        return;
      }

      setStatusText(error instanceof Error ? error.message : "加载项目资源失败");
    });
  }, [activeProjectId]);

  useEffect(() => {
    void refreshWorkspaceResources().catch((error) => {
      if (handleUnauthorizedError(error)) {
        return;
      }

      setStatusText(error instanceof Error ? error.message : "加载工作空间资源失败");
    });
  }, [activeWorkspace?.organizationId, activeWorkspace?.teamId, activeWorkspace?.type]);

  useEffect(() => {
    const inviteToken = new URLSearchParams(window.location.search).get("invite");

    if (!inviteToken || !sessionUser) {
      return;
    }

    void handleAcceptInvitation(inviteToken, { fromUrl: true }).catch((error) => {
      setStatusText(error instanceof Error ? error.message : "邀请处理失败");
    });
  }, [sessionUser]);

  async function bootstrap() {
    try {
      const authPayload = await getCurrentUser();

      if (!authPayload.authenticated || !authPayload.user) {
        setSessionUser(null);
        setPersonalWorkspace(null);
        setOrganizationWorkspaces([]);
        setTeamWorkspaces([]);
        setSelectedWorkspaceKey(null);
        setWorkspaceMembers([]);
        setWorkspaceTeams([]);
        setProjects([]);
        setActiveProjectId(null);
        setActiveProjectName("未选择项目");
        setFileTree([]);
        setActiveFileId(null);
        setActiveFilePath(null);
        setAuditLogs([]);
        setVersionEvents([]);
        setProjectComments([]);
        setStatusText("请先登录");
        setAuthReady(true);
        return;
      }

      const [workspacePayload, projectPayload] = await Promise.all([getWorkspaces(), listProjects()]);
      setSessionUser(decorateSessionUser(projectPayload.user));
      setPersonalWorkspace(workspacePayload.personal);
      setOrganizationWorkspaces(workspacePayload.organizations);
      setTeamWorkspaces(workspacePayload.teams);
      setSelectedWorkspaceKey(getWorkspaceKey(workspacePayload.personal));
      setProjects(projectPayload.projects);

      if (projectPayload.projects.length > 0) {
        const firstProject = projectPayload.projects[0];
        setActiveProjectId(firstProject?.id ?? null);
        setActiveProjectName(firstProject?.name ?? "未选择项目");
        resetAssistantConversation(firstProject?.name ?? "未选择项目");
        setAppView((current) =>
          current === "templates" || current === "search" || current === "user-space" ? current : "workspace",
        );
      } else {
        setActiveProjectId(null);
        setActiveProjectName("未选择项目");
        setActiveFileId(null);
        setActiveFilePath(null);
        resetAssistantConversation("未选择项目");
        setAppView((current) => (current === "user-space" ? current : "templates"));
      }
      setStatusText("同步完成");
    } catch (error) {
      if (handleUnauthorizedError(error)) {
        return;
      }

      setStatusText(error instanceof Error ? error.message : "初始化失败");
    } finally {
      setAuthReady(true);
    }
  }

  async function refreshWorkspaceCatalog() {
    const payload = await getWorkspaces();
    setPersonalWorkspace(payload.personal);
    setOrganizationWorkspaces(payload.organizations);
    setTeamWorkspaces(payload.teams);
    setSelectedWorkspaceKey((current) => current ?? getWorkspaceKey(payload.personal));
  }

  async function refreshTemplateCatalog() {
    setIsTemplateCatalogLoading(true);

    try {
      const payload = await listTemplates();
      const nextTemplateId =
        selectedTemplateId && payload.templates.some((template) => template.id === selectedTemplateId)
          ? selectedTemplateId
          : null;
      setTemplateCatalog(payload.templates);
      setSelectedTemplateId(nextTemplateId);
      setSelectedTemplate((detail) => (detail?.id === nextTemplateId ? detail : null));
    } finally {
      setIsTemplateCatalogLoading(false);
    }
  }

  async function loadTemplateDetail(templateId: string) {
    const payload = await getTemplateDetail(templateId);
    setSelectedTemplate(payload.template);
  }

  async function refreshWorkspaceResources(workspace?: WorkspaceSummary | null) {
    const targetWorkspace = workspace ?? activeWorkspace;

    if (!targetWorkspace || targetWorkspace.type === "personal") {
      setWorkspaceMembers([]);
      setWorkspaceTeams([]);
      return;
    }

    if (targetWorkspace.type === "organization" && targetWorkspace.organizationId) {
      const [memberPayload, teamPayload] = await Promise.all([
        listOrganizationMembers(targetWorkspace.organizationId),
        listOrganizationTeams(targetWorkspace.organizationId),
      ]);
      setWorkspaceMembers(memberPayload.members);
      setWorkspaceTeams(teamPayload.teams);
      return;
    }

    if (targetWorkspace.type === "team" && targetWorkspace.teamId) {
      const memberPayload = await listTeamMembers(targetWorkspace.teamId);
      setWorkspaceMembers(memberPayload.members);
      setWorkspaceTeams([]);
      return;
    }

    setWorkspaceMembers([]);
    setWorkspaceTeams([]);
  }

  function resetAssistantConversation(projectName: string) {
    startTransition(() => {
      setAssistantMessages([createAssistantIntro(projectName)]);
      setAssistantSuggestions([
        "解释一下当前文件的结构",
        "结合最近一次编译日志，告诉我错误怎么修",
        "给我一个可以直接插入的 LaTeX 示例",
      ]);
      setCompileDiagnosis(null);
    });
  }

  function appendAssistantReplyToUI(userMessage: string, reply: { answer: string; suggestions?: string[] }) {
    setAssistantMessages((messages) => [
      ...messages,
      { role: "user", content: userMessage },
      { role: "assistant", content: reply.answer },
    ]);
    if (reply.suggestions?.length) {
      setAssistantSuggestions(reply.suggestions);
    }
    setRightTab("assistant");
  }

  function handleUnauthorizedError(error: unknown) {
    if (!(error instanceof ApiRequestError) || error.statusCode !== 401) {
      return false;
    }

    stopCompilePolling();
    setSessionUser(null);
    setPersonalWorkspace(null);
    setOrganizationWorkspaces([]);
    setTeamWorkspaces([]);
    setSelectedWorkspaceKey(null);
    setWorkspaceMembers([]);
    setWorkspaceTeams([]);
    setProjects([]);
    setActiveProjectId(null);
    setActiveFileId(null);
    setActiveFilePath(null);
    setStatusText("登录已失效，请重新登录");
    setAuthReady(true);
    return true;
  }

  function handleOpenUserSpace() {
    if (appView !== "user-space") {
      setLastPrimaryAppView(appView);
    }

    setAppView("user-space");
    setStatusText("已打开用户空间");
  }

  function handleReturnFromUserSpace() {
    setAppView(lastPrimaryAppView ?? "workspace");
  }

  async function refreshProjects(nextActiveProjectId?: string | null, options: { preserveAppView?: boolean } = {}) {
    const [workspacePayload, payload] = await Promise.all([getWorkspaces(), listProjects()]);
    setSessionUser(decorateSessionUser(payload.user));
    setPersonalWorkspace(workspacePayload.personal);
    setOrganizationWorkspaces(workspacePayload.organizations);
    setTeamWorkspaces(workspacePayload.teams);
    setProjects(payload.projects);

    const targetProjectId = nextActiveProjectId ?? activeProjectId;
    const targetProject = payload.projects.find((project) => project.id === targetProjectId) ?? payload.projects[0] ?? null;

    if (!targetProject) {
      setActiveProjectId(null);
      setActiveProjectName("未选择项目");
      setActiveFileId(null);
      setActiveFilePath(null);
      setEditorValue("");
      setProjectPaperLibrary([]);
      setPaperSearchResults([]);
      setPaperSearchSourceStatuses([]);
      setActivePaper(null);
      setActivePaperHighlights([]);
      setPaperAssistantReply(null);
      setProjectComments([]);
      setProjectMembers([]);
      setProjectInvitations([]);
      setAuditLogs([]);
      setVersionEvents([]);
      setCompileSettings(null);
      setCompileSettingsDraft(null);
      setCollaborators([]);
      setCollaborationStatus("disconnected");
      resetAssistantConversation("未选择项目");
      if (!options.preserveAppView) {
        setAppView("templates");
      }
      return;
    }

    setActiveProjectId(targetProject.id);
    setActiveProjectName(targetProject.name);
    if (!options.preserveAppView) {
      setAppView("workspace");
    }
    if (targetProject.workspaceType === "personal" && personalWorkspace) {
      setSelectedWorkspaceKey(getWorkspaceKey(personalWorkspace));
    } else if (targetProject.workspaceType === "organization" && targetProject.organizationId) {
      setSelectedWorkspaceKey(`organization:${targetProject.organizationId}`);
    } else if (targetProject.workspaceType === "team" && targetProject.teamId) {
      setSelectedWorkspaceKey(`team:${targetProject.teamId}`);
    }
    resetAssistantConversation(targetProject.name);
  }

  async function refreshProjectResources(projectId: string) {
    const targetProject = projects.find((project) => project.id === projectId) ?? null;
    const [
      treePayload,
      snapshotPayload,
      commentsPayload,
      membersPayload,
      invitationsPayload,
      paperLibraryPayload,
      conversationPayload,
      settingsPayload,
      auditPayload,
      versionPayload,
    ] =
      await Promise.all([
        getProjectTree(projectId),
        listSnapshots(projectId),
        listProjectComments(projectId),
        listProjectMembers(projectId),
        targetProject?.currentUserRole === "owner"
          ? listProjectInvitations(projectId)
          : Promise.resolve({ invitations: [] }),
        listProjectPaperLibrary(projectId),
        getAssistantConversation(projectId),
        getProjectSettings(projectId),
        listProjectAuditLogs(projectId),
        listProjectVersionEvents(projectId),
      ]);

    setFileTree(treePayload.tree);
    setSnapshots(snapshotPayload.snapshots);
    setProjectComments(commentsPayload.comments);
    setProjectMembers(membersPayload.members);
    setProjectInvitations(invitationsPayload.invitations);
    setProjectPaperLibrary(paperLibraryPayload.papers);
    setCompileSettings(settingsPayload.settings);
    setCompileSettingsDraft(settingsPayload.settings);
    setAuditLogs(auditPayload.logs);
    setVersionEvents(versionPayload.events);
    setAssistantMessages(
      conversationPayload.messages.length > 0
        ? conversationPayload.messages
        : [createAssistantIntro(targetProject?.name ?? activeProjectName)],
    );
  }

  async function loadUserSpaceProjectContext(projectId: string): Promise<UserSpaceProjectContext> {
    if (!projects.some((project) => project.id === projectId)) {
      throw new Error("目标项目不存在或当前不可访问");
    }

    if (
      projectId === activeProjectId &&
      (projectMembers.length > 0 || auditLogs.length > 0 || versionEvents.length > 0)
    ) {
      return {
        members: projectMembers,
        auditLogs,
        versionEvents,
      };
    }

    const [memberPayload, auditPayload, versionPayload] = await Promise.all([
      listProjectMembers(projectId),
      listProjectAuditLogs(projectId),
      listProjectVersionEvents(projectId),
    ]);

    return {
      members: memberPayload.members,
      auditLogs: auditPayload.logs,
      versionEvents: versionPayload.events,
    };
  }

  async function ensurePaperImportedForProject(paperId: string) {
    if (!activeProjectId) {
      throw new Error("请先选择项目");
    }

    const existingRecord = projectPaperLibrary.find((paper) => paper.paperId === paperId) ?? null;

    if (existingRecord) {
      return existingRecord;
    }

    const payload = await importProjectPaper(activeProjectId, {
      paperId,
      bibFilePath: "refs.bib",
    });
    await refreshProjectResources(activeProjectId);
    return payload.paper;
  }

  async function ensurePaperReportForReader(projectId: string, paperId: string) {
    const payload = await ensureProjectPaperReport(projectId, paperId);
    setActivePaperReport(payload.report);
    setActivePaperReportState(payload.state);
    return payload;
  }

  async function refreshPaperReportForReader(projectId: string, paperId: string) {
    const payload = await getProjectPaperReport(projectId, paperId);
    setActivePaperReport(payload.report);
    setActivePaperReportState(payload.state);
    return payload;
  }

  async function refreshPaperNotesForReader(projectId: string, paperId: string) {
    const payload = await listProjectPaperNotes(projectId, paperId);
    setActivePaperNotes(payload.notes);
    return payload;
  }

  async function appendProjectNoteFile(projectId: string, filePath: string, content: string) {
    let existingContent = "";

    try {
      const payload = await readProjectFile(projectId, filePath);
      existingContent = payload.content;
    } catch {
      existingContent = "";
    }

    const nextContent = [existingContent.trim(), content.trim()].filter(Boolean).join("\n\n") + "\n";

    try {
      await updateProjectFile(projectId, filePath, nextContent);
    } catch {
      await createProjectFile(projectId, filePath);
      await updateProjectFile(projectId, filePath, nextContent);
    }
  }

  async function handleSelectProject(project: ProjectSummary) {
    stopCompilePolling();
    setAppView("workspace");
    if (project.workspaceType === "personal" && personalWorkspace) {
      setSelectedWorkspaceKey(getWorkspaceKey(personalWorkspace));
    } else if (project.workspaceType === "organization" && project.organizationId) {
      setSelectedWorkspaceKey(`organization:${project.organizationId}`);
    } else if (project.workspaceType === "team" && project.teamId) {
      setSelectedWorkspaceKey(`team:${project.teamId}`);
    }
    setActiveProjectId(project.id);
    setActiveProjectName(project.name);
    setActiveFileId(null);
    setActiveFilePath(null);
    setEditorValue("");
    setProjectPaperLibrary([]);
    setPaperSearchResults([]);
    setPaperSearchSourceStatuses([]);
    setActivePaper(null);
    setActivePaperHighlights([]);
    setActivePaperReport(null);
    setActivePaperReportState(null);
    setActivePaperNotes([]);
    setPaperAssistantReply(null);
    setProjectMembers([]);
    setProjectInvitations([]);
    setProjectComments([]);
    setAuditLogs([]);
    setVersionEvents([]);
    setCompileSettings(null);
    setCompileSettingsDraft(null);
    setCollaborators([]);
    setCollaborationStatus("disconnected");
    setCompileLog("尚未触发编译");
    setActiveCompileJob(null);
    setPdfPreviewUrl(null);
    setCompileDiagnosis(null);
    resetAssistantConversation(project.name);
    setStatusText(`已切换到项目 ${project.name}`);
  }

  async function handleOpenFile(fileNode: FileNode) {
    if (!activeProjectId) {
      return;
    }

    const payload = await readProjectFile(activeProjectId, fileNode.path);
    setCollaborators([]);
    setCollaborationStatus(isTextFile(payload.path) ? "connecting" : "disconnected");
    setActiveFileId(payload.id ?? fileNode.id);
    setActiveFilePath(payload.path);
    setEditorValue(payload.content);
    setStatusText(`已打开 ${payload.path}`);
  }

  async function openProjectFilePath(projectId: string, filePath: string, fallbackFileId?: string | null) {
    const payload = await readProjectFile(projectId, filePath);
    setAppView("workspace");
    setCollaborators([]);
    setCollaborationStatus(isTextFile(payload.path) ? "connecting" : "disconnected");
    setActiveProjectId(projectId);
    setActiveFileId(payload.id ?? fallbackFileId ?? null);
    setActiveFilePath(payload.path);
    setEditorValue(payload.content);
    setStatusText(`已打开 ${payload.path}`);
  }

  async function handleSaveFile() {
    if (!activeProjectId || !activeFilePath) {
      window.alert("请先打开一个文本文件");
      return;
    }

    setStatusText("保存中...");
    await updateProjectFile(activeProjectId, activeFilePath, editorValue);
    await Promise.all([refreshProjects(activeProjectId), refreshProjectResources(activeProjectId)]);
    setStatusText("保存完成");
  }

  async function handleSaveCompileSettings({ silent = false } = {}) {
    if (!activeProjectId || !compileSettingsDraft) {
      return;
    }

    setStatusText("正在保存编译设置...");
    const payload = await updateProjectSettings(activeProjectId, compileSettingsDraft);
    setCompileSettings(payload.settings);
    setCompileSettingsDraft(payload.settings);
    await refreshProjects(activeProjectId);

    if (!silent) {
      setRightTab("logs");
      setStatusText("编译设置已更新");
    }
  }

  async function handleCreateProject() {
    if (!activeWorkspace) {
      window.alert("当前没有可用工作空间");
      return;
    }

    const name = window.prompt("请输入项目名");

    if (!name) {
      return;
    }

    const payload =
      activeWorkspace.type === "personal"
        ? await createProject(name)
        : await createProjectInWorkspace({
            name,
            workspaceType: activeWorkspace.type,
            organizationId: activeWorkspace.organizationId,
            teamId: activeWorkspace.teamId,
          });
    await refreshProjects(payload.project.id);
    await handleSelectProject(payload.project);
    setAppView("workspace");
    setStatusText(`已创建项目 ${payload.project.name}`);
  }

  async function handleCreateProjectFromTemplate(template: ProjectTemplateSummary | ProjectTemplateDetail) {
    if (template.availability === "external") {
      if (template.sourceUrl) {
        window.open(template.sourceUrl, "_blank", "noopener,noreferrer");
      }
      setStatusText(`当前模板为外部官方资源，已打开来源页面：${template.title}`);
      return;
    }

    if (!activeWorkspace) {
      window.alert("当前没有可用工作空间");
      return;
    }

    const name = window.prompt("请输入新项目名", `${template.title} - 副本`);

    if (!name?.trim()) {
      return;
    }

    setIsTemplateCreating(true);
    setStatusText("正在根据模板创建项目...");

    try {
      const payload = await createProjectFromTemplate(template.id, {
        name: name.trim(),
        workspaceType: activeWorkspace.type,
        organizationId: activeWorkspace.organizationId,
        teamId: activeWorkspace.teamId,
      });
      await refreshProjects(payload.project.id);
      await handleSelectProject(payload.project);
      setAppView("workspace");
      setStatusText(`已从模板「${payload.template.title}」创建项目`);
    } finally {
      setIsTemplateCreating(false);
    }
  }

  async function handleCreateOrganizationWorkspace() {
    const name = window.prompt("请输入组织名称");

    if (!name) {
      return;
    }

    await createOrganizationWorkspace(name);
    await refreshWorkspaceCatalog();
    setStatusText(`组织 ${name} 已创建`);
  }

  async function handleCreateTeamWorkspace() {
    const organizationId =
      activeWorkspace?.type === "organization" ? activeWorkspace.organizationId : activeWorkspace?.organizationId;

    if (!organizationId) {
      window.alert("请先选择一个组织空间，再创建团队");
      return;
    }

    const name = window.prompt("请输入团队名称");

    if (!name) {
      return;
    }

    await createTeamWorkspace(organizationId, { name });
    await Promise.all([refreshWorkspaceCatalog(), refreshWorkspaceResources(activeWorkspace)]);
    setStatusText(`团队 ${name} 已创建`);
  }

  async function handleAddOrganizationMember() {
    if (!activeWorkspace?.organizationId) {
      window.alert("请先选择组织空间");
      return;
    }

    const email = window.prompt("请输入要加入组织的用户邮箱");

    if (!email) {
      return;
    }

    await addOrganizationMemberByEmail(activeWorkspace.organizationId, {
      email,
      role: "member",
    });
    await refreshWorkspaceResources(activeWorkspace);
    setStatusText("组织成员已添加");
  }

  async function handleAddTeamMember() {
    if (!activeWorkspace?.teamId) {
      window.alert("请先选择团队空间");
      return;
    }

    const email = window.prompt("请输入要加入团队的用户邮箱");

    if (!email) {
      return;
    }

    await addTeamMemberByEmail(activeWorkspace.teamId, {
      email,
      role: "member",
    });
    await refreshWorkspaceResources(activeWorkspace);
    setStatusText("团队成员已添加");
  }

  async function handleRenameProject(
    targetProject: ProjectSummary | null = activeProject,
    options: { preserveAppView?: boolean } = {},
  ) {
    if (!targetProject) {
      window.alert("请先选择项目");
      return;
    }

    const name = window.prompt("请输入新的项目名", targetProject.name);

    if (!name?.trim()) {
      return;
    }

    await renameProject(targetProject.id, name.trim());
    await refreshProjects(activeProjectId ?? targetProject.id, {
      ...(options.preserveAppView !== undefined ? { preserveAppView: options.preserveAppView } : {}),
    });
    setStatusText("项目已重命名");
  }

  async function handleDeleteProject(
    targetProject: ProjectSummary | null = activeProject,
    options: { preserveAppView?: boolean } = {},
  ) {
    if (!targetProject) {
      window.alert("请先选择项目");
      return;
    }

    if (!window.confirm(`确定删除项目「${targetProject.name}」吗？`)) {
      return;
    }

    const deletingActiveProject = targetProject.id === activeProjectId;

    await deleteProject(targetProject.id);

    if (deletingActiveProject) {
      stopCompilePolling();
      setProjectMembers([]);
      setProjectInvitations([]);
      setProjectComments([]);
      setAuditLogs([]);
      setVersionEvents([]);
      setCompileSettings(null);
      setCompileSettingsDraft(null);
      setCompileLog("尚未触发编译");
      setActiveCompileJob(null);
      setPdfPreviewUrl(null);
      setCompileDiagnosis(null);
    }

    await refreshProjects(deletingActiveProject ? null : activeProjectId, {
      ...(options.preserveAppView !== undefined ? { preserveAppView: options.preserveAppView } : {}),
    });
    setStatusText("项目已删除");
  }

  async function handleCreateFile() {
    if (!activeProjectId) {
      window.alert("请先选择项目");
      return;
    }

    const filePath = window.prompt("请输入新文件路径，例如 sections/intro.tex");

    if (!filePath) {
      return;
    }

    const payload = await createProjectFile(activeProjectId, filePath);
    await refreshProjectResources(activeProjectId);
    setCollaborators([]);
    setCollaborationStatus(isTextFile(filePath) ? "connecting" : "disconnected");
    setActiveFileId(payload.file.id);
    setActiveFilePath(filePath);
    setEditorValue("");
    setStatusText(`已创建文件 ${filePath}`);
  }

  async function handleCreateDirectory() {
    if (!activeProjectId) {
      window.alert("请先选择项目");
      return;
    }

    const directoryPath = window.prompt("请输入新目录路径，例如 figures");

    if (!directoryPath) {
      return;
    }

    await createProjectDirectory(activeProjectId, directoryPath);
    await refreshProjectResources(activeProjectId);
    setStatusText(`已创建目录 ${directoryPath}`);
  }

  async function handleMoveEntry() {
    if (!activeProjectId) {
      window.alert("请先选择项目");
      return;
    }

    const fromPath = window.prompt("请输入源路径", activeFilePath ?? "");

    if (!fromPath) {
      return;
    }

    const toPath = window.prompt("请输入目标路径");

    if (!toPath) {
      return;
    }

    await moveProjectEntry(activeProjectId, fromPath, toPath);

    if (activeFilePath === fromPath) {
      setCollaborators([]);
      setCollaborationStatus(isTextFile(toPath) ? "connecting" : "disconnected");
      setActiveFilePath(toPath);
    }

    await refreshProjectResources(activeProjectId);
    setStatusText("路径移动完成");
  }

  async function handleDeleteEntry() {
    if (!activeProjectId) {
      window.alert("请先选择项目");
      return;
    }

    const entryPath = window.prompt("请输入要删除的路径", activeFilePath ?? "");

    if (!entryPath) {
      return;
    }

    if (!window.confirm(`确定删除 ${entryPath} 吗？`)) {
      return;
    }

    await deleteProjectEntry(activeProjectId, entryPath);

    if (entryPath === activeFilePath) {
      setActiveFileId(null);
      setActiveFilePath(null);
      setEditorValue("");
      setCollaborators([]);
      setCollaborationStatus("disconnected");
    }

    await refreshProjectResources(activeProjectId);
    setStatusText("路径已删除");
  }

  function stopCompilePolling() {
    if (!compilePollTimerRef.current) {
      return;
    }

    window.clearInterval(compilePollTimerRef.current);
    compilePollTimerRef.current = null;
  }

  async function pollCompileStatus(jobId: string) {
    const payload = await getCompileJob(jobId);
    setActiveCompileJob(payload.job);
    setCompileLog(payload.job.log || "编译中...");

    if (payload.job.status === "succeeded") {
      stopCompilePolling();
      setStatusText("编译成功");
      setPdfPreviewUrl(
        payload.job.pdfUrl ? appendCurrentUserQuery(`${payload.job.pdfUrl}?v=${payload.job.updatedAt}`) : null,
      );
      if (payload.job.pdfUrl) {
        setRightTab("pdf");
      }
      setCompileDiagnosis(null);
      await refreshProjectResources(payload.job.projectId);
      return;
    }

    if (payload.job.status === "failed") {
      stopCompilePolling();
      setStatusText("编译失败");
      setPdfPreviewUrl(null);
      setCompileDiagnosis(null);
      await refreshProjectResources(payload.job.projectId);
    }
  }

  async function handleCompileProject() {
    if (!activeProjectId) {
      window.alert("请先选择项目");
      return;
    }

    if (!compileSettingsDraft) {
      window.alert("当前项目编译设置尚未加载完成");
      return;
    }

    if (activeFilePath && isTextFile(activeFilePath)) {
      await updateProjectFile(activeProjectId, activeFilePath, editorValue);
    }

    if (hasUnsavedCompileSettings) {
      await handleSaveCompileSettings({ silent: true });
    }

    setRightTab("logs");
    setCompileLog("编译任务已提交，等待 Worker 处理...");
    setStatusText("编译排队中...");
    setPdfPreviewUrl(null);
    setCompileDiagnosis(null);
    const payload = await compileProject(activeProjectId);
    setActiveCompileJob(payload.job);
    stopCompilePolling();
    compilePollTimerRef.current = window.setInterval(() => {
      void pollCompileStatus(payload.job.id);
    }, 1200);
    await pollCompileStatus(payload.job.id);
  }

  async function handleRestoreSnapshot(snapshotId: string) {
    if (!activeProjectId) {
      return;
    }

    if (!window.confirm("恢复快照会覆盖当前项目内容，系统会先创建保护性快照。是否继续？")) {
      return;
    }

    setStatusText("正在恢复快照...");
    await restoreSnapshot(activeProjectId, snapshotId);
    setActiveFileId(null);
    setActiveFilePath(null);
    setEditorValue("");
    setProjectPaperLibrary([]);
    setPaperSearchResults([]);
    setPaperSearchSourceStatuses([]);
    setActivePaper(null);
    setActivePaperHighlights([]);
    setPaperAssistantReply(null);
    setProjectMembers([]);
    setProjectInvitations([]);
    setProjectComments([]);
    setAuditLogs([]);
    setVersionEvents([]);
    setCompileSettings(null);
    setCompileSettingsDraft(null);
    setCollaborators([]);
    setCollaborationStatus("disconnected");
    setCompileLog("尚未触发编译");
    setActiveCompileJob(null);
    setPdfPreviewUrl(null);
    setCompileDiagnosis(null);
    await Promise.all([refreshProjects(activeProjectId), refreshProjectResources(activeProjectId)]);
    setRightTab("snapshots");
    setStatusText("快照恢复完成");
  }

  async function handleSendAssistantMessage() {
    if (!activeProjectId) {
      window.alert("请先选择项目");
      return;
    }

    if (isAssistantStreaming) {
      return;
    }

    const message = assistantInput.trim();

    if (!message) {
      return;
    }

    const selectedText = editorRef.current?.getSelectionText() ?? "";
    const nextHistory = [...assistantMessages, { role: "user", content: message } as AssistantMessage];
    setAssistantMessages([
      ...nextHistory,
      { role: "assistant", content: assistantStreamingPlaceholder },
    ]);
    setAssistantInput("");
    setRightTab("assistant");
    setStatusText("AI 正在分析当前上下文...");
    setIsAssistantStreaming(true);

    try {
      await streamAssistantChat(activeProjectId, {
        message,
        currentFilePath: activeFilePath,
        currentFileContent: editorValue,
        selectedText,
        history: nextHistory.slice(-8),
      }, {
        onDelta(delta) {
          setAssistantMessages((messages) => {
            const nextMessages = [...messages];
            const lastMessage = nextMessages.at(-1);

            if (!lastMessage || lastMessage.role !== "assistant") {
              nextMessages.push({ role: "assistant", content: delta });
              return nextMessages;
            }

            nextMessages[nextMessages.length - 1] = {
              ...lastMessage,
              content:
                lastMessage.content === assistantStreamingPlaceholder
                  ? delta
                  : `${lastMessage.content}${delta}`,
            };
            return nextMessages;
          });
        },
        onDone(reply) {
          setAssistantMessages((messages) => {
            const nextMessages = [...messages];
            const lastMessage = nextMessages.at(-1);

            if (!lastMessage || lastMessage.role !== "assistant") {
              nextMessages.push({ role: "assistant", content: reply.answer });
              return nextMessages;
            }

            nextMessages[nextMessages.length - 1] = {
              ...lastMessage,
              content: reply.answer,
            };
            return nextMessages;
          });
          setAssistantSuggestions(reply.suggestions ?? []);
          setStatusText(reply.source === "local_fallback" ? "AI 已返回本地兜底建议" : "AI 回复已生成");
        },
      });
    } catch (error) {
      setAssistantMessages((messages) => [
        ...messages.filter((message, index) => index < messages.length - 1 || message.content.trim()),
        {
          role: "assistant",
          content: `AI 请求失败：${error instanceof Error ? error.message : String(error)}`,
        },
      ]);
      setStatusText("AI 请求失败");
    } finally {
      setIsAssistantStreaming(false);
    }
  }

  async function handleSearchProjectPapers(query: string, sources: string[] = defaultPaperSources) {
    if (!activeProjectId) {
      window.alert("请先选择项目");
      return;
    }

    const normalizedQuery = query.trim();

    if (!normalizedQuery) {
      window.alert("请输入检索词");
      return;
    }

    setIsPaperSearching(true);
    setStatusText("正在检索论文...");

    try {
      const payload = await searchProjectPapers(activeProjectId, {
        query: normalizedQuery,
        limit: defaultPaperSearchLimit,
        sources,
      });
      setPaperSearchResults(payload.results);
      setPaperSearchSourceStatuses(payload.sourceStatuses ?? []);
      setPaperAssistantReply(null);
      setAppView("search");
      const degradedCount = (payload.sourceStatuses ?? []).filter((status) => !status.ok).length;
      setStatusText(
        degradedCount > 0
          ? `已返回 ${payload.results.length} 篇候选论文，${degradedCount} 个来源本次已降级`
          : `已返回 ${payload.results.length} 篇候选论文`,
      );
    } finally {
      setIsPaperSearching(false);
    }
  }

  async function handleOpenPaper(paperId: string) {
    if (!activeProjectId) {
      window.alert("请先选择项目");
      return;
    }

    setIsPaperLoading(true);
    setStatusText("正在加载论文内容...");
    setActivePaperReport(null);
    setActivePaperReportState(null);
    setActivePaperNotes([]);

    try {
      const payload = await getProjectPaper(activeProjectId, paperId, 18000);
      const [highlightsPayload] = await Promise.all([
        listProjectPaperHighlights(activeProjectId, payload.paper.paperId),
        ensurePaperReportForReader(activeProjectId, payload.paper.paperId),
        refreshPaperNotesForReader(activeProjectId, payload.paper.paperId),
      ]);
      setActivePaper(payload.paper);
      setActivePaperHighlights(highlightsPayload.highlights);
      setPaperAssistantReply(null);
      setAppView("paper-reader");
      setStatusText("论文内容已加载");
    } catch (error) {
      const message = error instanceof Error ? error.message : "论文内容获取失败";
      window.alert(message);
      setStatusText(message);
    } finally {
      setIsPaperLoading(false);
    }
  }

  async function handleImportPaper(paperId: string) {
    if (!activeProjectId) {
      window.alert("请先选择项目");
      return;
    }

    setIsPaperImporting(true);
    setStatusText("正在导入论文引用...");

    try {
      const record = await ensurePaperImportedForProject(paperId);
      setStatusText(`已导入 ${record.bibtexKey} 到 ${record.bibFilePath}`);
    } finally {
      setIsPaperImporting(false);
    }
  }

  async function handleAskPaperAssistant(message: string, selectedPaperIds: string[] = []) {
    if (!activeProjectId) {
      window.alert("请先选择项目");
      return null;
    }

    const normalizedMessage = message.trim();

    if (!normalizedMessage) {
      return null;
    }

    setIsPaperAssistantLoading(true);
    setStatusText("研究助手正在分析论文上下文...");

    try {
      const payload = await askProjectPaperAssistant(activeProjectId, {
        message: normalizedMessage,
        selectedPaperIds,
        sources: defaultPaperAssistantSources,
      });
      setPaperAssistantReply(payload.reply);
      setStatusText(
        payload.reply.source === "local_fallback" ? "研究助手返回了本地兜底提示" : "研究助手已生成回复",
      );
      return payload.reply;
    } finally {
      setIsPaperAssistantLoading(false);
    }
  }

  async function handleAskSelectionPaperAssistant(selectionText: string, followUp?: string) {
    if (!activePaper) {
      return null;
    }

    const prompt = followUp?.trim()
      ? [
          `请继续基于当前论文《${activePaper.title}》和下面这段原文回答追问。`,
          "",
          `原文片段：${selectionText}`,
          "",
          `追问：${followUp.trim()}`,
        ].join("\n")
      : [
          `请解释当前论文《${activePaper.title}》中的下面这段内容，说明它在论文方法、实验或论证中的作用。`,
          "",
          `原文片段：${selectionText}`,
        ].join("\n");

    return handleAskPaperAssistant(prompt, [activePaper.paperId]);
  }

  async function handleAskActivePaperAssistant(message: string) {
    if (!activePaper) {
      return null;
    }
    return handleAskPaperAssistant(message, [activePaper.paperId]);
  }

  async function handleRegenerateActivePaperReport() {
    if (!activeProjectId || !activePaper) {
      window.alert("请先打开一篇论文");
      return;
    }

    setIsPaperReportRegenerating(true);
    setStatusText("正在重算论文报告...");
    try {
      const payload = await regenerateProjectPaperReport(activeProjectId, activePaper.paperId);
      setActivePaperReport(payload.report);
      setActivePaperReportState(payload.state);
      setStatusText("论文报告已进入重算队列");
    } finally {
      setIsPaperReportRegenerating(false);
    }
  }

  async function handleInsertPaperCitation() {
    if (!activeProjectId || !activePaper) {
      window.alert("请先打开一篇论文");
      return;
    }

    if (!activeFilePath || !isTextFile(activeFilePath)) {
      window.alert("请先打开一个可编辑的文本文件，再插入引用");
      return;
    }

    const record = await ensurePaperImportedForProject(activePaper.paperId);
    editorRef.current?.insertTextAtSelection(formatPaperCitationSnippet(record.bibtexKey, activeFilePath));
    setStatusText(`已插入 \\cite{${record.bibtexKey}}，记得保存当前文件`);
  }

  async function handleInsertPaperSummary() {
    if (!activeProjectId || !activePaper) {
      window.alert("请先打开一篇论文");
      return;
    }

    if (!activeFilePath || !isTextFile(activeFilePath)) {
      window.alert("请先打开一个可编辑的文本文件，再插入总结");
      return;
    }

    const record = await ensurePaperImportedForProject(activePaper.paperId);
    const summarySource = paperAssistantReply?.answer?.trim() || activePaper.summary;
    const snippet = formatPaperSummarySnippet({
      paper: activePaper,
      citeKey: record.bibtexKey,
      summaryText: summarySource,
      targetFilePath: activeFilePath,
    });

    editorRef.current?.insertTextAtSelection(snippet);
    setStatusText(`已把论文总结插入 ${activeFilePath}，记得保存当前文件`);
  }

  async function handleSavePaperReadingNote() {
    if (!activeProjectId || !activePaper) {
      window.alert("请先打开一篇论文");
      return;
    }

    const record = await ensurePaperImportedForProject(activePaper.paperId);
    const noteFilePath = "notes/reading-notes.md";
    const noteContent = buildReadingNoteContent({
      paper: activePaper,
      citeKey: record.bibtexKey,
      assistantReply: paperAssistantReply,
    });

    await appendProjectNoteFile(activeProjectId, noteFilePath, noteContent);
    await refreshProjectResources(activeProjectId);
    setStatusText(`已将阅读笔记写入 ${noteFilePath}`);
  }

  async function handleCreatePaperNote(payload: {
    title: string;
    text: string;
    anchorId?: string | null;
    pageNumber?: number | null;
    contextText?: string | null;
  }) {
    if (!activeProjectId || !activePaper) {
      return;
    }
    const response = await createProjectPaperNote(activeProjectId, activePaper.paperId, payload);
    setActivePaperNotes((current) => [response.note, ...current]);
    setStatusText("论文笔记已保存");
  }

  async function handleUpdatePaperNote(
    note: PaperNote,
    patch: {
      title?: string;
      text?: string;
      anchorId?: string | null;
      pageNumber?: number | null;
      contextText?: string | null;
    },
  ) {
    if (!activeProjectId || !activePaper) {
      return;
    }
    const response = await updateProjectPaperNote(activeProjectId, activePaper.paperId, note.id, patch);
    setActivePaperNotes((current) =>
      current.map((item) => (item.id === note.id ? response.note : item)),
    );
    setStatusText("论文笔记已更新");
  }

  async function handleDeletePaperNote(note: PaperNote) {
    if (!activeProjectId || !activePaper) {
      return;
    }
    const confirmed = window.confirm("确定要删除这条论文笔记吗？");
    if (!confirmed) {
      return;
    }
    await deleteProjectPaperNote(activeProjectId, activePaper.paperId, note.id);
    setActivePaperNotes((current) => current.filter((item) => item.id !== note.id));
    setStatusText("论文笔记已删除");
  }

  async function handleCreatePaperHighlight(payload: {
    kind: "highlight" | "comment";
    content: { text: string; image?: string };
    comment: { text: string; emoji: string };
    position: {
      boundingRect: Record<string, number>;
      rects: Array<Record<string, number>>;
      pageNumber: number;
      usePdfCoordinates?: boolean;
    };
  }) {
    if (!activeProjectId || !activePaper) {
      return;
    }

    const response = await createProjectPaperHighlight(activeProjectId, activePaper.paperId, payload);
    setActivePaperHighlights((current) => [...current, response.highlight]);
    setStatusText(payload.kind === "comment" ? "论文评论已保存" : "论文高亮已保存");
  }

  async function handleInsertPaperHighlight(highlight: ProjectPaperHighlight) {
    if (!activePaper) {
      return;
    }

    if (!activeFilePath || !isTextFile(activeFilePath)) {
      window.alert("请先打开一个可编辑的文本文件，再插入摘录");
      return;
    }

    const record = await ensurePaperImportedForProject(activePaper.paperId);
    const snippet = formatPaperHighlightSnippet({
      paper: activePaper,
      highlight,
      citeKey: record.bibtexKey,
      targetFilePath: activeFilePath,
    });
    editorRef.current?.insertTextAtSelection(snippet);
    setStatusText(`已将摘录插入 ${activeFilePath}，记得保存当前文件`);
  }

  async function handleEditPaperHighlight(highlight: ProjectPaperHighlight) {
    if (!activeProjectId || !activePaper) {
      return;
    }

    const nextCommentText = window.prompt("编辑摘录备注", highlight.comment.text) ?? "";

    const payload = await updateProjectPaperHighlight(activeProjectId, activePaper.paperId, highlight.id, {
      comment: {
        text: nextCommentText.trim(),
        emoji: highlight.comment.emoji,
      },
    });
    setActivePaperHighlights((current) =>
      current.map((item) => (item.id === highlight.id ? payload.highlight : item)),
    );
    setStatusText("摘录备注已更新");
  }

  async function handleDeletePaperHighlight(
    highlight: ProjectPaperHighlight,
    options: { skipConfirm?: boolean } = {},
  ) {
    if (!activeProjectId || !activePaper) {
      return;
    }

    if (!options.skipConfirm && !window.confirm("确定删除这条论文摘录吗？")) {
      return;
    }

    await deleteProjectPaperHighlight(activeProjectId, activePaper.paperId, highlight.id);
    setActivePaperHighlights((current) => current.filter((item) => item.id !== highlight.id));
    setStatusText("论文摘录已删除");
  }

  async function handleDiagnoseCompileFailure() {
    if (!activeProjectId) {
      window.alert("请先选择项目");
      return;
    }

    if (!compileLog.trim() || compileLog === "尚未触发编译") {
      window.alert("当前没有可分析的编译日志");
      return;
    }

    setStatusText("AI 正在诊断最近一次编译结果...");
    setRightTab("logs");

    try {
      const payload = await diagnoseCompileFailure(activeProjectId, {
        currentFilePath: activeFilePath,
        currentFileContent: editorValue,
        selectedText: editorRef.current?.getSelectionText() ?? "",
      });
      setCompileDiagnosis(payload.diagnosis);
      setStatusText(
        payload.diagnosis.source === "local_fallback" ? "已生成本地诊断建议" : "AI 诊断结果已生成",
      );
    } catch (error) {
      setStatusText("AI 诊断失败");
      window.alert(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleExplainSelection() {
    if (!activeProjectId) {
      window.alert("请先选择项目");
      return;
    }

    const selectedText = editorRef.current?.getSelectionText() ?? "";

    if (!selectedText.trim() && !activeFilePath) {
      window.alert("请先打开文件或选中要解释的内容");
      return;
    }

    setStatusText("AI 正在解释当前代码...");
    const actionMessage = selectedText.trim() ? "请解释我当前选中的 LaTeX 代码" : "请解释当前文件的核心片段";
    const payload = await explainSelection(activeProjectId, {
      currentFilePath: activeFilePath,
      currentFileContent: editorValue,
      selectedText,
      message: actionMessage,
    });
    appendAssistantReplyToUI(actionMessage, payload.reply);
    setStatusText(payload.reply.source === "local_fallback" ? "已生成本地解释结果" : "AI 解释已生成");
  }

  async function handleImproveSelection() {
    if (!activeProjectId) {
      window.alert("请先选择项目");
      return;
    }

    const selectedText = editorRef.current?.getSelectionText() ?? "";

    if (!selectedText.trim() && !activeFilePath) {
      window.alert("请先打开文件或选中要优化的内容");
      return;
    }

    setStatusText("AI 正在优化当前代码...");
    const actionMessage = selectedText.trim() ? "请优化我当前选中的 LaTeX 代码" : "请优化当前文件的关键片段";
    const payload = await improveSelection(activeProjectId, {
      currentFilePath: activeFilePath,
      currentFileContent: editorValue,
      selectedText,
      recentCompileLog: compileLog,
      message: actionMessage,
    });
    appendAssistantReplyToUI(actionMessage, payload.reply);
    setStatusText(payload.reply.source === "local_fallback" ? "已生成本地优化建议" : "AI 优化结果已生成");
  }

  async function handleGenerateCompileFix() {
    if (!activeProjectId) {
      window.alert("请先选择项目");
      return;
    }

    if (!compileLog.trim() || compileLog === "尚未触发编译") {
      window.alert("当前没有可用于生成修复代码的编译日志");
      return;
    }

    setStatusText("AI 正在生成修复代码...");
    const actionMessage = "请根据最近编译错误生成可直接应用的修复代码";
    const payload = await generateCompileFix(activeProjectId, {
      currentFilePath: activeFilePath,
      currentFileContent: editorValue,
      selectedText: editorRef.current?.getSelectionText() ?? "",
      recentCompileLog: compileLog,
      message: actionMessage,
    });
    appendAssistantReplyToUI(actionMessage, payload.reply);
    setRightTab("assistant");
    setStatusText(payload.reply.source === "local_fallback" ? "已生成本地修复方向" : "AI 修复代码已生成");
  }

  async function handleClearAssistantConversation() {
    if (!activeProjectId) {
      return;
    }

    await clearAssistantConversation(activeProjectId);
    resetAssistantConversation(activeProjectName);
    setStatusText("AI 对话历史已清空");
  }

  function handleInsertAssistantCode(content: string) {
    const codeBlock = extractFirstCodeBlock(content);

    if (!codeBlock) {
      return;
    }

    editorRef.current?.insertTextAtSelection(codeBlock);
    setStatusText("已将 AI 代码片段插入编辑器，记得保存");
  }

  function handleJumpToLine(line: number) {
    editorRef.current?.scrollToLine(line);
  }

  async function handleCreateComment() {
    if (!activeProjectId || !activeFileId || !activeFilePath) {
      window.alert("请先打开一个文件，再添加批注");
      return;
    }

    const selectionInfo = editorRef.current?.getSelectionInfo();

    if (!selectionInfo) {
      window.alert("当前编辑器不可用");
      return;
    }

    const content = window.prompt("请输入批注内容");

    if (!content?.trim()) {
      return;
    }

    const excerpt = selectionInfo.text.trim() || (editorValue.split("\n")[selectionInfo.lineStart - 1] ?? "");
    await createProjectComment(activeProjectId, {
      fileId: activeFileId,
      content: content.trim(),
      excerpt: excerpt.trim(),
      selectionText: selectionInfo.text.trim(),
      lineStart: selectionInfo.lineStart,
      lineEnd: selectionInfo.lineEnd,
      columnStart: selectionInfo.columnStart,
      columnEnd: selectionInfo.columnEnd,
    });
    await refreshProjectResources(activeProjectId);
    setRightTab("comments");
    setStatusText("批注已创建");
  }

  async function handleReplyComment(commentId: string) {
    if (!activeProjectId) {
      return;
    }

    const content = window.prompt("请输入回复内容");

    if (!content?.trim()) {
      return;
    }

    await replyProjectComment(activeProjectId, commentId, content.trim());
    await refreshProjectResources(activeProjectId);
    setStatusText("评论回复已发送");
  }

  async function handleToggleCommentResolved(commentId: string) {
    if (!activeProjectId) {
      return;
    }

    await resolveProjectComment(activeProjectId, commentId);
    await refreshProjectResources(activeProjectId);
    setStatusText("评论状态已更新");
  }

  async function handleOpenCompileDiagnostic(diagnostic: CompileDiagnostic) {
    if (!activeProjectId) {
      return;
    }

    if (diagnostic.file && diagnostic.file !== activeFilePath) {
      const targetNode = findFileNodeByPath(fileTree, diagnostic.file);

      if (targetNode) {
        await handleOpenFile(targetNode);
      }
    }

    const targetLine = diagnostic.line ?? compileDiagnosis?.likelyLine ?? null;

    if (targetLine) {
      window.setTimeout(() => {
        editorRef.current?.scrollToLine(targetLine);
      }, 60);
    }
  }

  async function handleCreateInvitation() {
    if (!activeProjectId) {
      window.alert("请先选择项目");
      return;
    }

    const payload = await createProjectInvitation(activeProjectId);
    const inviteUrl = `${window.location.origin}${payload.invitation.invitePath}`;
    await navigator.clipboard.writeText(inviteUrl).catch(() => undefined);
    await refreshProjectResources(activeProjectId);
    setRightTab("members");
    setStatusText("邀请链接已创建并尝试复制到剪贴板");
  }

  async function handleRevokeInvitation(token: string) {
    if (!activeProjectId) {
      return;
    }

    await revokeProjectInvitation(activeProjectId, token);
    await refreshProjectResources(activeProjectId);
    setStatusText("邀请链接已撤销");
  }

  async function handleRemoveMember(userId: string) {
    if (!activeProjectId) {
      return;
    }

    await removeProjectMember(activeProjectId, userId);
    await refreshProjectResources(activeProjectId);
    await refreshProjects(activeProjectId);
    setStatusText("项目成员已移除");
  }

  async function handleAcceptInvitation(rawToken?: string, { fromUrl = false } = {}) {
    const token =
      rawToken?.trim() ||
      extractInvitationToken(window.prompt("请输入邀请链接或邀请 token") ?? "");

    if (!token) {
      return;
    }

    const preview = await getInvitationPreview(token);

    if (!preview.project) {
      throw new Error("邀请对应的项目不存在");
    }

    const acceptPayload = await acceptProjectInvitation(token);
    await refreshProjects(acceptPayload.project.id);
    await handleSelectProject(acceptPayload.project);

    if (fromUrl) {
      window.history.replaceState({}, "", window.location.pathname);
    }

    setRightTab("members");
    setStatusText(`已加入项目 ${preview.project.name}`);
  }

  async function handleRunGlobalCommand(commandId: string) {
    switch (commandId) {
      case "go-explore":
      case "go-templates":
        setAppView("templates");
        setStatusText("已切换到模板库");
        return;
      case "create-project":
        await handleCreateProject();
        return;
      case "open-paper-search":
      case "open-search":
        setAppView("search");
        setStatusText("已打开论文搜索页");
        return;
      case "compile-project":
        if (!activeProjectId) {
          window.alert("请先选择项目，再执行编译");
          return;
        }
        await handleCompileProject();
        return;
      case "open-assistant":
        setAppView("workspace");
        setRightTab("assistant");
        setStatusText("已打开 AI 助手");
        return;
      case "open-paper-reader":
        if (!activePaper) {
          setAppView("search");
          setStatusText("请先从论文搜索页打开一篇论文");
          return;
        }
        setAppView("paper-reader");
        setStatusText("已打开论文阅读页");
        return;
      default:
        setStatusText("当前命令暂未实现");
    }
  }

  async function handleSelectGlobalSearchItem(item: GlobalSearchItem) {
    setIsGlobalSearchOpen(false);
    setGlobalSearchQuery("");
    setGlobalSearchGroups([]);

    if (item.type === "project" && item.projectId) {
      const targetProject = projects.find((project) => project.id === item.projectId) ?? null;

      if (!targetProject) {
        window.alert("目标项目不存在或当前不可访问");
        return;
      }

      await handleSelectProject(targetProject);
      return;
    }

    if (item.type === "file" && item.projectId && item.filePath) {
      const targetProject = projects.find((project) => project.id === item.projectId) ?? null;

      if (!targetProject) {
        window.alert("目标项目不存在或当前不可访问");
        return;
      }

      await handleSelectProject(targetProject);
      await openProjectFilePath(item.projectId, item.filePath, item.fileId);
      return;
    }

    if ((item.type === "project-paper" || item.type === "external-paper") && item.paperId) {
      const targetProjectId = item.projectId ?? activeProjectId;

      if (!targetProjectId) {
        window.alert("请先选择或创建一个项目，再打开论文阅读");
        return;
      }

      const targetProject = projects.find((project) => project.id === targetProjectId) ?? null;

      if (targetProject) {
        await handleSelectProject(targetProject);
      }

      await handleOpenPaper(item.paperId);
      return;
    }

    if (item.type === "template" && item.templateId) {
      setAppView("templates");
      setSelectedTemplateId(item.templateId);
      setStatusText(`已定位到模板：${item.title}`);
      return;
    }

    if (item.type === "command" && item.commandId) {
      await handleRunGlobalCommand(item.commandId);
    }
  }

  async function handleLogout() {
    await logoutCurrentSession();
    stopCompilePolling();
    setAppView("templates");
    setSessionUser(null);
    setPersonalWorkspace(null);
    setOrganizationWorkspaces([]);
    setTeamWorkspaces([]);
    setSelectedWorkspaceKey(null);
    setWorkspaceMembers([]);
    setWorkspaceTeams([]);
    setTemplateCatalog([]);
    setSelectedTemplateId(null);
    setSelectedTemplate(null);
    setProjects([]);
    setActiveProjectId(null);
    setActiveProjectName("未选择项目");
    setFileTree([]);
    setActiveFileId(null);
    setActiveFilePath(null);
    setEditorValue("");
    setProjectMembers([]);
    setProjectInvitations([]);
    setProjectComments([]);
    setCompileSettings(null);
    setCompileSettingsDraft(null);
    setCollaborators([]);
    setCollaborationStatus("disconnected");
    setGlobalSearchQuery("");
    setGlobalSearchGroups([]);
    setIsGlobalSearchOpen(false);
    setCompileLog("尚未触发编译");
    setActiveCompileJob(null);
    setPdfPreviewUrl(null);
    setCompileDiagnosis(null);
    resetAssistantConversation("未选择项目");
    setStatusText("已退出登录");
  }

  if (!authReady) {
    return <div className="auth-loading">正在验证登录状态...</div>;
  }

  if (!sessionUser) {
    return <AuthScreen onAuthenticated={() => bootstrap()} />;
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-left">
          <div className="brand">
            <div className="brand-mark">K</div>
            <div className="brand-text">
              <strong>考拉论文</strong>
              <small>在线 LaTeX 协作平台</small>
            </div>
          </div>
          <nav className="top-nav">
            <button
              type="button"
              className={`top-nav-item${appView === "templates" ? " top-nav-item-active" : ""}`}
              onClick={() => setAppView("templates")}
            >
              模板库
            </button>
            <button
              type="button"
              className={`top-nav-item${appView === "search" ? " top-nav-item-active" : ""}`}
              onClick={() => setAppView("search")}
            >
              搜索
            </button>
            <button
              type="button"
              className={`top-nav-item${appView === "workspace" ? " top-nav-item-active" : ""}`}
              onClick={() => setAppView("workspace")}
            >
              写作工作台
            </button>
            {activePaper || appView === "paper-reader" ? (
              <button
                type="button"
                className={`top-nav-item${appView === "paper-reader" ? " top-nav-item-active" : ""}`}
                onClick={() => setAppView("paper-reader")}
              >
                论文阅读
              </button>
            ) : null}
          </nav>
        </div>

        <div className="topbar-center">
          <div ref={globalSearchRef} className="global-search-shell">
            <label className="global-search">
              <span>⌕</span>
              <input
                type="text"
                value={globalSearchQuery}
                placeholder="搜索论文、项目、模板或命令..."
                onFocus={() => setIsGlobalSearchOpen(true)}
                onChange={(event) => {
                  setGlobalSearchQuery(event.target.value);
                  setIsGlobalSearchOpen(true);
                }}
              />
            </label>
            {isGlobalSearchOpen ? (
              <GlobalSearchDropdown
                query={globalSearchQuery}
                loading={isGlobalSearching}
                groups={globalSearchGroups}
                onSelect={(item) => void handleSelectGlobalSearchItem(item)}
              />
            ) : null}
          </div>
        </div>

        <div className="topbar-right">
          <button
            type="button"
            className={`user-chip${appView === "user-space" ? " user-chip-active" : ""}`}
            onClick={handleOpenUserSpace}
          >
            <strong>{sessionUser.name}</strong>
            <small>{sessionUser.email ?? "已登录用户"}</small>
          </button>
          <div className="collaborators">
            {visibleCollaborators.length === 0 ? (
              <span className="avatar avatar-amber">协作</span>
            ) : (
              visibleCollaborators.slice(0, 4).map((collaborator) => (
                <span
                  key={`${collaborator.clientId}-${collaborator.user.name}`}
                  className="avatar"
                  style={{ background: collaborator.user.color }}
                  title={`${collaborator.user.name}${collaborator.isLocal ? "（你）" : ""}`}
                >
                  {formatCollaboratorLabel(collaborator.user.name)}
                </span>
              ))
            )}
          </div>
          <button type="button" className="ghost-button" onClick={() => void handleAcceptInvitation()}>
            加入项目
          </button>
          <button type="button" className="ghost-button" onClick={() => void handleLogout()}>
            退出
          </button>
        </div>
      </header>

      {appView === "templates" ? (
        <ExplorePage
          activeWorkspace={activeWorkspace ?? null}
          templates={templateCatalog}
          selectedTemplateId={selectedTemplateId}
          selectedTemplate={selectedTemplate}
          query={templateQuery}
          sourceType={templateSourceType}
          isLoading={isTemplateCatalogLoading}
          isCreating={isTemplateCreating}
          onQueryChange={setTemplateQuery}
          onSourceTypeChange={setTemplateSourceType}
          onSelectTemplate={setSelectedTemplateId}
          onCreateFromTemplate={(template) => void handleCreateProjectFromTemplate(template)}
        />
      ) : appView === "search" ? (
        <PaperSearchPage
          activeProjectName={activeProjectName}
          hasActiveProject={!!activeProjectId}
          results={paperSearchResults}
          sourceStatuses={paperSearchSourceStatuses}
          importedPapers={projectPaperLibrary}
          activePaper={activePaper}
          isSearching={isPaperSearching}
          onSearch={handleSearchProjectPapers}
          onOpenPaper={handleOpenPaper}
          onImportPaper={handleImportPaper}
          onResumeReading={() => setAppView("paper-reader")}
        />
      ) : appView === "user-space" ? (
        <UserSpacePage
          sessionUser={sessionUser}
          projects={projects}
          allWorkspaces={allWorkspaces}
          organizationWorkspaces={organizationWorkspaces}
          teamWorkspaces={teamWorkspaces}
          onBack={handleReturnFromUserSpace}
          onCreateProject={() => void handleCreateProject()}
          onOpenTemplates={() => setAppView("templates")}
          onOpenProject={(project) => void handleSelectProject(project)}
          onRenameProject={(project) => void handleRenameProject(project, { preserveAppView: true })}
          onDeleteProject={(project) => void handleDeleteProject(project, { preserveAppView: true })}
          onLoadProjectContext={loadUserSpaceProjectContext}
        />
      ) : appView === "paper-reader" ? (
        <main className="min-h-[calc(100vh-64px)]">
          {activePaper ? (
            <Suspense fallback={<div className="empty-panel">论文阅读器加载中...</div>}>
              <PaperReaderPanel
                paper={activePaper}
                importedPaper={activeImportedPaper}
                pdfUrl={
                  activeProjectId && activePaper && activePaper.pdfUrl
                    ? appendCurrentUserQuery(
                        `/api/projects/${activeProjectId}/papers/${encodeURIComponent(activePaper.paperId)}/pdf`,
                      )
                    : null
                }
                isLoading={isPaperLoading}
                isImporting={isPaperImporting}
                assistantReply={paperAssistantReply}
                report={activePaperReport}
                reportState={activePaperReportState}
                notes={activePaperNotes}
                isAskingAssistant={isPaperAssistantLoading || isPaperReportRegenerating}
                highlights={activePaperHighlights}
                onBackToSearch={() => setAppView("search")}
                onBackToWorkspace={() => setAppView("workspace")}
                onImportPaper={handleImportPaper}
                onAskAssistant={handleAskActivePaperAssistant}
                onAskSelectionAssistant={handleAskSelectionPaperAssistant}
                onRegenerateReport={handleRegenerateActivePaperReport}
                onInsertCitation={handleInsertPaperCitation}
                onInsertSummary={handleInsertPaperSummary}
                onSaveReadingNote={handleSavePaperReadingNote}
                onCreateNote={handleCreatePaperNote}
                onUpdateNote={handleUpdatePaperNote}
                onDeleteNote={handleDeletePaperNote}
                onCreateHighlight={handleCreatePaperHighlight}
                onDeleteHighlight={(highlight, options) => handleDeletePaperHighlight(highlight, options)}
              />
            </Suspense>
          ) : (
            <div className="empty-panel">先从“搜索”页打开一篇论文，再进入阅读视图。</div>
          )}
        </main>
      ) : (
      <main className="workspace-shell">
        <aside className="left-sidebar">
          <section className="sidebar-section">
            <div className="section-header">
              <h2>工作空间</h2>
              <div className="header-actions">
                <button type="button" className="mini-button" onClick={() => void handleCreateOrganizationWorkspace()}>
                  新建组织
                </button>
                <button type="button" className="mini-button" onClick={() => void handleCreateTeamWorkspace()}>
                  新建团队
                </button>
              </div>
            </div>
            <div className="project-list">
              {allWorkspaces.map((workspace) => (
                <button
                  key={getWorkspaceKey(workspace)}
                  type="button"
                  className={`project-card${
                    getWorkspaceKey(workspace) === selectedWorkspaceKey ? " project-card-active" : ""
                  }`}
                  onClick={() => setSelectedWorkspaceKey(getWorkspaceKey(workspace))}
                >
                  <div className="project-card-name">{workspace.name}</div>
                  <div className="project-card-meta">
                    {workspace.type} · {formatWorkspaceRoleLabel(workspace.currentUserRole)}
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="sidebar-section">
            <div className="section-header">
              <h2>项目</h2>
            </div>
            <div className="project-list">
              {visibleProjects.length === 0 ? <small>当前工作空间还没有项目</small> : null}
              {visibleProjects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  active={project.id === activeProjectId}
                  onSelect={() => void handleSelectProject(project)}
                />
              ))}
            </div>
          </section>

          <section className="sidebar-section">
            <div className="section-header">
              <h2>项目文件</h2>
              <div className="header-actions">
                <button type="button" className="mini-button" onClick={() => void handleCreateFile()}>
                  文件
                </button>
                <button type="button" className="mini-button" onClick={() => void handleCreateDirectory()}>
                  目录
                </button>
              </div>
            </div>
            <div className="file-tree">
              {!activeProjectId ? <small>请先创建或选择项目</small> : null}
              {activeProjectId && fileTree.length === 0 ? <small>项目目录为空</small> : null}
              {fileTree.map((node) => (
                <FileTreeNode
                  key={node.id}
                  node={node}
                  activeFilePath={activeFilePath}
                  onOpenFile={(node) => void handleOpenFile(node)}
                />
              ))}
            </div>
          </section>

          <section className="sidebar-section">
            <div className="section-header">
              <h2>目录大纲</h2>
            </div>
            <div className="toc-list">
              {!isTextFile(activeFilePath) ? <small>打开 `.tex` 文件后自动生成</small> : null}
              {isTextFile(activeFilePath) && outline.length === 0 ? <small>当前文件未解析到 section 标题</small> : null}
              {outline.map((item) => (
                <OutlineButton key={item.id} item={item} onJump={handleJumpToLine} />
              ))}
            </div>
          </section>

          <section className="sidebar-footer">
            <div className="status-card">
              <div className="status-icon">☁</div>
              <div>
                <p>状态</p>
                <strong>{statusText}</strong>
                <p>{collaborationSummary}</p>
              </div>
            </div>
          </section>
        </aside>

        <section className="editor-shell">
          <div className="editor-toolbar">
            <div className="editor-toolbar-left">
              <strong>{activeProjectName}</strong>
              <span>{activeFilePath ?? "未打开文件"}</span>
              <span>{collaborationSummary}</span>
              {compileSettings ? (
                <span>
                  {compileSettings.compileEngine} · {compileSettings.rootFile}
                </span>
              ) : null}
            </div>
            <div className="editor-toolbar-right">
              <button type="button" className="ghost-button" onClick={() => void handleMoveEntry()}>
                移动
              </button>
              <button type="button" className="ghost-button" onClick={() => void handleDeleteEntry()}>
                删除文件
              </button>
              <button type="button" className="ghost-button" onClick={() => void handleSaveFile()}>
                保存
              </button>
              <button type="button" className="accent-button" onClick={() => void handleCompileProject()}>
                编译
              </button>
            </div>
          </div>

          <div className="editor-surface">
            <CodeEditor
              key={`${activeProjectId ?? "no-project"}:${activeFilePath ?? "no-file"}`}
              ref={editorRef}
              value={editorValue}
              readOnly={!activeProjectId || !isTextFile(activeFilePath)}
              onChange={(value) => {
                setEditorValue(value);
                if (collaborationConfig) {
                  setStatusText("实时协作中，变更会自动同步");
                } else if (activeFilePath) {
                  setStatusText("编辑中，尚未保存");
                }
              }}
              {...(collaborationConfig ? { collaboration: collaborationConfig } : {})}
              {...(activeProjectId && activeFilePath && isTextFile(activeFilePath)
                ? {
                    inlineCompletion: {
                      enabled: true,
                      projectId: activeProjectId,
                      currentFilePath: activeFilePath,
                      recentCompileLog: activeCompileJob?.log ?? "",
                    },
                  }
                : {})}
            />
          </div>
        </section>

        <div className="right-panel-content">
          <section className={`tab-panel${rightTab === "pdf" ? " tab-panel-active" : ""}`}>
            <div className="panel-toolbar">
              <span>编译结果预览</span>
            </div>
            {activeCompileJob?.pdfUrl ? (
              <iframe
                title="PDF Preview"
                className="pdf-preview"
                src={pdfPreviewUrl ?? (activeCompileJob.pdfUrl ? appendCurrentUserQuery(activeCompileJob.pdfUrl) : "")}
              />
            ) : (
              <div className="empty-panel">尚未生成 PDF 输出</div>
            )}
          </section>

          <section className={`tab-panel${rightTab === "assistant" ? " tab-panel-active" : ""}`}>
            <div className="panel-toolbar">
              <span>AI 问答助手</span>
              <div className="header-actions">
                <button type="button" className="mini-button" onClick={() => void handleExplainSelection()}>
                  解释选中
                </button>
                <button type="button" className="mini-button" onClick={() => void handleImproveSelection()}>
                  优化选中
                </button>
                <button type="button" className="mini-button" onClick={() => void handleClearAssistantConversation()}>
                  清空对话
                </button>
              </div>
            </div>
            <div className="assistant-shell">
              <div className="assistant-messages">
                {assistantMessages.map((message, index) => {
                  const codeBlock = extractFirstCodeBlock(message.content);

                  return (
                    <div
                      key={`${message.role}-${index}`}
                      className={`assistant-message assistant-message-${message.role}`}
                    >
                      <div className="assistant-bubble">
                        <pre>{message.content}</pre>
                        {message.role === "assistant" && codeBlock ? (
                          <div className="assistant-code-actions">
                            <button
                              type="button"
                              className="mini-button"
                              onClick={() => handleInsertAssistantCode(message.content)}
                            >
                              插入代码
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="assistant-suggestions">
                {assistantSuggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="assistant-suggestion"
                    onClick={() => setAssistantInput(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>

              <div className="assistant-input-shell">
                <textarea
                  className="assistant-input"
                  placeholder="例如：解释一下我选中的这段 LaTeX，或帮我分析最近一次编译报错"
                  value={assistantInput}
                  onChange={(event) => setAssistantInput(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                      event.preventDefault();
                      void handleSendAssistantMessage();
                    }
                  }}
                />
                <div className="assistant-actions">
                  <small>默认带上当前文件、选中文本和最近一次编译日志</small>
                  <button type="button" className="accent-button" onClick={() => void handleSendAssistantMessage()}>
                    发送
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className={`tab-panel${rightTab === "snapshots" ? " tab-panel-active" : ""}`}>
            <div className="panel-toolbar">
              <span>项目快照</span>
              <button
                type="button"
                className="mini-button"
                onClick={() => (activeProjectId ? void refreshProjectResources(activeProjectId) : undefined)}
              >
                刷新
              </button>
            </div>
            <div className="snapshot-list">
              {!activeProjectId ? <small>请选择项目后查看快照</small> : null}
              {activeProjectId && snapshots.length === 0 ? <small>当前项目还没有可用快照</small> : null}
              {snapshots.map((snapshot) => (
                <div key={snapshot.id} className="snapshot-card">
                  <div className="snapshot-card-header">
                    <strong>{snapshot.type}</strong>
                    <small>{formatDate(snapshot.createdAt)}</small>
                  </div>
                  <p>{snapshot.label ?? "Project snapshot"}</p>
                  <div className="snapshot-meta">
                    <small>{snapshot.fileCount} files</small>
                    <button
                      type="button"
                      className="mini-button"
                      onClick={() => void handleRestoreSnapshot(snapshot.id)}
                    >
                      恢复
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className={`tab-panel${rightTab === "logs" ? " tab-panel-active" : ""}`}>
            <div className="panel-toolbar">
              <div className="panel-toolbar-stack">
                <span>编译日志</span>
                <div className="compile-settings-bar">
                  <label className="compile-setting-field">
                    <span>主文件</span>
                    <select
                      value={compileSettingsDraft?.rootFile ?? ""}
                      onChange={(event) =>
                        setCompileSettingsDraft((current) =>
                          current
                            ? {
                                ...current,
                                rootFile: event.target.value,
                              }
                            : current,
                        )
                      }
                      disabled={!activeProjectId || texFileOptions.length === 0}
                    >
                      {texFileOptions.length === 0 ? <option value="">暂无 .tex 文件</option> : null}
                      {texFileOptions.map((filePath) => (
                        <option key={filePath} value={filePath}>
                          {filePath}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="compile-setting-field">
                    <span>引擎</span>
                    <select
                      value={compileSettingsDraft?.compileEngine ?? "pdflatex"}
                      onChange={(event) =>
                        setCompileSettingsDraft((current) =>
                          current
                            ? {
                                ...current,
                                compileEngine: event.target.value as ProjectCompileSettings["compileEngine"],
                              }
                            : current,
                        )
                      }
                      disabled={!activeProjectId}
                    >
                      <option value="pdflatex">pdflatex</option>
                      <option value="xelatex">xelatex</option>
                      <option value="lualatex">lualatex</option>
                    </select>
                  </label>
                </div>
              </div>
              <div className="header-actions">
                <button
                  type="button"
                  className="mini-button"
                  onClick={() => void handleSaveCompileSettings()}
                  disabled={!activeProjectId || !compileSettingsDraft || !hasUnsavedCompileSettings}
                >
                  保存设置
                </button>
                <button
                  type="button"
                  className="mini-button"
                  onClick={() => void handleDiagnoseCompileFailure()}
                  disabled={!activeCompileJob}
                >
                  AI 诊断
                </button>
              </div>
            </div>
            <div className="log-panel-content">
              {activeCompileJob ? (
                <div className="compile-job-meta">
                  <small>状态：{activeCompileJob.status}</small>
                  <small>引擎：{activeCompileJob.compileEngine}</small>
                  <small>主文件：{activeCompileJob.rootFile}</small>
                </div>
              ) : null}
              {compileDiagnosis ? (
                <div className="diagnosis-card">
                  <div className="diagnosis-header">
                    <strong>{compileDiagnosis.summary}</strong>
                    <small>{compileDiagnosis.errorType}</small>
                  </div>
                  <p className="diagnosis-explanation">{compileDiagnosis.explanation}</p>
                  <div className="diagnosis-meta">
                    <small>文件：{compileDiagnosis.likelyFilePath ?? "未识别"}</small>
                    <small>行号：{compileDiagnosis.likelyLine ?? "未识别"}</small>
                  </div>
                  <div className="diagnosis-fixes">
                    {compileDiagnosis.suggestedFixes.map((fix) => (
                      <div key={fix} className="diagnosis-fix">
                        {fix}
                      </div>
                    ))}
                  </div>
                  <div className="assistant-code-actions">
                    {compileDiagnosis.likelyLine ? (
                      <button
                        type="button"
                        className="mini-button"
                        onClick={() =>
                          void handleOpenCompileDiagnostic({
                            file: compileDiagnosis.likelyFilePath,
                            line: compileDiagnosis.likelyLine,
                            message: compileDiagnosis.summary,
                          })
                        }
                      >
                        跳转定位
                      </button>
                    ) : null}
                    <button type="button" className="mini-button" onClick={() => void handleGenerateCompileFix()}>
                      生成修复代码
                    </button>
                  </div>
                </div>
              ) : null}
              {activeCompileJob && activeCompileJob.diagnostics.length > 0 ? (
                <div className="diagnostic-list">
                  {activeCompileJob.diagnostics.map((diagnostic, index) => (
                    <button
                      key={`${diagnostic.file ?? "unknown"}-${diagnostic.line ?? index}-${index}`}
                      type="button"
                      className="diagnostic-item"
                      onClick={() => void handleOpenCompileDiagnostic(diagnostic)}
                    >
                      <strong>{diagnostic.file ?? "未识别文件"}</strong>
                      <small>{diagnostic.line ? `L${diagnostic.line}` : "行号未知"}</small>
                      <span>{diagnostic.message}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              <pre className="compile-log">{compileLog}</pre>
            </div>
          </section>

          <section className={`tab-panel${rightTab === "comments" ? " tab-panel-active" : ""}`}>
            <div className="panel-toolbar">
              <span>评论与批注</span>
              <div className="header-actions">
                <button
                  type="button"
                  className="mini-button"
                  onClick={() => void handleCreateComment()}
                  disabled={!activeProjectId || !activeFileId}
                >
                  添加批注
                </button>
              </div>
            </div>
            <div className="member-panel-content">
              {!activeProjectId ? <div className="empty-panel">请选择项目后查看批注</div> : null}
              {activeProjectId && activeFileComments.length === 0 ? (
                <small>当前文件还没有批注，可以直接针对选区添加评论。</small>
              ) : null}
              {activeFileComments.map((comment) => (
                <div key={comment.id} className="audit-card">
                  <div className="audit-card-header">
                    <strong>{comment.authorName}</strong>
                    <small>{formatDate(comment.createdAt)}</small>
                  </div>
                  <p>{comment.content}</p>
                  <small>
                    {comment.filePath} · L{comment.lineStart}
                    {comment.lineEnd !== comment.lineStart ? `-${comment.lineEnd}` : ""}
                  </small>
                  {comment.excerpt ? <pre className="compile-log">{comment.excerpt}</pre> : null}
                  <div className="assistant-code-actions">
                    <button type="button" className="mini-button" onClick={() => handleJumpToLine(comment.lineStart)}>
                      跳转定位
                    </button>
                    <button
                      type="button"
                      className="mini-button"
                      onClick={() => void handleReplyComment(comment.id)}
                    >
                      回复
                    </button>
                    <button
                      type="button"
                      className="mini-button"
                      onClick={() => void handleToggleCommentResolved(comment.id)}
                    >
                      {comment.resolvedAt ? "重新打开" : "标记解决"}
                    </button>
                  </div>
                  {comment.replies.length > 0 ? (
                    <div className="diagnosis-fixes">
                      {comment.replies.map((reply) => (
                        <div key={reply.id} className="diagnosis-fix">
                          <strong>{reply.authorName}</strong>：{reply.content}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {comment.resolvedAt ? <small>已于 {formatDate(comment.resolvedAt)} 标记为已解决</small> : null}
                </div>
              ))}
            </div>
          </section>

          <section className={`tab-panel${rightTab === "members" ? " tab-panel-active" : ""}`}>
            <div className="panel-toolbar">
              <span>项目成员与邀请</span>
              {canManageProjectMembers ? (
                <button type="button" className="mini-button" onClick={() => void handleCreateInvitation()}>
                  创建邀请
                </button>
              ) : null}
            </div>
            <div className="member-panel-content">
              {!activeProjectId ? <div className="empty-panel">请选择项目后查看成员</div> : null}
              {activeProjectId ? (
                <>
                  <div className="member-card member-card-current">
                    <div>
                      <strong>{sessionUser.name}</strong>
                      <small>当前身份</small>
                    </div>
                    <span>{formatProjectRoleLabel(activeProject?.currentUserRole ?? null)}</span>
                  </div>

                  <div className="member-section">
                    <strong>项目成员</strong>
                    {projectMembers.length === 0 ? <small>当前项目还没有成员信息</small> : null}
                    {projectMembers.map((member) => (
                      <div key={member.userId} className="member-card">
                        <div>
                          <strong>{member.name}</strong>
                          <small>{formatProjectRoleLabel(member.role)}</small>
                        </div>
                        {canManageProjectMembers && member.role !== "owner" ? (
                          <button
                            type="button"
                            className="mini-button"
                            onClick={() => void handleRemoveMember(member.userId)}
                          >
                            移除
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>

                  <div className="member-section">
                    <strong>邀请链接</strong>
                    {!canManageProjectMembers ? <small>仅项目所有者可创建和撤销邀请</small> : null}
                    {canManageProjectMembers && projectInvitations.length === 0 ? (
                      <small>当前还没有可用邀请链接</small>
                    ) : null}
                    {projectInvitations.map((invitation) => (
                      <div key={invitation.token} className="member-card">
                        <div>
                          <strong>{invitation.token}</strong>
                          <small>有效期至 {formatDate(invitation.expiresAt)}</small>
                        </div>
                        <div className="header-actions">
                          <button
                            type="button"
                            className="mini-button"
                            onClick={() =>
                              navigator.clipboard
                                .writeText(`${window.location.origin}${invitation.invitePath}`)
                                .then(() => setStatusText("邀请链接已复制"))
                                .catch(() => setStatusText("复制失败，请手动复制链接"))
                            }
                          >
                            复制
                          </button>
                          <button
                            type="button"
                            className="mini-button"
                            onClick={() => void handleRevokeInvitation(invitation.token)}
                          >
                            撤销
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="member-section">
                    <strong>工作空间</strong>
                    <small>
                      {activeProject?.workspaceName ?? activeWorkspace?.name ?? "个人空间"} ·{" "}
                      {activeProject?.workspaceType ?? activeWorkspace?.type ?? "personal"}
                    </small>
                    {activeWorkspace?.type === "organization" ? (
                      <div className="header-actions">
                        <button type="button" className="mini-button" onClick={() => void handleAddOrganizationMember()}>
                          添加组织成员
                        </button>
                        <button type="button" className="mini-button" onClick={() => void handleCreateTeamWorkspace()}>
                          创建团队
                        </button>
                      </div>
                    ) : null}
                    {activeWorkspace?.type === "team" ? (
                      <div className="header-actions">
                        <button type="button" className="mini-button" onClick={() => void handleAddTeamMember()}>
                          添加团队成员
                        </button>
                      </div>
                    ) : null}
                    {workspaceMembers.length === 0 ? <small>当前工作空间暂无额外成员信息</small> : null}
                    {workspaceMembers.map((member) => (
                      <div
                        key={`${member.userId}-${member.organizationId ?? member.teamId ?? "workspace"}`}
                        className="member-card"
                      >
                        <div>
                          <strong>{member.displayName}</strong>
                          <small>{member.email} · {formatWorkspaceRoleLabel(member.role)}</small>
                        </div>
                      </div>
                    ))}
                    {activeWorkspace?.type === "organization" && workspaceTeams.length > 0 ? (
                      <div className="member-section">
                        <strong>组织团队</strong>
                        {workspaceTeams.map((team) => (
                          <div key={team.id} className="member-card">
                            <div>
                              <strong>{team.name}</strong>
                              <small>{formatWorkspaceRoleLabel(team.currentUserRole)}</small>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>
          </section>

          <section className={`tab-panel${rightTab === "audit" ? " tab-panel-active" : ""}`}>
            <div className="panel-toolbar">
              <span>审计与版本回放</span>
              <button
                type="button"
                className="mini-button"
                onClick={() => (activeProjectId ? void refreshProjectResources(activeProjectId) : undefined)}
              >
                刷新
              </button>
            </div>
            <div className="audit-panel-content">
              {!activeProjectId ? <div className="empty-panel">请选择项目后查看审计与版本事件</div> : null}
              {activeProjectId ? (
                <>
                  <div className="audit-section">
                    <strong>版本事件</strong>
                    {versionEvents.length === 0 ? <small>当前项目还没有记录版本事件</small> : null}
                    {versionEvents.map((event) => (
                      <div key={event.id} className="audit-card">
                        <div className="audit-card-header">
                          <strong>{formatVersionEventLabel(event.eventType)}</strong>
                          <small>{formatDate(event.createdAt)}</small>
                        </div>
                        <p>{event.filePath ?? event.snapshotId ?? "项目级事件"}</p>
                      </div>
                    ))}
                  </div>

                  <div className="audit-section">
                    <strong>审计日志</strong>
                    {auditLogs.length === 0 ? <small>当前项目还没有审计日志</small> : null}
                    {auditLogs.map((log) => (
                      <div key={log.id} className="audit-card">
                        <div className="audit-card-header">
                          <strong>{formatAuditActionLabel(log.action)}</strong>
                          <small>{formatDate(log.createdAt)}</small>
                        </div>
                        <p>{log.targetType}{log.targetId ? ` · ${log.targetId}` : ""}</p>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          </section>
        </div>

        <aside className="right-rail" aria-label="右侧功能导航">
          <div className="right-tabs">
            {rightTabDefinitions.map((tab) => (
              <RightTabButton
                key={tab.value}
                value={tab.value}
                label={tab.label}
                active={rightTab === tab.value}
                onClick={setRightTab}
              />
            ))}
          </div>
          <div className="right-footer">
            <span>{sessionUser.name}</span>
            <div className="sync-indicator" />
          </div>
        </aside>
      </main>
      )}
    </div>
  );
}

/*
 * Code Review:
 * - 当前主界面按工作台职责集中组织状态，但接口访问和编辑器实现已分别抽离，避免 `App` 退化成无边界的巨型文件。
 * - 协作配置仍由 `App` 统一组装，但房间协议、编辑器绑定和持久化都已下沉到专门模块，避免协作逻辑散落在页面各处。
 * - 工作空间、组织和团队入口已接入同一工作台，而不是另起页面，保持 Overleaf 类产品的单工作区心智模型。
 * - 模板库页面现在一次拉全量模板目录，再由前端按搜索词、来源和分类本地重排，避免把“分类导航”绑死在接口过滤上。
 * - AI 面板已升级为“持久化对话 + 解释/优化/修复动作”工作区，但 inline completion 仍应作为独立模块继续实现。
 * - 编译前显式保存当前文本文件，优先保证协作输入和编译输出之间的一致性，而不是依赖异步持久化时序碰运气。
 * - 编译进行中停留在日志面板有助于观察队列状态，但成功后应优先回到 PDF 预览，保证用户首先看到主结果而不是技术日志。
 * - 论文阅读已从右侧工作台面板中拆出，改成独立页面视图，避免把重内容阅读器继续塞进工具侧栏。
 * - 论文搜索已提升为顶栏一级页面，不再复用工作台右侧窄面板，以免检索、阅读和写作三种任务继续挤在同一条侧栏里。
 * - 打开 discovery 源论文时，会先解析到可读源后再加载高亮；高亮查询不再错误地继续使用原始 `openalex` 纸面 ID。
 * - 打开论文失败时现在显式弹出后端错误，并把状态栏同步成真实错误文案，像“未找到可读来源”这类 discovery 失败语义不会再被吞成笼统提示。
 * - 论文搜索默认 limit 回收到 200，优先保证交互响应；如需大规模召回仍可通过接口显式传更高 limit（上限 500）。
 * - 右侧图标侧栏已提升为页面级最右一列，避免继续被右侧内容面板包裹后产生“靠不住边”和中宽屏错位问题。
 * - 工作台在窄宽度下改为单列重排，而不是整体缩放；这能保住编辑器和 PDF 工具的可读性与点击面积。
 * - 若后续继续扩展，应优先把左侧资源区、右侧面板和顶部栏拆成子组件，而不是直接继续堆叠到当前文件。
 */
