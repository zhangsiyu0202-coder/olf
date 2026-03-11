/*
 * File: types.ts
 * Module: apps/web (前端类型定义)
 *
 * Responsibility:
 *   - 统一维护前端工作台使用的 API 数据结构和视图状态类型。
 *   - 避免 `App.tsx`、编辑器组件和接口层重复声明同一批结构。
 *
 * Runtime Logic Overview:
 *   1. API 层返回数据后映射到这些结构。
 *   2. React 组件基于类型定义进行状态更新和渲染。
 *
 * Dependencies:
 *   - TypeScript 类型系统
 *
 * Last Updated:
 *   - 2026-03-11 by Codex - 新增论文报告与论文私有笔记类型
 */

export interface ProjectSummary {
  id: string;
  name: string;
  rootFile: string;
  compileEngine: "pdflatex" | "xelatex" | "lualatex";
  createdAt: string;
  updatedAt: string;
  ownerId: string | null;
  ownerName: string | null;
  memberCount: number;
  currentUserRole: "owner" | "editor" | "commenter" | "viewer" | null;
  workspaceType: "personal" | "organization" | "team";
  workspaceName: string | null;
  organizationId: string | null;
  teamId: string | null;
}

export interface FileNode {
  id: string;
  type: "file" | "directory";
  name: string;
  path: string;
  children?: FileNode[];
}

export interface SnapshotRecord {
  id: string;
  type: string;
  label?: string;
  fileCount: number;
  createdAt: string;
}

export interface ProjectCompileSettings {
  rootFile: string;
  compileEngine: "pdflatex" | "xelatex" | "lualatex";
}

export interface CompileDiagnostic {
  file: string | null;
  line: number | null;
  message: string;
}

export interface CompileJobRecord {
  id: string;
  projectId: string;
  rootFile: string;
  compileEngine: "pdflatex" | "xelatex" | "lualatex";
  status: "pending" | "running" | "succeeded" | "failed";
  updatedAt: string;
  log: string;
  diagnostics: CompileDiagnostic[];
  pdfUrl: string | null;
}

export interface AssistantMessage {
  role: "assistant" | "user";
  content: string;
}

export interface AssistantReply {
  answer: string;
  source: string;
  model: string;
  suggestions?: string[];
  warning?: string;
}

export interface PaperSearchResult {
  paperId: string;
  source: string;
  sourceLabel: string;
  sourceId: string;
  entryId: string | null;
  title: string;
  authors: string[];
  published: string | null;
  summary: string;
  abstractUrl: string | null;
  pdfUrl: string | null;
  doi?: string | null;
  venue?: string | null;
  fullTextAvailable?: boolean;
  accessStatus?: string;
}

export interface PaperSourceStatus {
  source: string;
  sourceLabel: string;
  ok: boolean;
  resultCount: number;
  durationMs: number;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface PaperSearchResponse {
  results: PaperSearchResult[];
  sources: string[];
  sourceStatuses: PaperSourceStatus[];
}

export interface ProjectPaperRecord extends PaperSearchResult {
  bibtex: string;
  bibtexKey: string;
  bibFilePath: string;
  importedBy: string | null;
  importedAt: string;
  updatedAt: string;
}

export interface PaperDetail extends PaperSearchResult {
  content: string;
  contentSource: string;
  warning: string | null;
}

export interface PaperAssistantReply {
  answer: string;
  source: string;
  model: string;
}

export interface PaperReportAnchor {
  id: string;
  chunkId: string;
  excerpt: string;
  pageNumber: number | null;
  score: number | null;
}

export interface PaperReportSection {
  id: string;
  title: string;
  content: string;
  anchorIds: string[];
  confidence: "high" | "medium" | "low";
}

export interface PaperReport {
  reportId: string;
  canonicalPaperId: string;
  paperId: string;
  sourcePaperId: string | null;
  title: string;
  summary: string;
  sections: PaperReportSection[];
  anchors: PaperReportAnchor[];
  markdown: string;
  constraints: {
    passed: boolean;
    score: number;
    failedRules: string[];
  };
  status: "ready" | "degraded";
  model: string;
  engine: string;
  generatedAt: string;
  expiresAt: string | null;
  updatedAt: string;
}

export interface PaperReportState {
  status: "queued" | "running" | "ready" | "degraded" | "failed";
  isStale: boolean;
  jobId: string | null;
  errorMessage: string | null;
  updatedAt: string | null;
}

export interface PaperNote {
  id: string;
  projectId: string;
  paperId: string;
  title: string;
  text: string;
  anchorId: string | null;
  pageNumber: number | null;
  contextText: string | null;
  createdByUserId: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectPaperHighlight {
  id: string;
  projectId: string;
  paperId: string;
  kind: "highlight" | "comment";
  content: {
    text: string;
    image?: string;
  };
  comment: {
    text: string;
    emoji: string;
  };
  position: {
    boundingRect: {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      width: number;
      height: number;
      pageNumber: number;
    };
    rects: Array<{
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      width: number;
      height: number;
      pageNumber: number;
    }>;
    pageNumber: number;
    usePdfCoordinates?: boolean;
  };
  authorUserId: string;
  authorName: string;
  createdAt: string;
}

export interface ProjectTemplateSummary {
  id: string;
  title: string;
  description: string;
  category: string;
  categoryLabel: string;
  sourceType: string;
  sourceLabel: string;
  availability: "local" | "external";
  trustLabel: string;
  providerName: string | null;
  sourceUrl: string | null;
  featured: boolean;
  updatedAt: string;
  compileEngine: "pdflatex" | "xelatex" | "lualatex";
  rootFile: string;
  tags: string[];
  recommendedFor: string[];
  highlights: string[];
  fileCount: number;
}

export interface ProjectTemplateDetail extends ProjectTemplateSummary {
  previewSnippet: string;
  files: Array<{
    path: string;
    preview: string;
    content?: string;
  }>;
}

export interface GlobalSearchItem {
  id: string;
  type: "project" | "file" | "project-paper" | "external-paper" | "template" | "command";
  title: string;
  subtitle: string;
  sourceLabel: string;
  projectId?: string;
  projectName?: string;
  filePath?: string;
  fileId?: string;
  paperId?: string;
  templateId?: string;
  commandId?: string;
}

export interface GlobalSearchGroup {
  key: string;
  label: string;
  items: GlobalSearchItem[];
}

export interface AssistantDiagnosis {
  summary: string;
  errorType: string;
  explanation: string;
  likelyLine: number | null;
  likelyFilePath: string | null;
  suggestedFixes: string[];
  source: string;
  model: string;
  rawAnswer: string | null;
}

export interface InlineCompletionResult {
  text: string;
  source: string;
  model: string;
  strategy: string;
  latencyMs: number;
  warning: string | null;
}

export interface CollaboratorUser {
  name: string;
  color: string;
  colorLight: string;
}

export interface SessionUser extends CollaboratorUser {
  id: string;
  email?: string;
  displayName?: string;
}

export interface CollaboratorPresence {
  clientId: number;
  user: CollaboratorUser;
  isLocal: boolean;
}

export interface ProjectMember {
  userId: string;
  name: string;
  role: "owner" | "editor" | "commenter" | "viewer";
  joinedAt: string;
  invitedBy: string | null;
}

export interface ProjectInvitation {
  token: string;
  projectId: string;
  role: "owner" | "editor" | "commenter" | "viewer";
  createdBy: string;
  createdByName: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  invitePath: string;
}

export interface OutlineItem {
  id: string;
  title: string;
  level: number;
  line: number;
}

export interface AuditLogRecord {
  id: string;
  actorUserId: string | null;
  projectId: string | null;
  organizationId: string | null;
  teamId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface OrganizationSummary {
  id: string;
  slug: string;
  name: string;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
  currentUserRole: "owner" | "admin" | "member" | "billing_viewer";
}

export interface TeamSummary {
  id: string;
  organizationId: string;
  slug: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  currentUserRole: "owner" | "maintainer" | "member";
}

export interface WorkspaceSummary {
  id: string;
  type: "personal" | "organization" | "team";
  name: string;
  organizationId: string | null;
  teamId: string | null;
  currentUserRole: string | null;
}

export interface WorkspaceMembershipRecord {
  organizationId?: string;
  teamId?: string;
  userId: string;
  role: string;
  createdAt: string;
  email: string;
  displayName: string;
}

export interface ProjectCommentReply {
  id: string;
  authorUserId: string;
  authorName: string;
  content: string;
  createdAt: string;
}

export interface ProjectCommentRecord {
  id: string;
  projectId: string;
  fileId: string;
  filePath: string;
  excerpt: string;
  selectionText: string;
  lineStart: number;
  lineEnd: number;
  columnStart: number;
  columnEnd: number;
  content: string;
  authorUserId: string;
  authorName: string;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  replies: ProjectCommentReply[];
}

export interface VersionEventRecord {
  id: string;
  projectId: string;
  actorUserId: string | null;
  filePath: string | null;
  eventType: string;
  snapshotId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

/*
 * Code Review:
 * - 当前类型只覆盖已实现 API，避免提前引入庞大 DTO 体系。
 * - 问答、补全与编译等结构保持扁平，降低前端状态组织成本。
 * - 编译设置与诊断结构单独命名，避免在 `CompileJobRecord` 里塞入语义不清的匿名对象。
 * - 工作空间、组织和团队类型保持独立命名，便于成品化阶段继续扩展正式账号与团队能力。
 * - 若后续把共享 DTO 上移到 `packages/contracts`，这里应优先复用而不是分叉。
 */
