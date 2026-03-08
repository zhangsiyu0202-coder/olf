/*
 * File: server.js
 * Module: apps/api (成品化 API 服务)
 *
 * Responsibility:
 *   - 提供项目、文件、编译任务相关的 HTTP API。
 *   - 托管 MVP 前端静态资源，让整个系统在零依赖场景下直接可运行。
 *
 * Runtime Logic Overview:
 *   1. 进程启动时初始化项目仓储和任务仓储。
 *   2. HTTP 请求进入后按路径分发到项目、文件和编译相关处理逻辑。
 *   3. 非 API 请求回退为静态资源响应，用于加载前端页面。
 *
 * Key Data Flow:
 *   - 输入：浏览器请求体、查询参数、项目文件内容、编译任务请求。
 *   - 输出：JSON 响应、静态资源、PDF 二进制流。
 *
 * Future Extension:
 *   - 可替换为 Express/Fastify，并加入更细粒度的 DTO 校验与限流。
 *   - 可把静态资源托管拆到单独前端服务，但不影响当前 API 结构。
 *   - 当前已接入正式认证、工作空间和平台化路由，后续可继续拆分为独立路由模块。
 *
 * Dependencies:
 *   - node:http
 *   - node:fs/promises
 *   - node:path
 *   - node:url
 *   - packages/contracts
 *   - packages/runtime-store
 *   - packages/shared
 *
 * Last Updated:
 *   - 2026-03-08 by Codex - 新增探索页模板目录、模板建项目与全局聚合搜索 API
 */

import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  authenticateRequest,
  buildExpiredSessionCookie,
  buildSessionCookie,
  loginWithPassword,
  logoutSession,
  registerWithPassword,
} from "../../../packages/authentication/src/service.js";
import {
  generateExplainReply,
  generateFixReply,
  generateImproveReply,
  generateInlineCompletion,
  generateDiagnosisResult,
  streamAssistantReply,
} from "../../../packages/ai-assistant/src/service.js";
import {
  askPaperAgent,
  ensurePaperPdfCached,
  generatePaperBibtex,
  loadPaperDetails,
  searchPapers,
} from "../../../packages/paper-assistant/src/service.js";
import {
  appendAIConversationExchange,
  clearAIConversation,
  ensureAIConversationStorage,
  getAIConversation,
} from "../../../packages/runtime-store/src/ai-conversations.js";
import { getAuthUserByEmail } from "../../../packages/runtime-store/src/auth.js";
import { appendAuditLog, listAuditLogs } from "../../../packages/runtime-store/src/audit.js";
import { createCollaborationServer } from "../../../packages/collaboration/src/server.js";
import {
  createProjectComment,
  ensureCommentStorage,
  listProjectComments,
  replyProjectComment,
  resolveProjectComment,
} from "../../../packages/runtime-store/src/comments.js";
import {
  ensureCollaborationStorage,
} from "../../../packages/runtime-store/src/collaboration.js";
import {
  DEFAULT_COMPILE_ENGINE,
  PROJECT_MEMBER_ROLE,
  REQUEST_USER_ID_HEADER,
  REQUEST_USER_NAME_HEADER,
  AUTO_CHECKPOINT_SCAN_INTERVAL_MS,
  DEFAULT_PORT,
  ERROR_CODE,
  PROJECT_PERMISSION,
  STATIC_FILE_TYPES,
} from "../../../packages/contracts/src/index.js";
import {
  createCompileJob,
  ensureJobStorage,
  getCompileJob,
  listCompileJobs,
} from "../../../packages/runtime-store/src/jobs.js";
import {
  addProjectMember,
  createProject,
  createProjectDirectory,
  createProjectFile,
  deleteProject,
  deleteProjectEntry,
  ensureProjectStorage,
  getProject,
  getProjectRoleForUser,
  getProjectTree,
  listProjectMembers,
  listProjectsForUser,
  getProjectCompileSettings,
  moveProjectEntry,
  readProjectFile,
  renameProject,
  removeProjectMember,
  requireProjectAccess,
  resolveProjectEntryById,
  updateProjectCompileSettings,
  updateProjectFile,
} from "../../../packages/runtime-store/src/projects.js";
import {
  addOrganizationMember,
  addTeamMember,
  createOrganization,
  createTeam,
  getOrganizationById,
  getOrganizationMembership,
  getTeamById,
  getTeamMembership,
  listOrganizationMembers,
  listOrganizationsForUser,
  listTeamMembers,
  listTeams,
  listTeamsForUser,
} from "../../../packages/runtime-store/src/organizations.js";
import {
  assertInvitationUsable,
  createProjectInvitation,
  ensureInvitationStorage,
  getInvitation,
  listProjectInvitations,
  revokeProjectInvitation,
} from "../../../packages/runtime-store/src/invitations.js";
import {
  ensureSnapshotStorage,
  listSnapshots,
  restoreSnapshot,
  runAutoCheckpointCycle,
} from "../../../packages/runtime-store/src/snapshots.js";
import {
  ensurePaperStorage,
  getProjectPaper,
  listProjectPapers,
  upsertProjectPaper,
} from "../../../packages/runtime-store/src/papers.js";
import {
  createProjectPaperHighlight,
  deleteProjectPaperHighlight,
  ensurePaperHighlightStorage,
  listProjectPaperHighlights,
  updateProjectPaperHighlight,
} from "../../../packages/runtime-store/src/paper-highlights.js";
import {
  getTemplate,
  listTemplates,
  searchTemplates,
} from "../../../packages/runtime-store/src/templates.js";
import { appendVersionEvent, listVersionEvents } from "../../../packages/runtime-store/src/version-events.js";
import {
  ensureUserProfile,
  ensureUserStorage,
} from "../../../packages/runtime-store/src/users.js";
import { fileExists } from "../../../packages/shared/src/fs.js";
import { getProjectRoot, webStaticRoot } from "../../../packages/shared/src/paths.js";

const host = process.env.HOST ?? "127.0.0.1";
const allowDemoAuth = process.env.ALLOW_DEMO_AUTH === "1";
const autoCheckpointScanIntervalMs =
  Number(process.env.AUTO_CHECKPOINT_SCAN_INTERVAL_MS ?? AUTO_CHECKPOINT_SCAN_INTERVAL_MS);
const isMainModule = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

function resolveServerPort(rawPort) {
  const normalizedPort = Number(rawPort);

  if (!Number.isInteger(normalizedPort) || normalizedPort <= 0) {
    return DEFAULT_PORT;
  }

  return normalizedPort;
}

async function bootstrapStorage() {
  await ensureProjectStorage();
  await ensureJobStorage();
  await ensureSnapshotStorage();
  await ensureCollaborationStorage();
  await ensureInvitationStorage();
  await ensureUserStorage();
  await ensureAIConversationStorage();
  await ensureCommentStorage();
  await ensurePaperStorage();
  await ensurePaperHighlightStorage();
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function inferErrorCode(error) {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("不存在")) {
    return { statusCode: 404, code: ERROR_CODE.notFound };
  }

  if (message.includes("未登录") || message.includes("认证")) {
    return { statusCode: 401, code: ERROR_CODE.unauthorized };
  }

  if (message.includes("已存在")) {
    return { statusCode: 409, code: ERROR_CODE.conflict };
  }

  if (message.includes("非法") || message.includes("不能为空") || message.includes("仅支持")) {
    return { statusCode: 400, code: ERROR_CODE.badRequest };
  }

  if (message.includes("权限")) {
    return { statusCode: 403, code: ERROR_CODE.forbidden };
  }

  return { statusCode: 500, code: ERROR_CODE.internal };
}

function sendError(response, error) {
  const { statusCode, code } = inferErrorCode(error);
  const message = error instanceof Error ? error.message : "未知错误";

  if (response.headersSent) {
    sendNdjsonChunk(response, { type: "error", error: { code, message } });
    response.end();
    return;
  }

  sendJson(response, statusCode, { error: { code, message } });
}

function sendNdjsonChunk(response, payload) {
  response.write(`${JSON.stringify(payload)}\n`);
}

function extractBibtexKeys(content) {
  return [
    ...String(content ?? "").matchAll(/@\w+\{([^,\s]+),/g),
  ].map((match) => match[1]).filter(Boolean);
}

function replaceBibtexKey(entry, nextKey) {
  return String(entry ?? "").replace(/^(@\w+\{)([^,]+),/m, `$1${nextKey},`);
}

function chooseAvailableBibtexKey(existingContent, preferredKey) {
  const usedKeys = new Set(extractBibtexKeys(existingContent));

  if (!usedKeys.has(preferredKey)) {
    return preferredKey;
  }

  let suffix = 1;

  while (usedKeys.has(`${preferredKey}${suffix}`)) {
    suffix += 1;
  }

  return `${preferredKey}${suffix}`;
}

async function upsertProjectBibFile(projectId, bibFilePath, bibtexEntry, preferredKey) {
  let existingContent = "";
  let fileExistsInProject = true;

  try {
    const currentFile = await readProjectFile(projectId, bibFilePath);
    existingContent = currentFile.content;
  } catch {
    fileExistsInProject = false;
  }

  const nextKey = chooseAvailableBibtexKey(existingContent, preferredKey);
  const nextEntry = nextKey === preferredKey ? bibtexEntry : replaceBibtexKey(bibtexEntry, nextKey);

  if (!existingContent.includes(nextEntry.trim())) {
    const nextContent = [existingContent.trim(), nextEntry.trim()].filter(Boolean).join("\n\n") + "\n";

    if (fileExistsInProject) {
      await updateProjectFile(projectId, bibFilePath, nextContent);
    } else {
      await createProjectFile(projectId, bibFilePath, nextContent);
    }
  }

  return {
    bibFilePath,
    bibtexKey: nextKey,
    bibtex: nextEntry,
  };
}

async function readRequestBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const bodyText = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(bodyText);
}

function getStaticContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return STATIC_FILE_TYPES[extension] ?? "application/octet-stream";
}

async function serveStaticFile(response, requestPath) {
  const staticRelativePath = requestPath === "/" ? "index.html" : requestPath.slice(1);
  const absolutePath = path.resolve(webStaticRoot, staticRelativePath);

  if (!absolutePath.startsWith(webStaticRoot)) {
    sendJson(response, 403, { error: { code: ERROR_CODE.badRequest, message: "静态资源路径非法" } });
    return;
  }

  if (!(await fileExists(absolutePath))) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not Found");
    return;
  }

  response.writeHead(200, { "Content-Type": getStaticContentType(absolutePath) });
  response.end(await fs.readFile(absolutePath));
}

function normalizeCompileJob(job) {
  if (!job) {
    return null;
  }

  return {
    ...job,
    pdfUrl: job.pdfFilePath ? `/api/compile/${job.id}/pdf` : null,
  };
}

function getLatestCompileJobForProject(projectId, jobs) {
  return jobs.find((job) => job.projectId === projectId) ?? null;
}

async function resolveCurrentUser(request, url) {
  const authenticated = await authenticateRequest(request);

  if (authenticated?.user) {
    return authenticated.user;
  }

  if (!allowDemoAuth) {
    return null;
  }

  const rawUserId =
    request.headers[REQUEST_USER_ID_HEADER] ??
    url.searchParams.get("userId") ??
    "local-default-user";
  const rawUserName =
    request.headers[REQUEST_USER_NAME_HEADER] ??
    url.searchParams.get("userName") ??
    "本地作者";

  return ensureUserProfile({
    id: String(rawUserId),
    name: String(rawUserName),
  });
}

function requireAuthenticatedUser(currentUser) {
  if (!currentUser) {
    throw new Error("当前请求未登录");
  }

  return currentUser;
}

function getRequestIpAddress(request) {
  return request.socket.remoteAddress ?? null;
}

async function tryAppendAuditLog(entry) {
  try {
    await appendAuditLog(entry);
  } catch (error) {
    console.error("Failed to append audit log:", error);
  }
}

async function tryAppendVersionEvent(event) {
  try {
    await appendVersionEvent(event);
  } catch (error) {
    console.error("Failed to append version event:", error);
  }
}

function serializeProjectSummary(project, currentUserId) {
  const currentMember = (project.members ?? []).find((member) => member.userId === currentUserId) ?? null;

  return {
    id: project.id,
    name: project.name,
    rootFile: project.rootFile,
    compileEngine: project.compileEngine ?? DEFAULT_COMPILE_ENGINE,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    ownerId: project.ownerId,
    ownerName: project.ownerName,
    memberCount: (project.members ?? []).length,
    currentUserRole: currentMember?.role ?? null,
    workspaceType: project.workspaceType ?? "personal",
    workspaceName: project.workspaceName ?? null,
    organizationId: project.organizationId ?? null,
    teamId: project.teamId ?? null,
  };
}

function serializeProjectMember(member) {
  return {
    userId: member.userId,
    name: member.name,
    role: member.role,
    joinedAt: member.joinedAt,
    invitedBy: member.invitedBy,
  };
}

function serializeInvitation(invitation) {
  return {
    token: invitation.token,
    projectId: invitation.projectId,
    role: invitation.role,
    createdBy: invitation.createdBy,
    createdByName: invitation.createdByName,
    createdAt: invitation.createdAt,
    expiresAt: invitation.expiresAt,
    revokedAt: invitation.revokedAt,
    invitePath: `/?invite=${encodeURIComponent(invitation.token)}`,
  };
}

function normalizeSearchText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function includesSearchText(values, query) {
  return values.some((value) => normalizeSearchText(value).includes(query));
}

function buildCommandSearchItems({ hasActiveProject }) {
  const commands = [
    {
      id: "go-explore",
      title: "进入探索页",
      subtitle: "查看平台模板与示例工程，并从模板创建新项目",
      keywords: ["探索", "模板", "template", "gallery"],
    },
    {
      id: "create-project",
      title: "新建空白项目",
      subtitle: "在当前工作空间中创建一个新的论文项目",
      keywords: ["新建", "项目", "create", "project"],
    },
    {
      id: "open-paper-search",
      title: "打开论文检索",
      subtitle: "切换到论文检索面板，搜索多源论文结果",
      keywords: ["论文", "检索", "arxiv", "pubmed", "semantic scholar", "paper"],
    },
  ];

  if (hasActiveProject) {
    commands.push(
      {
        id: "compile-project",
        title: "编译当前项目",
        subtitle: "对当前打开的项目发起编译并查看 PDF 结果",
        keywords: ["编译", "pdf", "compile"],
      },
      {
        id: "open-assistant",
        title: "打开 AI 助手",
        subtitle: "切换到写作 Copilot 面板",
        keywords: ["ai", "助手", "copilot"],
      },
      {
        id: "open-paper-reader",
        title: "打开论文阅读",
        subtitle: "查看当前已打开论文的摘要、PDF 和摘录",
        keywords: ["阅读", "pdf", "摘录", "paper reader"],
      },
    );
  }

  return commands;
}

async function searchGlobalResourcesForUser(user, { query, projectId }) {
  const normalizedQuery = normalizeSearchText(query);

  if (normalizedQuery.length < 2) {
    return [];
  }

  const visibleProjects = await listProjectsForUser(user);
  const activeProject = projectId ? visibleProjects.find((project) => project.id === projectId) ?? null : null;
  const projectItems = visibleProjects
    .filter((project) => includesSearchText([project.name, project.workspaceName], normalizedQuery))
    .slice(0, 6)
    .map((project) => ({
      id: `project:${project.id}`,
      type: "project",
      title: project.name,
      subtitle: `${project.workspaceName ?? "个人空间"} · ${project.workspaceType}`,
      sourceLabel: "项目",
      projectId: project.id,
      projectName: project.name,
    }));
  const fileScopeProjects = activeProject ? [activeProject] : visibleProjects.slice(0, 8);
  const fileItems = fileScopeProjects
    .flatMap((project) =>
      (project.entries ?? [])
        .filter((entry) => entry.type === "file" && normalizeSearchText(entry.path).includes(normalizedQuery))
        .map((entry) => ({
          id: `file:${project.id}:${entry.id}`,
          type: "file",
          title: entry.path,
          subtitle: project.name,
          sourceLabel: activeProject ? "当前项目文件" : "项目文件",
          projectId: project.id,
          projectName: project.name,
          filePath: entry.path,
          fileId: entry.id,
        })),
    )
    .slice(0, 8);
  const paperScopeProjects = activeProject ? [activeProject] : visibleProjects.slice(0, 6);
  const importedPaperGroups = await Promise.all(
    paperScopeProjects.map(async (project) => ({
      project,
      papers: await listProjectPapers(project.id),
    })),
  );
  const importedPaperItems = importedPaperGroups
    .flatMap(({ project, papers }) =>
      papers
        .filter((paper) => includesSearchText([paper.title, paper.summary, paper.authors.join(" "), paper.paperId], normalizedQuery))
        .map((paper) => ({
          id: `library-paper:${project.id}:${paper.paperId}`,
          type: "project-paper",
          title: paper.title,
          subtitle: `${project.name} · ${paper.authors.slice(0, 3).join(", ")}`,
          sourceLabel: "项目文献库",
          projectId: project.id,
          projectName: project.name,
          paperId: paper.paperId,
        })),
    )
    .slice(0, 6);

  let externalPaperItems = [];

  if (normalizedQuery.length >= 3) {
    try {
      const externalPapers = await searchPapers(query, 4);
      externalPaperItems = externalPapers.map((paper) => ({
        id: `external-paper:${paper.paperId}`,
        type: "external-paper",
        title: paper.title,
        subtitle: `${paper.authors.slice(0, 3).join(", ")} · ${paper.published ?? "Unknown"}`,
        sourceLabel: `外部论文 / ${paper.sourceLabel ?? paper.source ?? "Unknown"}`,
        paperId: paper.paperId,
      }));
    } catch (error) {
      console.warn("Global search external paper lookup failed:", error);
    }
  }

  const templateItems = (await searchTemplates(query, 6)).map((template) => ({
    id: `template:${template.id}`,
    type: "template",
    title: template.title,
    subtitle: `${template.categoryLabel} · ${template.description}`,
    sourceLabel: `模板 / ${template.sourceLabel}`,
    templateId: template.id,
  }));
  const commandItems = buildCommandSearchItems({
    hasActiveProject: !!activeProject,
  })
    .filter((command) => includesSearchText([command.title, command.subtitle, ...(command.keywords ?? [])], normalizedQuery))
    .slice(0, 6)
    .map((command) => ({
      id: `command:${command.id}`,
      type: "command",
      title: command.title,
      subtitle: command.subtitle,
      sourceLabel: "快捷命令",
      commandId: command.id,
    }));

  return [
    { key: "projects", label: "项目", items: projectItems },
    { key: "files", label: "文件", items: fileItems },
    { key: "project-papers", label: "项目文献库", items: importedPaperItems },
    { key: "external-papers", label: "外部论文", items: externalPaperItems },
    { key: "templates", label: "模板", items: templateItems },
    { key: "commands", label: "命令", items: commandItems },
  ].filter((group) => group.items.length > 0);
}

function slugifyWorkspaceName(name) {
  const slug = String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!slug) {
    throw new Error("名称不能为空");
  }

  return slug;
}

async function requireOrganizationAccess(user, organizationId, allowedRoles = []) {
  const organization = await getOrganizationById(organizationId);

  if (!organization) {
    throw new Error("组织不存在");
  }

  const membership = await getOrganizationMembership(organizationId, user.id);

  if (!membership) {
    throw new Error("你没有访问该组织的权限");
  }

  if (allowedRoles.length > 0 && !allowedRoles.includes(membership.role)) {
    throw new Error("你没有执行该操作的权限");
  }

  return {
    organization,
    membership,
  };
}

async function requireTeamAccess(user, teamId, allowedRoles = []) {
  const team = await getTeamById(teamId);

  if (!team) {
    throw new Error("团队不存在");
  }

  const membership = await getTeamMembership(teamId, user.id);

  if (!membership) {
    throw new Error("你没有访问该团队的权限");
  }

  if (allowedRoles.length > 0 && !allowedRoles.includes(membership.role)) {
    throw new Error("你没有执行该操作的权限");
  }

  return {
    team,
    membership,
  };
}

async function buildAssistantContext(project, body, history = []) {
  const projectId = project.id;

  const jobs = await listCompileJobs();
  const latestCompileJob = getLatestCompileJobForProject(projectId, jobs);
  const fallbackFilePath = body.currentFilePath ?? project.rootFile;
  let storedFileContent = "";

  if (fallbackFilePath) {
    try {
      const filePayload = await readProjectFile(projectId, fallbackFilePath);
      storedFileContent = filePayload.content;
    } catch {
      storedFileContent = "";
    }
  }

  return {
    project,
    latestCompileJob,
    context: {
      projectId,
      projectRoot: getProjectRoot(projectId),
      message: body.message ?? "",
      currentFilePath: body.currentFilePath ?? fallbackFilePath ?? null,
      currentFileContent: body.currentFileContent ?? storedFileContent,
      selectedText: body.selectedText ?? "",
      recentCompileLog: body.recentCompileLog ?? latestCompileJob?.log ?? "",
      history,
      cursorOffset: typeof body.cursorOffset === "number" ? body.cursorOffset : null,
      prefix: body.prefix ?? "",
      suffix: body.suffix ?? "",
    },
  };
}

async function handleApiRequest(request, response, url) {
  const { pathname, searchParams } = url;

  if (request.method === "GET" && pathname === "/api/health") {
    sendJson(response, 200, { status: "ok" });
    return true;
  }

  const currentUser = await resolveCurrentUser(request, url);

  if (request.method === "GET" && pathname === "/api/me") {
    sendJson(response, 200, {
      authenticated: !!currentUser,
      user: currentUser,
    });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/auth/register") {
    const body = await readRequestBody(request);
    const payload = await registerWithPassword({
      email: body.email ?? "",
      password: body.password ?? "",
      displayName: body.displayName ?? "",
      ipAddress: getRequestIpAddress(request),
      userAgent: request.headers["user-agent"] ?? null,
    });
    response.setHeader("Set-Cookie", buildSessionCookie(payload.sessionToken, payload.expiresAt));
    sendJson(response, 201, { user: payload.user });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/auth/login") {
    const body = await readRequestBody(request);
    const payload = await loginWithPassword({
      email: body.email ?? "",
      password: body.password ?? "",
      ipAddress: getRequestIpAddress(request),
      userAgent: request.headers["user-agent"] ?? null,
    });
    response.setHeader("Set-Cookie", buildSessionCookie(payload.sessionToken, payload.expiresAt));
    sendJson(response, 200, { user: payload.user });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/auth/logout") {
    const authenticated = await authenticateRequest(request);

    if (authenticated?.session?.id) {
      await logoutSession(authenticated.session.id, authenticated.user.id);
    }

    response.setHeader("Set-Cookie", buildExpiredSessionCookie());
    sendJson(response, 200, { success: true });
    return true;
  }

  const invitationPreviewMatch = pathname.match(/^\/api\/invitations\/([^/]+)$/);

  if (invitationPreviewMatch && request.method === "GET") {
    const invitation = await getInvitation(decodeURIComponent(invitationPreviewMatch[1]));
    assertInvitationUsable(invitation);
    const project = await getProject(invitation.projectId);

    sendJson(response, 200, {
      invitation: serializeInvitation(invitation),
      project: project ? { id: project.id, name: project.name } : null,
    });
    return true;
  }

  const authenticatedUser = requireAuthenticatedUser(currentUser);

  if (request.method === "GET" && pathname === "/api/workspaces") {
    const [organizations, teams] = await Promise.all([
      listOrganizationsForUser(authenticatedUser.id),
      listTeamsForUser(authenticatedUser.id),
    ]);
    sendJson(response, 200, {
      personal: {
        id: `personal:${authenticatedUser.id}`,
        type: "personal",
        name: authenticatedUser.name,
      },
      organizations,
      teams,
    });
    return true;
  }

  if (request.method === "GET" && pathname === "/api/search") {
    const query = String(searchParams.get("q") ?? "").trim();
    const projectId = searchParams.get("projectId");
    const groups = await searchGlobalResourcesForUser(authenticatedUser, {
      query,
      projectId,
    });
    sendJson(response, 200, {
      query,
      groups,
    });
    return true;
  }

  if (request.method === "GET" && pathname === "/api/templates") {
    const query = String(searchParams.get("q") ?? "").trim();
    const category = String(searchParams.get("category") ?? "all").trim();
    const sourceType = String(searchParams.get("sourceType") ?? "all").trim();
    const templates = await listTemplates({
      query,
      category,
      sourceType,
    });
    sendJson(response, 200, { templates });
    return true;
  }

  const templateMatch = pathname.match(/^\/api\/templates\/([^/]+)$/);

  if (templateMatch && request.method === "GET") {
    const template = await getTemplate(decodeURIComponent(templateMatch[1]));

    if (!template) {
      throw new Error("模板不存在");
    }

    sendJson(response, 200, { template });
    return true;
  }

  const templateProjectCreateMatch = pathname.match(/^\/api\/templates\/([^/]+)\/projects$/);

  if (templateProjectCreateMatch && request.method === "POST") {
    const template = await getTemplate(decodeURIComponent(templateProjectCreateMatch[1]));

    if (!template) {
      throw new Error("模板不存在");
    }

    const body = await readRequestBody(request);
    const project = await createProject(body.name ?? template.title, authenticatedUser, {
      workspaceType: body.workspaceType,
      organizationId: body.organizationId,
      teamId: body.teamId,
      rootFile: template.rootFile,
      compileEngine: template.compileEngine,
      initialFiles: template.files,
    });

    await tryAppendAuditLog({
      actorUserId: authenticatedUser.id,
      projectId: project.id,
      action: "template.create_project",
      targetType: "project",
      targetId: project.id,
      payload: {
        templateId: template.id,
        templateTitle: template.title,
      },
    });

    sendJson(response, 201, {
      project: {
        ...serializeProjectSummary(project, authenticatedUser.id),
        currentUserRole: await getProjectRoleForUser(project, authenticatedUser),
      },
      template: {
        id: template.id,
        title: template.title,
        sourceLabel: template.sourceLabel,
      },
    });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/organizations") {
    const body = await readRequestBody(request);
    const organizationName = String(body.name ?? "").trim();

    if (!organizationName) {
      throw new Error("组织名称不能为空");
    }

    const organization = await createOrganization({
      slug: body.slug ? slugifyWorkspaceName(body.slug) : slugifyWorkspaceName(body.name ?? ""),
      name: organizationName,
      ownerUserId: authenticatedUser.id,
    });
    await tryAppendAuditLog({
      actorUserId: authenticatedUser.id,
      organizationId: organization.id,
      action: "organization.create",
      targetType: "organization",
      targetId: organization.id,
      payload: {
        name: organization.name,
      },
    });
    sendJson(response, 201, { organization });
    return true;
  }

  const organizationRootMatch = pathname.match(/^\/api\/organizations\/([^/]+)$/);

  if (organizationRootMatch && request.method === "GET") {
    const access = await requireOrganizationAccess(authenticatedUser, organizationRootMatch[1]);
    sendJson(response, 200, { organization: access.organization, membership: access.membership });
    return true;
  }

  const organizationMembersMatch = pathname.match(/^\/api\/organizations\/([^/]+)\/members$/);

  if (organizationMembersMatch && request.method === "GET") {
    await requireOrganizationAccess(authenticatedUser, organizationMembersMatch[1]);
    sendJson(response, 200, { members: await listOrganizationMembers(organizationMembersMatch[1]) });
    return true;
  }

  if (organizationMembersMatch && request.method === "POST") {
    const { organization, membership } = await requireOrganizationAccess(
      authenticatedUser,
      organizationMembersMatch[1],
      ["owner", "admin"],
    );
    const body = await readRequestBody(request);
    const invitedUser = await getAuthUserByEmail(String(body.email ?? "").trim().toLowerCase());

    if (!invitedUser) {
      throw new Error("目标用户不存在，请先让对方完成注册");
    }

    await addOrganizationMember({
      organizationId: organization.id,
      userId: invitedUser.id,
      role: body.role ?? "member",
    });
    await tryAppendAuditLog({
      actorUserId: authenticatedUser.id,
      organizationId: organization.id,
      action: "organization.member.add",
      targetType: "organization_membership",
      targetId: invitedUser.id,
      payload: {
        role: body.role ?? "member",
        actorRole: membership.role,
      },
    });
    sendJson(response, 201, { success: true });
    return true;
  }

  const organizationTeamsMatch = pathname.match(/^\/api\/organizations\/([^/]+)\/teams$/);

  if (organizationTeamsMatch && request.method === "GET") {
    await requireOrganizationAccess(authenticatedUser, organizationTeamsMatch[1]);
    sendJson(response, 200, { teams: await listTeams(organizationTeamsMatch[1]) });
    return true;
  }

  if (organizationTeamsMatch && request.method === "POST") {
    const { organization } = await requireOrganizationAccess(authenticatedUser, organizationTeamsMatch[1], [
      "owner",
      "admin",
    ]);
    const body = await readRequestBody(request);
    const teamName = String(body.name ?? "").trim();

    if (!teamName) {
      throw new Error("团队名称不能为空");
    }

    const team = await createTeam({
      organizationId: organization.id,
      slug: body.slug ? slugifyWorkspaceName(body.slug) : slugifyWorkspaceName(body.name ?? ""),
      name: teamName,
    });
    await addTeamMember({
      teamId: team.id,
      userId: authenticatedUser.id,
      role: "owner",
    });
    await tryAppendAuditLog({
      actorUserId: authenticatedUser.id,
      organizationId: organization.id,
      teamId: team.id,
      action: "team.create",
      targetType: "team",
      targetId: team.id,
      payload: {
        name: team.name,
      },
    });
    sendJson(response, 201, { team });
    return true;
  }

  const teamMembersMatch = pathname.match(/^\/api\/teams\/([^/]+)\/members$/);

  if (teamMembersMatch && request.method === "GET") {
    await requireTeamAccess(authenticatedUser, teamMembersMatch[1]);
    sendJson(response, 200, { members: await listTeamMembers(teamMembersMatch[1]) });
    return true;
  }

  if (teamMembersMatch && request.method === "POST") {
    const { team, membership } = await requireTeamAccess(authenticatedUser, teamMembersMatch[1], [
      "owner",
      "maintainer",
    ]);
    const body = await readRequestBody(request);
    const invitedUser = await getAuthUserByEmail(String(body.email ?? "").trim().toLowerCase());

    if (!invitedUser) {
      throw new Error("目标用户不存在，请先让对方完成注册");
    }

    await addTeamMember({
      teamId: team.id,
      userId: invitedUser.id,
      role: body.role ?? "member",
    });
    await tryAppendAuditLog({
      actorUserId: authenticatedUser.id,
      organizationId: team.organizationId,
      teamId: team.id,
      action: "team.member.add",
      targetType: "team_membership",
      targetId: invitedUser.id,
      payload: {
        role: body.role ?? "member",
        actorRole: membership.role,
      },
    });
    sendJson(response, 201, { success: true });
    return true;
  }

  if (request.method === "GET" && pathname === "/api/projects") {
    const projects = await listProjectsForUser(authenticatedUser);
    const serializedProjects = await Promise.all(
      projects.map(async (project) => ({
        ...serializeProjectSummary(project, authenticatedUser.id),
        currentUserRole: await getProjectRoleForUser(project, authenticatedUser),
      })),
    );
    sendJson(response, 200, {
      user: authenticatedUser,
      projects: serializedProjects,
    });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/projects") {
    const body = await readRequestBody(request);
    const project = await createProject(body.name ?? "", authenticatedUser, {
      workspaceType: body.workspaceType,
      organizationId: body.organizationId,
      teamId: body.teamId,
    });
    await tryAppendAuditLog({
      actorUserId: authenticatedUser.id,
      projectId: project.id,
      organizationId: project.organizationId,
      teamId: project.teamId,
      action: "project.create",
      targetType: "project",
      targetId: project.id,
      payload: {
        name: project.name,
        workspaceType: project.workspaceType,
      },
    });
    await tryAppendVersionEvent({
      projectId: project.id,
      actorUserId: authenticatedUser.id,
      eventType: "project_created",
      payload: {
        name: project.name,
        workspaceType: project.workspaceType,
      },
    });
    sendJson(response, 201, {
      project: {
        ...serializeProjectSummary(project, authenticatedUser.id),
        currentUserRole: await getProjectRoleForUser(project, authenticatedUser),
      },
    });
    return true;
  }

  const projectRootMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);

  if (projectRootMatch && request.method === "PATCH") {
    const body = await readRequestBody(request);
    await requireProjectAccess(projectRootMatch[1], authenticatedUser, { roles: [PROJECT_MEMBER_ROLE.owner] });
    const project = await renameProject(projectRootMatch[1], body.name ?? "");
    await tryAppendAuditLog({
      actorUserId: authenticatedUser.id,
      projectId: project.id,
      action: "project.rename",
      targetType: "project",
      targetId: project.id,
      payload: {
        name: project.name,
      },
    });
    sendJson(response, 200, {
      project: {
        ...serializeProjectSummary(project, authenticatedUser.id),
        currentUserRole: await getProjectRoleForUser(project, authenticatedUser),
      },
    });
    return true;
  }

  if (projectRootMatch && request.method === "DELETE") {
    await requireProjectAccess(projectRootMatch[1], authenticatedUser, { roles: [PROJECT_MEMBER_ROLE.owner] });
    await tryAppendAuditLog({
      actorUserId: authenticatedUser.id,
      projectId: projectRootMatch[1],
      action: "project.delete",
      targetType: "project",
      targetId: projectRootMatch[1],
      payload: {},
    });
    await deleteProject(projectRootMatch[1]);
    sendJson(response, 200, { success: true });
    return true;
  }

  const projectTreeMatch = pathname.match(/^\/api\/projects\/([^/]+)\/tree$/);

  if (projectTreeMatch && request.method === "GET") {
    await requireProjectAccess(projectTreeMatch[1], authenticatedUser);
    sendJson(response, 200, { tree: await getProjectTree(projectTreeMatch[1]) });
    return true;
  }

  const projectMembersMatch = pathname.match(/^\/api\/projects\/([^/]+)\/members$/);

  if (projectMembersMatch && request.method === "GET") {
    await requireProjectAccess(projectMembersMatch[1], authenticatedUser);
    const members = await listProjectMembers(projectMembersMatch[1]);
    sendJson(response, 200, { members: members.map(serializeProjectMember) });
    return true;
  }

  const projectMemberDeleteMatch = pathname.match(/^\/api\/projects\/([^/]+)\/members\/([^/]+)$/);

  if (projectMemberDeleteMatch && request.method === "DELETE") {
    const projectId = projectMemberDeleteMatch[1];
    const targetUserId = decodeURIComponent(projectMemberDeleteMatch[2]);
    const { member } = await requireProjectAccess(projectId, authenticatedUser);
    const members = await listProjectMembers(projectId);
    const targetMember = members.find((item) => item.userId === targetUserId) ?? null;

    if (!targetMember) {
      sendJson(response, 404, { error: { code: ERROR_CODE.notFound, message: "项目成员不存在" } });
      return true;
    }

    if (targetMember.role === PROJECT_MEMBER_ROLE.owner) {
      sendJson(response, 400, { error: { code: ERROR_CODE.badRequest, message: "不能移除项目所有者" } });
      return true;
    }

    if (member.role !== PROJECT_MEMBER_ROLE.owner && targetUserId !== authenticatedUser.id) {
      throw new Error("你没有执行该操作的权限");
    }

    await removeProjectMember(projectId, targetUserId);
    sendJson(response, 200, { success: true });
    return true;
  }

  const projectSnapshotsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/snapshots$/);

  if (projectSnapshotsMatch && request.method === "GET") {
    await requireProjectAccess(projectSnapshotsMatch[1], authenticatedUser);
    sendJson(response, 200, { snapshots: await listSnapshots(projectSnapshotsMatch[1]) });
    return true;
  }

  const projectAuditMatch = pathname.match(/^\/api\/projects\/([^/]+)\/audit$/);

  if (projectAuditMatch && request.method === "GET") {
    await requireProjectAccess(projectAuditMatch[1], authenticatedUser);
    sendJson(response, 200, { logs: await listAuditLogs({ projectId: projectAuditMatch[1], limit: 200 }) });
    return true;
  }

  const projectVersionEventsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/version-events$/);

  if (projectVersionEventsMatch && request.method === "GET") {
    await requireProjectAccess(projectVersionEventsMatch[1], authenticatedUser);
    sendJson(response, 200, { events: await listVersionEvents(projectVersionEventsMatch[1], 200) });
    return true;
  }

  const projectPaperLibraryMatch = pathname.match(/^\/api\/projects\/([^/]+)\/papers\/library$/);

  if (projectPaperLibraryMatch && request.method === "GET") {
    await requireProjectAccess(projectPaperLibraryMatch[1], authenticatedUser);
    sendJson(response, 200, { papers: await listProjectPapers(projectPaperLibraryMatch[1]) });
    return true;
  }

  const projectPaperSearchMatch = pathname.match(/^\/api\/projects\/([^/]+)\/papers\/search$/);

  if (projectPaperSearchMatch && request.method === "POST") {
    await requireProjectAccess(projectPaperSearchMatch[1], authenticatedUser);
    const body = await readRequestBody(request);
    const query = String(body.query ?? "").trim();

    if (!query) {
      throw new Error("论文检索词不能为空");
    }

    sendJson(response, 200, {
      results: await searchPapers(query, Number(body.limit ?? 6), Array.isArray(body.sources) ? body.sources : []),
    });
    return true;
  }

  const projectPaperAssistantMatch = pathname.match(/^\/api\/projects\/([^/]+)\/papers\/assistant$/);

  if (projectPaperAssistantMatch && request.method === "POST") {
    await requireProjectAccess(projectPaperAssistantMatch[1], authenticatedUser);
    const body = await readRequestBody(request);
    const message = String(body.message ?? "").trim();

    if (!message) {
      throw new Error("论文助手问题不能为空");
    }

    sendJson(response, 200, {
      reply: await askPaperAgent({
        message,
        selectedPaperIds: Array.isArray(body.selectedPaperIds) ? body.selectedPaperIds : [],
        sources: Array.isArray(body.sources) ? body.sources : [],
      }),
    });
    return true;
  }

  const projectPaperImportMatch = pathname.match(/^\/api\/projects\/([^/]+)\/papers\/import$/);

  if (projectPaperImportMatch && request.method === "POST") {
    const projectId = projectPaperImportMatch[1];
    await requireProjectAccess(projectId, authenticatedUser, { permission: PROJECT_PERMISSION.write });
    const body = await readRequestBody(request);
    const paperId = decodeURIComponent(String(body.paperId ?? "").trim());
    const bibFilePath = String(body.bibFilePath ?? "refs.bib").trim() || "refs.bib";

    if (!paperId) {
      throw new Error("待导入的论文 ID 不能为空");
    }

    const existingRecord = await getProjectPaper(projectId, paperId);

    if (existingRecord) {
      sendJson(response, 200, {
        paper: existingRecord,
        reference: {
          bibFilePath: existingRecord.bibFilePath,
          bibtexKey: existingRecord.bibtexKey,
        },
      });
      return true;
    }

    const paper = await loadPaperDetails(paperId, 12000);
    const bibtexPayload = await generatePaperBibtex(paperId);
    const bibResult = await upsertProjectBibFile(projectId, bibFilePath, bibtexPayload.bibtex, bibtexPayload.citeKey);
    const record = await upsertProjectPaper(projectId, {
      ...paper,
      bibtex: bibResult.bibtex,
      bibtexKey: bibResult.bibtexKey,
      bibFilePath: bibResult.bibFilePath,
      importedBy: authenticatedUser.id,
      importedAt: new Date().toISOString(),
    });

    await tryAppendAuditLog({
      actorUserId: authenticatedUser.id,
      projectId,
      action: "paper.import",
      targetType: "paper",
      targetId: record.paperId,
      payload: {
        bibFilePath: bibResult.bibFilePath,
        bibtexKey: bibResult.bibtexKey,
      },
    });
    await tryAppendVersionEvent({
      projectId,
      actorUserId: authenticatedUser.id,
      filePath: bibResult.bibFilePath,
      eventType: "paper_imported",
      payload: {
        paperId: record.paperId,
        bibtexKey: bibResult.bibtexKey,
      },
    });
    sendJson(response, 201, {
      paper: record,
      reference: {
        bibFilePath: bibResult.bibFilePath,
        bibtexKey: bibResult.bibtexKey,
      },
    });
    return true;
  }

  const projectCommentsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/comments$/);

  if (projectCommentsMatch && request.method === "GET") {
    const projectId = projectCommentsMatch[1];
    await requireProjectAccess(projectId, authenticatedUser, { permission: PROJECT_PERMISSION.comment });
    const fileId = searchParams.get("fileId");
    const includeResolved = searchParams.get("includeResolved") !== "0";
    sendJson(response, 200, {
      comments: await listProjectComments(projectId, {
        fileId: fileId || null,
        includeResolved,
      }),
    });
    return true;
  }

  if (projectCommentsMatch && request.method === "POST") {
    const projectId = projectCommentsMatch[1];
    await requireProjectAccess(projectId, authenticatedUser, { permission: PROJECT_PERMISSION.comment });
    const body = await readRequestBody(request);
    const fileEntry = await resolveProjectEntryById(projectId, body.fileId ?? "");

    if (!fileEntry || fileEntry.type !== "file") {
      throw new Error("评论目标文件不存在");
    }

    const comment = await createProjectComment(projectId, {
      fileId: fileEntry.id,
      filePath: fileEntry.path,
      excerpt: body.excerpt ?? "",
      selectionText: body.selectionText ?? "",
      lineStart: body.lineStart ?? 1,
      lineEnd: body.lineEnd ?? body.lineStart ?? 1,
      columnStart: body.columnStart ?? 1,
      columnEnd: body.columnEnd ?? body.columnStart ?? 1,
      content: body.content ?? "",
      authorUserId: authenticatedUser.id,
      authorName: authenticatedUser.name,
    });
    await tryAppendAuditLog({
      actorUserId: authenticatedUser.id,
      projectId,
      action: "comment.create",
      targetType: "project_comment",
      targetId: comment.id,
      payload: {
        fileId: comment.fileId,
        filePath: comment.filePath,
      },
    });
    await tryAppendVersionEvent({
      projectId,
      actorUserId: authenticatedUser.id,
      filePath: comment.filePath,
      eventType: "comment_created",
      payload: {
        commentId: comment.id,
        fileId: comment.fileId,
      },
    });
    sendJson(response, 201, { comment });
    return true;
  }

  const projectCommentReplyMatch = pathname.match(/^\/api\/projects\/([^/]+)\/comments\/([^/]+)\/reply$/);

  if (projectCommentReplyMatch && request.method === "POST") {
    const projectId = projectCommentReplyMatch[1];
    await requireProjectAccess(projectId, authenticatedUser, { permission: PROJECT_PERMISSION.comment });
    const body = await readRequestBody(request);
    const comment = await replyProjectComment(projectId, decodeURIComponent(projectCommentReplyMatch[2]), {
      authorUserId: authenticatedUser.id,
      authorName: authenticatedUser.name,
      content: body.content ?? "",
    });
    await tryAppendAuditLog({
      actorUserId: authenticatedUser.id,
      projectId,
      action: "comment.reply",
      targetType: "project_comment",
      targetId: comment.id,
      payload: {},
    });
    sendJson(response, 200, { comment });
    return true;
  }

  const projectCommentResolveMatch = pathname.match(/^\/api\/projects\/([^/]+)\/comments\/([^/]+)\/resolve$/);

  if (projectCommentResolveMatch && request.method === "POST") {
    const projectId = projectCommentResolveMatch[1];
    await requireProjectAccess(projectId, authenticatedUser, { permission: PROJECT_PERMISSION.comment });
    const comment = await resolveProjectComment(projectId, decodeURIComponent(projectCommentResolveMatch[2]), authenticatedUser.id);
    await tryAppendAuditLog({
      actorUserId: authenticatedUser.id,
      projectId,
      action: comment.resolvedAt ? "comment.resolve" : "comment.reopen",
      targetType: "project_comment",
      targetId: comment.id,
      payload: {},
    });
    sendJson(response, 200, { comment });
    return true;
  }

  const projectSettingsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/settings$/);

  if (projectSettingsMatch && request.method === "GET") {
    await requireProjectAccess(projectSettingsMatch[1], authenticatedUser);
    sendJson(response, 200, { settings: await getProjectCompileSettings(projectSettingsMatch[1]) });
    return true;
  }

  if (projectSettingsMatch && request.method === "PATCH") {
    const projectId = projectSettingsMatch[1];
    await requireProjectAccess(projectId, authenticatedUser);
    const body = await readRequestBody(request);
    const project = await updateProjectCompileSettings(projectId, {
      rootFile: body.rootFile,
      compileEngine: body.compileEngine,
    });
    sendJson(response, 200, {
      settings: {
        rootFile: project.rootFile,
        compileEngine: project.compileEngine ?? DEFAULT_COMPILE_ENGINE,
      },
      project: {
        ...serializeProjectSummary(project, authenticatedUser.id),
        currentUserRole: await getProjectRoleForUser(project, authenticatedUser),
      },
    });
    return true;
  }

  const projectInvitationsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/invitations$/);

  if (projectInvitationsMatch && request.method === "GET") {
    await requireProjectAccess(projectInvitationsMatch[1], authenticatedUser, { roles: [PROJECT_MEMBER_ROLE.owner] });
    const invitations = await listProjectInvitations(projectInvitationsMatch[1]);
    sendJson(response, 200, { invitations: invitations.map(serializeInvitation) });
    return true;
  }

  if (projectInvitationsMatch && request.method === "POST") {
    const projectId = projectInvitationsMatch[1];
    await requireProjectAccess(projectId, authenticatedUser, { roles: [PROJECT_MEMBER_ROLE.owner] });
    const body = await readRequestBody(request);
    const invitation = await createProjectInvitation(projectId, {
      createdBy: authenticatedUser.id,
      createdByName: authenticatedUser.name,
      role: body.role ?? PROJECT_MEMBER_ROLE.editor,
    });
    await tryAppendAuditLog({
      actorUserId: authenticatedUser.id,
      projectId,
      action: "project.invitation.create",
      targetType: "project_invitation",
      targetId: invitation.token,
      payload: {
        role: invitation.role,
      },
    });
    sendJson(response, 201, { invitation: serializeInvitation(invitation) });
    return true;
  }

  const projectInvitationDeleteMatch = pathname.match(/^\/api\/projects\/([^/]+)\/invitations\/([^/]+)$/);

  if (projectInvitationDeleteMatch && request.method === "DELETE") {
    await requireProjectAccess(projectInvitationDeleteMatch[1], authenticatedUser, { roles: [PROJECT_MEMBER_ROLE.owner] });
    const invitation = await revokeProjectInvitation(
      projectInvitationDeleteMatch[1],
      decodeURIComponent(projectInvitationDeleteMatch[2]),
    );
    await tryAppendAuditLog({
      actorUserId: authenticatedUser.id,
      projectId: projectInvitationDeleteMatch[1],
      action: "project.invitation.revoke",
      targetType: "project_invitation",
      targetId: invitation.token,
      payload: {},
    });
    sendJson(response, 200, { invitation: serializeInvitation(invitation) });
    return true;
  }

  const invitationAcceptMatch = pathname.match(/^\/api\/invitations\/([^/]+)\/accept$/);

  if (invitationAcceptMatch && request.method === "POST") {
    const invitation = await getInvitation(decodeURIComponent(invitationAcceptMatch[1]));
    assertInvitationUsable(invitation);
    const project = await getProject(invitation.projectId);

    if (!project) {
      sendJson(response, 404, { error: { code: ERROR_CODE.notFound, message: "项目不存在" } });
      return true;
    }

    await addProjectMember(invitation.projectId, {
      userId: authenticatedUser.id,
      name: authenticatedUser.name,
      role: invitation.role ?? PROJECT_MEMBER_ROLE.editor,
      invitedBy: invitation.createdBy,
    });
    await tryAppendAuditLog({
      actorUserId: authenticatedUser.id,
      projectId: invitation.projectId,
      action: "project.invitation.accept",
      targetType: "project_invitation",
      targetId: invitation.token,
      payload: {
        role: invitation.role ?? PROJECT_MEMBER_ROLE.editor,
      },
    });
    const updatedProject = await requireProjectAccess(invitation.projectId, authenticatedUser);
    sendJson(response, 200, {
      project: {
        ...serializeProjectSummary(updatedProject.project, authenticatedUser.id),
        currentUserRole: await getProjectRoleForUser(updatedProject.project, authenticatedUser),
      },
      invitation: serializeInvitation(invitation),
    });
    return true;
  }

  const projectAiConversationMatch = pathname.match(/^\/api\/projects\/([^/]+)\/ai\/conversation$/);

  if (projectAiConversationMatch && request.method === "GET") {
    const projectId = projectAiConversationMatch[1];
    await requireProjectAccess(projectId, authenticatedUser);
    const conversation = await getAIConversation(projectId, authenticatedUser.id);
    sendJson(response, 200, { messages: conversation.messages });
    return true;
  }

  if (projectAiConversationMatch && request.method === "DELETE") {
    const projectId = projectAiConversationMatch[1];
    await requireProjectAccess(projectId, authenticatedUser);
    await clearAIConversation(projectId, authenticatedUser.id);
    sendJson(response, 200, { success: true });
    return true;
  }

  const projectAiChatStreamMatch = pathname.match(/^\/api\/projects\/([^/]+)\/ai\/chat\/stream$/);

  if (projectAiChatStreamMatch && request.method === "POST") {
    const projectId = projectAiChatStreamMatch[1];
    const body = await readRequestBody(request);
    const { project } = await requireProjectAccess(projectId, authenticatedUser);
    const conversation = await getAIConversation(projectId, authenticatedUser.id);
    const { context } = await buildAssistantContext(project, body, conversation.messages);

    response.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });

    let streamedText = "";
    const reply = await streamAssistantReply(context, {
      onDelta(delta) {
        streamedText += delta;
        sendNdjsonChunk(response, { type: "delta", delta });
      },
    });

    sendNdjsonChunk(response, {
      type: "done",
      reply: {
        ...reply,
        answer: streamedText || reply.answer,
      },
    });
    await appendAIConversationExchange(
      projectId,
      authenticatedUser.id,
      { role: "user", content: body.message ?? "" },
      { role: "assistant", content: streamedText || reply.answer },
    );
    response.end();
    return true;
  }

  const projectAiExplainMatch = pathname.match(/^\/api\/projects\/([^/]+)\/ai\/explain$/);

  if (projectAiExplainMatch && request.method === "POST") {
    const projectId = projectAiExplainMatch[1];
    const body = await readRequestBody(request);
    const { project } = await requireProjectAccess(projectId, authenticatedUser);
    const conversation = await getAIConversation(projectId, authenticatedUser.id);
    const actionMessage = body.message ?? "请解释当前选中代码";
    const { context } = await buildAssistantContext(
      project,
      {
        ...body,
        message: actionMessage,
      },
      conversation.messages,
    );
    const reply = await generateExplainReply(context);
    await appendAIConversationExchange(
      projectId,
      authenticatedUser.id,
      { role: "user", content: actionMessage },
      { role: "assistant", content: reply.answer },
    );
    sendJson(response, 200, { reply });
    return true;
  }

  const projectAiCompletionMatch = pathname.match(/^\/api\/projects\/([^/]+)\/ai\/completion$/);

  if (projectAiCompletionMatch && request.method === "POST") {
    const projectId = projectAiCompletionMatch[1];
    const body = await readRequestBody(request);
    const { project } = await requireProjectAccess(projectId, authenticatedUser);
    const conversation = await getAIConversation(projectId, authenticatedUser.id);
    const { context } = await buildAssistantContext(
      project,
      {
        ...body,
        message: body.message ?? "请生成当前光标位置的 LaTeX inline completion",
      },
      conversation.messages,
    );
    const startedAt = Date.now();
    const result = await generateInlineCompletion(context);

    sendJson(response, 200, {
      completion: {
        text: result.completion,
        source: result.source,
        model: result.model,
        strategy: result.strategy,
        latencyMs: Date.now() - startedAt,
        warning: result.warning ?? null,
      },
    });
    return true;
  }

  const projectAiImproveMatch = pathname.match(/^\/api\/projects\/([^/]+)\/ai\/improve$/);

  if (projectAiImproveMatch && request.method === "POST") {
    const projectId = projectAiImproveMatch[1];
    const body = await readRequestBody(request);
    const { project } = await requireProjectAccess(projectId, authenticatedUser);
    const conversation = await getAIConversation(projectId, authenticatedUser.id);
    const actionMessage = body.message ?? "请优化当前选中代码";
    const { context } = await buildAssistantContext(
      project,
      {
        ...body,
        message: actionMessage,
      },
      conversation.messages,
    );
    const reply = await generateImproveReply(context);
    await appendAIConversationExchange(
      projectId,
      authenticatedUser.id,
      { role: "user", content: actionMessage },
      { role: "assistant", content: reply.answer },
    );
    sendJson(response, 200, { reply });
    return true;
  }

  const projectAiFixMatch = pathname.match(/^\/api\/projects\/([^/]+)\/ai\/fix$/);

  if (projectAiFixMatch && request.method === "POST") {
    const projectId = projectAiFixMatch[1];
    const body = await readRequestBody(request);
    const { project } = await requireProjectAccess(projectId, authenticatedUser);
    const conversation = await getAIConversation(projectId, authenticatedUser.id);
    const actionMessage = body.message ?? "请根据最近编译错误生成可直接应用的修复代码";
    const { context } = await buildAssistantContext(
      project,
      {
        ...body,
        message: actionMessage,
      },
      conversation.messages,
    );
    const reply = await generateFixReply(context);
    await appendAIConversationExchange(
      projectId,
      authenticatedUser.id,
      { role: "user", content: actionMessage },
      { role: "assistant", content: reply.answer },
    );
    sendJson(response, 200, { reply });
    return true;
  }

  const projectAiDiagnoseMatch = pathname.match(/^\/api\/projects\/([^/]+)\/ai\/diagnose$/);

  if (projectAiDiagnoseMatch && request.method === "POST") {
    const projectId = projectAiDiagnoseMatch[1];
    const body = await readRequestBody(request);
    const { project } = await requireProjectAccess(projectId, authenticatedUser);
    const conversation = await getAIConversation(projectId, authenticatedUser.id);
    const { context, latestCompileJob } = await buildAssistantContext(project, body, conversation.messages);

    if (!(context.recentCompileLog ?? "").trim()) {
      sendJson(response, 400, {
        error: { code: ERROR_CODE.badRequest, message: "当前没有可用于诊断的编译日志" },
      });
      return true;
    }

    const diagnosis = await generateDiagnosisResult({
      ...context,
      message: body.message ?? "请分析最近一次 LaTeX 编译错误并给出修复建议",
    });

    sendJson(response, 200, {
      diagnosis,
      compileStatus: latestCompileJob?.status ?? null,
    });
    return true;
  }

  const projectPaperPdfMatch = pathname.match(/^\/api\/projects\/([^/]+)\/papers\/([^/]+)\/pdf$/);

  if (projectPaperPdfMatch && request.method === "GET") {
    const projectId = projectPaperPdfMatch[1];
    const paperId = decodeURIComponent(projectPaperPdfMatch[2]);
    await requireProjectAccess(projectId, authenticatedUser);
    const cachedPdfPath = await ensurePaperPdfCached(paperId);
    response.writeHead(200, { "Content-Type": "application/pdf" });
    response.end(await fs.readFile(cachedPdfPath));
    return true;
  }

  const projectPaperHighlightsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/papers\/([^/]+)\/highlights$/);

  if (projectPaperHighlightsMatch && request.method === "GET") {
    const projectId = projectPaperHighlightsMatch[1];
    const paperId = decodeURIComponent(projectPaperHighlightsMatch[2]);
    await requireProjectAccess(projectId, authenticatedUser);
    sendJson(response, 200, {
      highlights: await listProjectPaperHighlights(projectId, paperId),
    });
    return true;
  }

  if (projectPaperHighlightsMatch && request.method === "POST") {
    const projectId = projectPaperHighlightsMatch[1];
    const paperId = decodeURIComponent(projectPaperHighlightsMatch[2]);
    await requireProjectAccess(projectId, authenticatedUser, { permission: PROJECT_PERMISSION.comment });
    const body = await readRequestBody(request);
    const highlight = await createProjectPaperHighlight(projectId, {
      paperId,
      content: body.content ?? {},
      comment: body.comment ?? {},
      position: body.position ?? {},
      authorUserId: authenticatedUser.id,
      authorName: authenticatedUser.name,
    });
    await tryAppendAuditLog({
      actorUserId: authenticatedUser.id,
      projectId,
      action: "paper.highlight.create",
      targetType: "paper_highlight",
      targetId: highlight.id,
      payload: {
        paperId,
        pageNumber: highlight.position.pageNumber,
      },
    });
    await tryAppendVersionEvent({
      projectId,
      actorUserId: authenticatedUser.id,
      eventType: "paper_highlight_created",
      payload: {
        paperId,
        highlightId: highlight.id,
        pageNumber: highlight.position.pageNumber,
      },
    });
    sendJson(response, 201, { highlight });
    return true;
  }

  const projectPaperHighlightDetailMatch = pathname.match(
    /^\/api\/projects\/([^/]+)\/papers\/([^/]+)\/highlights\/([^/]+)$/,
  );

  if (projectPaperHighlightDetailMatch && request.method === "PATCH") {
    const projectId = projectPaperHighlightDetailMatch[1];
    const paperId = decodeURIComponent(projectPaperHighlightDetailMatch[2]);
    const highlightId = decodeURIComponent(projectPaperHighlightDetailMatch[3]);
    await requireProjectAccess(projectId, authenticatedUser, { permission: PROJECT_PERMISSION.comment });
    const body = await readRequestBody(request);
    const highlight = await updateProjectPaperHighlight(projectId, paperId, highlightId, {
      comment: body.comment ?? {},
      content: body.content ?? {},
    });
    await tryAppendAuditLog({
      actorUserId: authenticatedUser.id,
      projectId,
      action: "paper.highlight.update",
      targetType: "paper_highlight",
      targetId: highlight.id,
      payload: {
        paperId,
      },
    });
    sendJson(response, 200, { highlight });
    return true;
  }

  if (projectPaperHighlightDetailMatch && request.method === "DELETE") {
    const projectId = projectPaperHighlightDetailMatch[1];
    const paperId = decodeURIComponent(projectPaperHighlightDetailMatch[2]);
    const highlightId = decodeURIComponent(projectPaperHighlightDetailMatch[3]);
    await requireProjectAccess(projectId, authenticatedUser, { permission: PROJECT_PERMISSION.comment });
    const highlight = await deleteProjectPaperHighlight(projectId, paperId, highlightId);
    await tryAppendAuditLog({
      actorUserId: authenticatedUser.id,
      projectId,
      action: "paper.highlight.delete",
      targetType: "paper_highlight",
      targetId: highlight.id,
      payload: {
        paperId,
      },
    });
    sendJson(response, 200, { highlight, success: true });
    return true;
  }

  const projectPaperDetailMatch = pathname.match(/^\/api\/projects\/([^/]+)\/papers\/([^/]+)$/);

  if (projectPaperDetailMatch && request.method === "GET") {
    const projectId = projectPaperDetailMatch[1];
    const paperId = decodeURIComponent(projectPaperDetailMatch[2]);
    await requireProjectAccess(projectId, authenticatedUser);
    sendJson(response, 200, {
      paper: await loadPaperDetails(paperId, Number(searchParams.get("maxChars") ?? 18000)),
    });
    return true;
  }

  const projectFileMatch = pathname.match(/^\/api\/projects\/([^/]+)\/file$/);

  if (projectFileMatch && request.method === "GET") {
    await requireProjectAccess(projectFileMatch[1], authenticatedUser);
    const filePath = searchParams.get("path") ?? "";
    sendJson(response, 200, await readProjectFile(projectFileMatch[1], filePath));
    return true;
  }

  if (projectFileMatch && request.method === "PUT") {
    await requireProjectAccess(projectFileMatch[1], authenticatedUser);
    const filePath = searchParams.get("path") ?? "";
    const body = await readRequestBody(request);
    const updatedFile = await updateProjectFile(projectFileMatch[1], filePath, body.content ?? "");
    await tryAppendAuditLog({
      actorUserId: authenticatedUser.id,
      projectId: projectFileMatch[1],
      action: "file.update",
      targetType: "file",
      targetId: updatedFile.path,
      payload: {},
    });
    await tryAppendVersionEvent({
      projectId: projectFileMatch[1],
      actorUserId: authenticatedUser.id,
      filePath: updatedFile.path,
      eventType: "file_updated",
      payload: {},
    });
    sendJson(response, 200, {
      file: updatedFile,
    });
    return true;
  }

  if (projectFileMatch && request.method === "POST") {
    await requireProjectAccess(projectFileMatch[1], authenticatedUser);
    const body = await readRequestBody(request);
    const createdFile = await createProjectFile(projectFileMatch[1], body.path ?? "", body.content ?? "");
    await tryAppendAuditLog({
      actorUserId: authenticatedUser.id,
      projectId: projectFileMatch[1],
      action: "file.create",
      targetType: "file",
      targetId: createdFile.path,
      payload: {},
    });
    await tryAppendVersionEvent({
      projectId: projectFileMatch[1],
      actorUserId: authenticatedUser.id,
      filePath: createdFile.path,
      eventType: "file_created",
      payload: {},
    });
    sendJson(response, 201, {
      file: createdFile,
    });
    return true;
  }

  const projectDirectoryMatch = pathname.match(/^\/api\/projects\/([^/]+)\/directory$/);

  if (projectDirectoryMatch && request.method === "POST") {
    await requireProjectAccess(projectDirectoryMatch[1], authenticatedUser);
    const body = await readRequestBody(request);
    const directory = await createProjectDirectory(projectDirectoryMatch[1], body.path ?? "");
    await tryAppendAuditLog({
      actorUserId: authenticatedUser.id,
      projectId: projectDirectoryMatch[1],
      action: "directory.create",
      targetType: "directory",
      targetId: directory.path,
      payload: {},
    });
    sendJson(response, 201, {
      directory,
    });
    return true;
  }

  const projectMoveMatch = pathname.match(/^\/api\/projects\/([^/]+)\/move$/);

  if (projectMoveMatch && request.method === "POST") {
    await requireProjectAccess(projectMoveMatch[1], authenticatedUser);
    const body = await readRequestBody(request);
    const move = await moveProjectEntry(projectMoveMatch[1], body.fromPath ?? "", body.toPath ?? "");
    await tryAppendAuditLog({
      actorUserId: authenticatedUser.id,
      projectId: projectMoveMatch[1],
      action: "entry.move",
      targetType: "entry",
      targetId: move.toPath,
      payload: move,
    });
    await tryAppendVersionEvent({
      projectId: projectMoveMatch[1],
      actorUserId: authenticatedUser.id,
      filePath: move.toPath,
      eventType: "entry_moved",
      payload: move,
    });
    sendJson(response, 200, {
      move,
    });
    return true;
  }

  const projectEntryMatch = pathname.match(/^\/api\/projects\/([^/]+)\/entry$/);

  if (projectEntryMatch && request.method === "DELETE") {
    await requireProjectAccess(projectEntryMatch[1], authenticatedUser);
    const entryPath = searchParams.get("path") ?? "";
    await deleteProjectEntry(projectEntryMatch[1], entryPath);
    await tryAppendAuditLog({
      actorUserId: authenticatedUser.id,
      projectId: projectEntryMatch[1],
      action: "entry.delete",
      targetType: "entry",
      targetId: entryPath,
      payload: {},
    });
    await tryAppendVersionEvent({
      projectId: projectEntryMatch[1],
      actorUserId: authenticatedUser.id,
      filePath: entryPath,
      eventType: "entry_deleted",
      payload: {},
    });
    sendJson(response, 200, { success: true });
    return true;
  }

  const projectCompileMatch = pathname.match(/^\/api\/projects\/([^/]+)\/compile$/);

  if (projectCompileMatch && request.method === "POST") {
    const { project } = await requireProjectAccess(projectCompileMatch[1], authenticatedUser);

    if (!project) {
      sendJson(response, 404, { error: { code: ERROR_CODE.notFound, message: "项目不存在" } });
      return true;
    }

    const job = await createCompileJob(projectCompileMatch[1], {
      rootFile: project.rootFile,
      compileEngine: project.compileEngine ?? DEFAULT_COMPILE_ENGINE,
    });
    await tryAppendAuditLog({
      actorUserId: authenticatedUser.id,
      projectId: projectCompileMatch[1],
      action: "compile.requested",
      targetType: "compile_job",
      targetId: job.id,
      payload: {
        rootFile: job.rootFile,
        compileEngine: job.compileEngine,
      },
    });
    await tryAppendVersionEvent({
      projectId: projectCompileMatch[1],
      actorUserId: authenticatedUser.id,
      filePath: job.rootFile,
      eventType: "compile_requested",
      payload: {
        jobId: job.id,
        compileEngine: job.compileEngine,
      },
    });
    sendJson(response, 202, {
      job: normalizeCompileJob(job),
    });
    return true;
  }

  const restoreSnapshotMatch = pathname.match(/^\/api\/projects\/([^/]+)\/snapshots\/([^/]+)\/restore$/);

  if (restoreSnapshotMatch && request.method === "POST") {
    await requireProjectAccess(restoreSnapshotMatch[1], authenticatedUser);
    const restoreResult = await restoreSnapshot(restoreSnapshotMatch[1], restoreSnapshotMatch[2]);
    await tryAppendAuditLog({
      actorUserId: authenticatedUser.id,
      projectId: restoreSnapshotMatch[1],
      action: "snapshot.restore",
      targetType: "snapshot",
      targetId: restoreSnapshotMatch[2],
      payload: restoreResult,
    });
    await tryAppendVersionEvent({
      projectId: restoreSnapshotMatch[1],
      actorUserId: authenticatedUser.id,
      eventType: "snapshot_restored",
      snapshotId: restoreSnapshotMatch[2],
      payload: restoreResult,
    });
    sendJson(response, 200, restoreResult);
    return true;
  }

  const compileJobMatch = pathname.match(/^\/api\/compile\/([^/]+)$/);

  if (compileJobMatch && request.method === "GET") {
    const job = await getCompileJob(compileJobMatch[1]);

    if (!job) {
      sendJson(response, 404, { error: { code: ERROR_CODE.notFound, message: "编译任务不存在" } });
      return true;
    }

    await requireProjectAccess(job.projectId, authenticatedUser);
    sendJson(response, 200, { job: normalizeCompileJob(job) });
    return true;
  }

  const compilePdfMatch = pathname.match(/^\/api\/compile\/([^/]+)\/pdf$/);

  if (compilePdfMatch && request.method === "GET") {
    const job = await getCompileJob(compilePdfMatch[1]);

    if (!job || !job.pdfFilePath || !(await fileExists(job.pdfFilePath))) {
      sendJson(response, 404, { error: { code: ERROR_CODE.notFound, message: "PDF 结果不存在" } });
      return true;
    }

    await requireProjectAccess(job.projectId, authenticatedUser);
    response.writeHead(200, { "Content-Type": "application/pdf" });
    response.end(await fs.readFile(job.pdfFilePath));
    return true;
  }

  return false;
}

export async function createRequestHandler(request, response) {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const handled = await handleApiRequest(request, response, url);

    if (handled) {
      return;
    }

    if (request.method !== "GET") {
      sendJson(response, 404, { error: { code: ERROR_CODE.notFound, message: "接口不存在" } });
      return;
    }

    await serveStaticFile(response, url.pathname);
  } catch (error) {
    sendError(response, error);
  }
}

export async function startServer({ port = process.env.PORT ?? DEFAULT_PORT, bindHost = host } = {}) {
  const listenPort = resolveServerPort(port);
  await bootstrapStorage();
  const collaborationServer = createCollaborationServer();
  setInterval(() => {
    void runAutoCheckpointCycle().catch((error) => {
      console.error("Auto checkpoint scan failed:", error);
    });
  }, autoCheckpointScanIntervalMs);
  const server = http.createServer((request, response) => {
    void createRequestHandler(request, response);
  });
  server.on("upgrade", (request, socket, head) => {
    void collaborationServer.handleUpgrade(request, socket, head);
  });

  return new Promise((resolve) => {
    server.listen(listenPort, bindHost, () => {
      console.log(`API server listening on http://${bindHost}:${listenPort}`);
      resolve(server);
    });
  });
}

if (isMainModule) {
  await startServer();
}

/*
 * Code Review:
 * - 当前服务端坚持零依赖实现，成员与邀请也继续复用同一进程，优先保证产品闭环而不是过早拆微服务。
 * - 路由仍是显式 if/regex 分发，适合当前规模；若接口继续增长，应尽快拆分路由模块。
 * - 项目访问控制统一收敛在 API 与协作入口，避免“HTTP 拦住了但 WebSocket 能绕过”的权限裂缝。
 * - 静态资源与 API 同进程托管降低了部署复杂度，但高并发阶段应拆出独立前端服务或 CDN。
 * - 自动检查点扫描挂在 API 进程内，适合当前单实例阶段；后续多实例部署时应迁移到独立调度器。
 */
