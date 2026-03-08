/*
 * File: api.ts
 * Module: apps/web (前端接口层)
 *
 * Responsibility:
 *   - 封装工作台所需的 HTTP 请求，作为 React 视图层和后端 API 之间的窄接口。
 *   - 集中处理错误解析，避免组件里重复写 `fetch` 模板代码。
 *
 * Runtime Logic Overview:
 *   1. 组件调用本模块发起请求。
 *   2. 本模块统一解析 JSON 响应与错误对象。
 *   3. 业务层只消费结构化返回值。
 *
 * Dependencies:
 *   - 浏览器 Fetch API
 *   - ./types
 *
 * Last Updated:
 *   - 2026-03-08 by Codex - 升级论文接口为多源搜索能力
 */

import type {
  AuditLogRecord,
  AssistantDiagnosis,
  AssistantMessage,
  GlobalSearchGroup,
  OrganizationSummary,
  PaperAssistantReply,
  PaperDetail,
  ProjectTemplateDetail,
  ProjectTemplateSummary,
  ProjectPaperHighlight,
  PaperSearchResult,
  ProjectPaperRecord,
  ProjectInvitation,
  ProjectMember,
  AssistantReply,
  CompileJobRecord,
  FileNode,
  InlineCompletionResult,
  ProjectCompileSettings,
  ProjectCommentRecord,
  ProjectSummary,
  SessionUser,
  SnapshotRecord,
  TeamSummary,
  VersionEventRecord,
  WorkspaceMembershipRecord,
  WorkspaceSummary,
} from "./types";
import { buildCurrentUserQuery } from "./session";

class ApiRequestError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "ApiRequestError";
    this.statusCode = statusCode;
  }
}

async function requestJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    ...options,
  });

  const payload = (await response.json()) as { error?: { message?: string } };

  if (!response.ok) {
    throw new ApiRequestError(payload.error?.message ?? "请求失败", response.status);
  }

  return payload as T;
}

export function listProjects() {
  return requestJson<{ user: SessionUser; projects: ProjectSummary[] }>("/api/projects");
}

export function getCurrentUser() {
  return requestJson<{ authenticated: boolean; user: SessionUser | null }>("/api/me");
}

export function registerWithPassword(payload: {
  email: string;
  password: string;
  displayName: string;
}) {
  return requestJson<{ user: SessionUser }>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function loginWithPassword(payload: {
  email: string;
  password: string;
}) {
  return requestJson<{ user: SessionUser }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function logoutCurrentSession() {
  return requestJson<{ success: boolean }>("/api/auth/logout", {
    method: "POST",
  });
}

export function createProject(name: string) {
  return requestJson<{ project: ProjectSummary }>("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function createProjectInWorkspace(payload: {
  name: string;
  workspaceType: "personal" | "organization" | "team";
  organizationId?: string | null;
  teamId?: string | null;
}) {
  return requestJson<{ project: ProjectSummary }>("/api/projects", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listTemplates(filters: {
  query?: string;
  category?: string;
  sourceType?: string;
} = {}) {
  const params = new URLSearchParams();

  if (filters.query?.trim()) {
    params.set("q", filters.query.trim());
  }

  if (filters.category?.trim()) {
    params.set("category", filters.category.trim());
  }

  if (filters.sourceType?.trim()) {
    params.set("sourceType", filters.sourceType.trim());
  }

  const query = params.toString();
  return requestJson<{ templates: ProjectTemplateSummary[] }>(`/api/templates${query ? `?${query}` : ""}`);
}

export function getTemplateDetail(templateId: string) {
  return requestJson<{ template: ProjectTemplateDetail }>(`/api/templates/${encodeURIComponent(templateId)}`);
}

export function createProjectFromTemplate(
  templateId: string,
  payload: {
    name?: string;
    workspaceType?: "personal" | "organization" | "team";
    organizationId?: string | null;
    teamId?: string | null;
  } = {},
) {
  return requestJson<{ project: ProjectSummary; template: { id: string; title: string; sourceLabel: string } }>(
    `/api/templates/${encodeURIComponent(templateId)}/projects`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function searchGlobalResources(query: string, projectId?: string | null) {
  const params = new URLSearchParams({
    q: query,
  });

  if (projectId) {
    params.set("projectId", projectId);
  }

  return requestJson<{ query: string; groups: GlobalSearchGroup[] }>(`/api/search?${params.toString()}`);
}

export function renameProject(projectId: string, name: string) {
  return requestJson<{ project: ProjectSummary }>(`/api/projects/${projectId}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

export function deleteProject(projectId: string) {
  return requestJson<{ success: boolean }>(`/api/projects/${projectId}`, {
    method: "DELETE",
  });
}

export function getProjectTree(projectId: string) {
  return requestJson<{ tree: FileNode[] }>(`/api/projects/${projectId}/tree`);
}

export function getProjectSettings(projectId: string) {
  return requestJson<{ settings: ProjectCompileSettings }>(`/api/projects/${projectId}/settings`);
}

export function updateProjectSettings(projectId: string, settings: ProjectCompileSettings) {
  return requestJson<{ settings: ProjectCompileSettings; project: ProjectSummary }>(
    `/api/projects/${projectId}/settings`,
    {
      method: "PATCH",
      body: JSON.stringify(settings),
    },
  );
}

export function readProjectFile(projectId: string, filePath: string) {
  return requestJson<{ id: string | null; path: string; content: string }>(
    `/api/projects/${projectId}/file?path=${encodeURIComponent(filePath)}`,
  );
}

export function updateProjectFile(projectId: string, filePath: string, content: string) {
  return requestJson<{ file: { id: string | null; path: string; content: string } }>(
    `/api/projects/${projectId}/file?path=${encodeURIComponent(filePath)}`,
    {
      method: "PUT",
      body: JSON.stringify({ content }),
    },
  );
}

export function createProjectFile(projectId: string, filePath: string) {
  return requestJson<{ file: { id: string | null; path: string } }>(`/api/projects/${projectId}/file`, {
    method: "POST",
    body: JSON.stringify({ path: filePath, content: "" }),
  });
}

export function createProjectDirectory(projectId: string, directoryPath: string) {
  return requestJson<{ directory: { id: string | null; path: string } }>(`/api/projects/${projectId}/directory`, {
    method: "POST",
    body: JSON.stringify({ path: directoryPath }),
  });
}

export function moveProjectEntry(projectId: string, fromPath: string, toPath: string) {
  return requestJson<{ move: { fromPath: string; toPath: string } }>(`/api/projects/${projectId}/move`, {
    method: "POST",
    body: JSON.stringify({ fromPath, toPath }),
  });
}

export function deleteProjectEntry(projectId: string, entryPath: string) {
  return requestJson<{ success: boolean }>(
    `/api/projects/${projectId}/entry?path=${encodeURIComponent(entryPath)}`,
    {
      method: "DELETE",
    },
  );
}

export function compileProject(projectId: string) {
  return requestJson<{ job: CompileJobRecord }>(`/api/projects/${projectId}/compile`, {
    method: "POST",
  });
}

export function getCompileJob(jobId: string) {
  return requestJson<{ job: CompileJobRecord }>(`/api/compile/${jobId}`);
}

export function listSnapshots(projectId: string) {
  return requestJson<{ snapshots: SnapshotRecord[] }>(`/api/projects/${projectId}/snapshots`);
}

export function listProjectAuditLogs(projectId: string) {
  return requestJson<{ logs: AuditLogRecord[] }>(`/api/projects/${projectId}/audit`);
}

export function listProjectVersionEvents(projectId: string) {
  return requestJson<{ events: VersionEventRecord[] }>(`/api/projects/${projectId}/version-events`);
}

export function listProjectPaperLibrary(projectId: string) {
  return requestJson<{ papers: ProjectPaperRecord[] }>(`/api/projects/${projectId}/papers/library`);
}

export function searchProjectPapers(
  projectId: string,
  payload: { query: string; limit?: number; sources?: string[] },
) {
  return requestJson<{ results: PaperSearchResult[] }>(`/api/projects/${projectId}/papers/search`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getProjectPaper(projectId: string, paperId: string, maxChars?: number) {
  const params = new URLSearchParams();

  if (typeof maxChars === "number" && Number.isFinite(maxChars)) {
    params.set("maxChars", String(maxChars));
  }

  const query = params.toString();
  return requestJson<{ paper: PaperDetail }>(
    `/api/projects/${projectId}/papers/${encodeURIComponent(paperId)}${query ? `?${query}` : ""}`,
  );
}

export function importProjectPaper(
  projectId: string,
  payload: {
    paperId: string;
    bibFilePath?: string;
  },
) {
  return requestJson<{
    paper: ProjectPaperRecord;
    reference: { bibFilePath: string; bibtexKey: string };
  }>(`/api/projects/${projectId}/papers/import`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function askProjectPaperAssistant(
  projectId: string,
  payload: {
    message: string;
    selectedPaperIds?: string[];
    sources?: string[];
  },
) {
  return requestJson<{ reply: PaperAssistantReply }>(`/api/projects/${projectId}/papers/assistant`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listProjectPaperHighlights(projectId: string, paperId: string) {
  return requestJson<{ highlights: ProjectPaperHighlight[] }>(
    `/api/projects/${projectId}/papers/${encodeURIComponent(paperId)}/highlights`,
  );
}

export function createProjectPaperHighlight(
  projectId: string,
  paperId: string,
  payload: {
    content: { text: string; image?: string };
    comment: { text: string; emoji: string };
    position: {
      boundingRect: Record<string, number>;
      rects: Array<Record<string, number>>;
      pageNumber: number;
      usePdfCoordinates?: boolean;
    };
  },
) {
  return requestJson<{ highlight: ProjectPaperHighlight }>(
    `/api/projects/${projectId}/papers/${encodeURIComponent(paperId)}/highlights`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function updateProjectPaperHighlight(
  projectId: string,
  paperId: string,
  highlightId: string,
  payload: {
    comment?: { text?: string; emoji?: string };
    content?: { text?: string; image?: string };
  },
) {
  return requestJson<{ highlight: ProjectPaperHighlight }>(
    `/api/projects/${projectId}/papers/${encodeURIComponent(paperId)}/highlights/${encodeURIComponent(highlightId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
  );
}

export function deleteProjectPaperHighlight(projectId: string, paperId: string, highlightId: string) {
  return requestJson<{ highlight: ProjectPaperHighlight; success: boolean }>(
    `/api/projects/${projectId}/papers/${encodeURIComponent(paperId)}/highlights/${encodeURIComponent(highlightId)}`,
    {
      method: "DELETE",
    },
  );
}

export function listProjectComments(projectId: string, options: { fileId?: string | null; includeResolved?: boolean } = {}) {
  const params = new URLSearchParams();

  if (options.fileId) {
    params.set("fileId", options.fileId);
  }

  if (options.includeResolved === false) {
    params.set("includeResolved", "0");
  }

  const query = params.toString();
  return requestJson<{ comments: ProjectCommentRecord[] }>(
    `/api/projects/${projectId}/comments${query ? `?${query}` : ""}`,
  );
}

export function createProjectComment(
  projectId: string,
  payload: {
    fileId: string;
    content: string;
    excerpt: string;
    selectionText: string;
    lineStart: number;
    lineEnd: number;
    columnStart: number;
    columnEnd: number;
  },
) {
  return requestJson<{ comment: ProjectCommentRecord }>(`/api/projects/${projectId}/comments`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function replyProjectComment(projectId: string, commentId: string, content: string) {
  return requestJson<{ comment: ProjectCommentRecord }>(
    `/api/projects/${projectId}/comments/${commentId}/reply`,
    {
      method: "POST",
      body: JSON.stringify({ content }),
    },
  );
}

export function resolveProjectComment(projectId: string, commentId: string) {
  return requestJson<{ comment: ProjectCommentRecord }>(
    `/api/projects/${projectId}/comments/${commentId}/resolve`,
    {
      method: "POST",
    },
  );
}

export function getWorkspaces() {
  return requestJson<{
    personal: WorkspaceSummary;
    organizations: OrganizationSummary[];
    teams: TeamSummary[];
  }>("/api/workspaces");
}

export function createOrganizationWorkspace(name: string, slug?: string) {
  return requestJson<{ organization: OrganizationSummary }>("/api/organizations", {
    method: "POST",
    body: JSON.stringify({ name, slug }),
  });
}

export function listOrganizationMembers(organizationId: string) {
  return requestJson<{ members: WorkspaceMembershipRecord[] }>(`/api/organizations/${organizationId}/members`);
}

export function addOrganizationMemberByEmail(organizationId: string, payload: { email: string; role: string }) {
  return requestJson<{ success: boolean }>(`/api/organizations/${organizationId}/members`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listOrganizationTeams(organizationId: string) {
  return requestJson<{ teams: TeamSummary[] }>(`/api/organizations/${organizationId}/teams`);
}

export function createTeamWorkspace(organizationId: string, payload: { name: string; slug?: string }) {
  return requestJson<{ team: TeamSummary }>(`/api/organizations/${organizationId}/teams`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listTeamMembers(teamId: string) {
  return requestJson<{ members: WorkspaceMembershipRecord[] }>(`/api/teams/${teamId}/members`);
}

export function addTeamMemberByEmail(teamId: string, payload: { email: string; role: string }) {
  return requestJson<{ success: boolean }>(`/api/teams/${teamId}/members`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function restoreSnapshot(projectId: string, snapshotId: string) {
  return requestJson<{ success: boolean; guardSnapshotId?: string }>(
    `/api/projects/${projectId}/snapshots/${snapshotId}/restore`,
    {
      method: "POST",
    },
  );
}

export async function streamAssistantChat(
  projectId: string,
  payload: {
    message: string;
    currentFilePath: string | null;
    currentFileContent: string;
    selectedText: string;
    history: AssistantMessage[];
  },
  handlers: {
    onDelta: (delta: string) => void;
    onDone: (reply: AssistantReply) => void;
  },
) {
  const response = await fetch(`/api/projects/${projectId}/ai/chat/stream`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok || !response.body) {
    const errorPayload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(errorPayload?.error?.message ?? "流式请求失败");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf8");
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.trim();

      if (!line) {
        continue;
      }

      const payloadLine = JSON.parse(line) as
        | { type: "delta"; delta: string }
        | { type: "done"; reply: AssistantReply }
        | { type: "error"; error: { message?: string } };

      if (payloadLine.type === "delta") {
        handlers.onDelta(payloadLine.delta);
        continue;
      }

      if (payloadLine.type === "done") {
        handlers.onDone(payloadLine.reply);
        continue;
      }

      throw new Error(payloadLine.error?.message ?? "流式请求失败");
    }
  }
}

export function diagnoseCompileFailure(
  projectId: string,
  payload: {
    currentFilePath: string | null;
    currentFileContent: string;
    selectedText: string;
    message?: string;
  },
) {
  return requestJson<{ diagnosis: AssistantDiagnosis; compileStatus: string | null }>(
    `/api/projects/${projectId}/ai/diagnose`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function requestInlineCompletion(
  projectId: string,
  payload: {
    currentFilePath: string | null;
    currentFileContent: string;
    recentCompileLog?: string;
    cursorOffset: number;
    prefix: string;
    suffix: string;
  },
  signal?: AbortSignal,
) {
  return requestJson<{ completion: InlineCompletionResult }>(`/api/projects/${projectId}/ai/completion`, {
    method: "POST",
    body: JSON.stringify(payload),
    ...(signal ? { signal } : {}),
  });
}

export function getAssistantConversation(projectId: string) {
  return requestJson<{ messages: AssistantMessage[] }>(`/api/projects/${projectId}/ai/conversation`);
}

export function clearAssistantConversation(projectId: string) {
  return requestJson<{ success: boolean }>(`/api/projects/${projectId}/ai/conversation`, {
    method: "DELETE",
  });
}

export function explainSelection(
  projectId: string,
  payload: {
    currentFilePath: string | null;
    currentFileContent: string;
    selectedText: string;
    message?: string;
  },
) {
  return requestJson<{ reply: AssistantReply }>(`/api/projects/${projectId}/ai/explain`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function improveSelection(
  projectId: string,
  payload: {
    currentFilePath: string | null;
    currentFileContent: string;
    selectedText: string;
    recentCompileLog?: string;
    message?: string;
  },
) {
  return requestJson<{ reply: AssistantReply }>(`/api/projects/${projectId}/ai/improve`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function generateCompileFix(
  projectId: string,
  payload: {
    currentFilePath: string | null;
    currentFileContent: string;
    selectedText: string;
    recentCompileLog?: string;
    message?: string;
  },
) {
  return requestJson<{ reply: AssistantReply }>(`/api/projects/${projectId}/ai/fix`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listProjectMembers(projectId: string) {
  return requestJson<{ members: ProjectMember[] }>(`/api/projects/${projectId}/members`);
}

export function removeProjectMember(projectId: string, userId: string) {
  return requestJson<{ success: boolean }>(`/api/projects/${projectId}/members/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  });
}

export function listProjectInvitations(projectId: string) {
  return requestJson<{ invitations: ProjectInvitation[] }>(`/api/projects/${projectId}/invitations`);
}

export function createProjectInvitation(projectId: string) {
  return requestJson<{ invitation: ProjectInvitation }>(`/api/projects/${projectId}/invitations`, {
    method: "POST",
    body: JSON.stringify({ role: "editor" }),
  });
}

export function revokeProjectInvitation(projectId: string, token: string) {
  return requestJson<{ invitation: ProjectInvitation }>(
    `/api/projects/${projectId}/invitations/${encodeURIComponent(token)}`,
    {
      method: "DELETE",
    },
  );
}

export function getInvitationPreview(token: string) {
  return requestJson<{ invitation: ProjectInvitation; project: { id: string; name: string } | null }>(
    `/api/invitations/${encodeURIComponent(token)}`,
  );
}

export function acceptProjectInvitation(token: string) {
  return requestJson<{ project: ProjectSummary; invitation: ProjectInvitation }>(
    `/api/invitations/${encodeURIComponent(token)}/accept`,
    {
      method: "POST",
    },
  );
}

export function appendCurrentUserQuery(url: string) {
  const currentUserQuery = buildCurrentUserQuery();

  if (!currentUserQuery) {
    return url;
  }

  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${currentUserQuery}`;
}

export { ApiRequestError };

/*
 * Code Review:
 * - 请求层只暴露业务动作，不把 `fetch` 细节扩散到视图层，符合低耦合要求。
 * - 当前仍采用轻量内联 DTO，而非引入完整生成式 SDK，避免为现阶段 API 规模过度设计。
 * - 若后续接口显著增长，应把项目、编译、快照和 AI 拆成多个子客户端文件。
 */
