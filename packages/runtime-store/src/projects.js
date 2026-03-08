/*
 * File: projects.js
 * Module: packages/runtime-store (项目仓储)
 *
 * Responsibility:
 *   - 以文件化方式保存项目元数据、脏状态和项目目录内容。
 *   - 为 API、Worker 和快照模块提供统一的项目读取、写入、移动、删除能力。
 *
 * Runtime Logic Overview:
 *   1. API 服务通过本仓储创建项目并维护文件树。
 *   2. Worker 通过本仓储读取项目根目录和主入口文件信息。
 *   3. 快照模块通过本仓储读取项目状态并同步脏状态、恢复状态。
 *
 * Key Data Flow:
 *   - 输入：项目名、文件路径、文件内容、移动与删除操作、项目状态更新。
 *   - 输出：项目元数据、目录树、文本文件内容和项目运行时状态。
 *
 * Future Extension:
 *   - 可替换为 PostgreSQL 元数据 + 对象存储实现。
 *   - 可继续增加更细粒度角色、版本索引和项目级设置字段。
 *   - 当前已经支持个人 / 组织 / 团队工作空间归属，后续可进一步切到结构化项目表。
 *
 * Dependencies:
 *   - node:crypto
 *   - node:fs/promises
 *   - node:path
 *   - packages/contracts
 *   - packages/runtime-store/storage
 *   - packages/shared
 *
 * Last Updated:
 *   - 2026-03-08 by Codex - 将项目 manifest 更新切到原子 patch，修复并发写覆盖风险
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_COMPILE_ENGINE,
  DEFAULT_MAIN_FILE,
  PROJECT_PERMISSION,
  PROJECT_MEMBER_ROLE,
  TEXT_FILE_EXTENSIONS,
  hasProjectPermission,
  isSupportedCompileEngine,
} from "../../contracts/src/index.js";
import {
  ensureDir,
  resolveInside,
  sanitizeRelativePath,
} from "../../shared/src/fs.js";
import {
  getCollaborationProjectRoot,
  getCollaborationFileStatePath,
  getProjectRoot,
  runtimeDataRoot,
} from "../../shared/src/paths.js";
import {
  blobExists,
  ensureBlobDirectory,
  readTextBlob,
  removeBlob,
  writeTextBlob,
} from "./storage/blob-store.js";
import {
  getOrganizationById,
  getOrganizationMembership,
  getTeamById,
  getTeamMembership,
} from "./organizations.js";
import { ensureMetadataStorage, getMetadataStore } from "./storage/metadata-store.js";

const projectsManifestPath = path.join(runtimeDataRoot, "projects.json");
const projectsNamespace = "projects";

function createMainFileTemplate(projectName) {
  return [
    "\\documentclass{article}",
    "",
    "\\title{" + projectName + "}",
    "\\author{Overleaf Clone MVP}",
    "\\date{\\today}",
    "",
    "\\begin{document}",
    "\\maketitle",
    "",
    "Hello, Overleaf Clone MVP.",
    "",
    "\\end{document}",
    "",
  ].join("\n");
}

function normalizeInitialProjectFiles(projectName, options = {}) {
  const providedFiles = Array.isArray(options.initialFiles) ? options.initialFiles : [];

  if (providedFiles.length === 0) {
    return [
      {
        path: DEFAULT_MAIN_FILE,
        content: createMainFileTemplate(projectName),
      },
    ];
  }

  const uniquePaths = new Set();

  return providedFiles.map((file) => {
    const safePath = sanitizeRelativePath(String(file.path ?? ""));
    assertTextFilePath(safePath);

    if (uniquePaths.has(safePath)) {
      throw new Error(`模板文件路径重复：${safePath}`);
    }

    uniquePaths.add(safePath);

    return {
      path: safePath,
      content: String(file.content ?? ""),
    };
  });
}

function collectProjectEntriesForFiles(files, timestamp) {
  const directoryPaths = new Set();

  for (const file of files) {
    const segments = file.path.split("/");
    let currentPath = "";

    for (const segment of segments.slice(0, -1)) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      directoryPaths.add(currentPath);
    }
  }

  const directoryEntries = [...directoryPaths]
    .sort((left, right) => left.localeCompare(right))
    .map((directoryPath) => createProjectEntry(directoryPath, "directory", timestamp));
  const fileEntries = files.map((file) => createProjectEntry(file.path, "file", timestamp));

  return [...directoryEntries, ...fileEntries];
}

function resolveInitialRootFile(initialFiles, options = {}) {
  const explicitRootFile = options.rootFile ? sanitizeRelativePath(String(options.rootFile)) : null;

  if (explicitRootFile) {
    const matchedFile = initialFiles.find((file) => file.path === explicitRootFile) ?? null;

    if (!matchedFile) {
      throw new Error("模板主文件不存在");
    }

    if (!isTexFilePath(explicitRootFile)) {
      throw new Error("主编译文件必须是 .tex 文件");
    }

    return explicitRootFile;
  }

  const firstTexFile = initialFiles.find((file) => isTexFilePath(file.path)) ?? null;
  return firstTexFile?.path ?? DEFAULT_MAIN_FILE;
}

function createDefaultDirtyState() {
  return {
    isDirty: false,
    dirtySince: null,
    lastEditedAt: null,
    lastSnapshotAt: null,
    lastSnapshotType: null,
  };
}

function normalizeProjectMember(member, fallbackJoinedAt) {
  const rawRole = member.role ?? PROJECT_MEMBER_ROLE.editor;
  const normalizedRole = rawRole === "collaborator" ? PROJECT_MEMBER_ROLE.editor : rawRole;

  return {
    userId: member.userId,
    name: member.name ?? "未知成员",
    role: normalizedRole,
    joinedAt: member.joinedAt ?? fallbackJoinedAt ?? new Date().toISOString(),
    invitedBy: member.invitedBy ?? null,
  };
}

function normalizeProjectEntry(entry, fallbackCreatedAt) {
  const normalizedType = entry.type === "directory" ? "directory" : "file";

  return {
    id: entry.id ?? crypto.randomUUID(),
    path: sanitizeRelativePath(entry.path),
    type: normalizedType,
    createdAt: entry.createdAt ?? fallbackCreatedAt ?? new Date().toISOString(),
    updatedAt: entry.updatedAt ?? entry.createdAt ?? fallbackCreatedAt ?? new Date().toISOString(),
  };
}

function createProjectEntry(relativePath, type, timestamp = new Date().toISOString()) {
  return normalizeProjectEntry(
    {
      id: crypto.randomUUID(),
      path: relativePath,
      type,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    timestamp,
  );
}

function normalizeProjectEntries(project) {
  const fallbackCreatedAt = project.createdAt ?? new Date().toISOString();
  const entries = Array.isArray(project.entries)
    ? project.entries.map((entry) => normalizeProjectEntry(entry, fallbackCreatedAt))
    : [];

  if (!entries.some((entry) => entry.path === DEFAULT_MAIN_FILE && entry.type === "file")) {
    entries.unshift(createProjectEntry(DEFAULT_MAIN_FILE, "file", fallbackCreatedAt));
  }

  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function normalizeProjectMembers(project) {
  const fallbackJoinedAt = project.createdAt ?? new Date().toISOString();
  const members = Array.isArray(project.members)
    ? project.members.map((member) => normalizeProjectMember(member, fallbackJoinedAt))
    : [];

  if (project.ownerId && !members.some((member) => member.userId === project.ownerId)) {
    members.unshift(
      normalizeProjectMember(
        {
          userId: project.ownerId,
          name: project.ownerName ?? "项目所有者",
          role: PROJECT_MEMBER_ROLE.owner,
          joinedAt: project.createdAt,
        },
        fallbackJoinedAt,
      ),
    );
  }

  return members;
}

function normalizeProject(project) {
  const members = normalizeProjectMembers(project);
  const ownerMember = members.find((member) => member.role === PROJECT_MEMBER_ROLE.owner) ?? null;

  return {
    ...project,
    rootFile: project.rootFile ?? DEFAULT_MAIN_FILE,
    compileEngine: project.compileEngine ?? DEFAULT_COMPILE_ENGINE,
    ownerId: project.ownerId ?? ownerMember?.userId ?? null,
    ownerName: project.ownerName ?? ownerMember?.name ?? null,
    workspaceType: project.workspaceType ?? "personal",
    organizationId: project.organizationId ?? null,
    teamId: project.teamId ?? null,
    workspaceName: project.workspaceName ?? null,
    entries: normalizeProjectEntries(project),
    members,
    dirtyState: {
      ...createDefaultDirtyState(),
      ...(project.dirtyState ?? {}),
    },
  };
}

async function readProjectsManifest() {
  const store = await getMetadataStore();
  const projects = await store.readManifest({
    namespace: projectsNamespace,
    filePath: projectsManifestPath,
    fallbackValue: [],
  });
  return projects.map(normalizeProject);
}

async function writeProjectsManifest(projects) {
  const store = await getMetadataStore();
  await store.writeManifest({
    namespace: projectsNamespace,
    filePath: projectsManifestPath,
    value: projects.map(normalizeProject),
  });
}

async function patchProjectsManifestAtomically(transform, fallbackValue = []) {
  const store = await getMetadataStore();
  const result = await store.patchRecordAtomically({
    namespace: projectsNamespace,
    key: "__manifest__",
    filePath: projectsManifestPath,
    fallbackValue,
    transform(currentProjects) {
      const normalizedProjects = Array.isArray(currentProjects) ? currentProjects.map(normalizeProject) : [];
      const nextProjects = transform(normalizedProjects);

      if (nextProjects === undefined) {
        return undefined;
      }

      return nextProjects.map(normalizeProject);
    },
  });

  return Array.isArray(result.value) ? result.value.map(normalizeProject) : [];
}

function assertTextFilePath(relativePath) {
  const extension = path.extname(relativePath).toLowerCase();

  if (!TEXT_FILE_EXTENSIONS.has(extension)) {
    throw new Error("当前 MVP 仅支持编辑文本文件");
  }
}

function isTexFilePath(relativePath) {
  return path.extname(relativePath).toLowerCase() === ".tex";
}

function remapRelativePathByMove(targetPath, fromPath, toPath) {
  if (targetPath === fromPath) {
    return toPath;
  }

  if (targetPath.startsWith(`${fromPath}/`)) {
    return `${toPath}${targetPath.slice(fromPath.length)}`;
  }

  return targetPath;
}

async function assertCompilableRootFile(projectId, relativePath) {
  const safeRelativePath = sanitizeRelativePath(relativePath);

  if (!isTexFilePath(safeRelativePath)) {
    throw new Error("主编译文件必须是 .tex 文件");
  }

  const absolutePath = resolveInside(getProjectRoot(projectId), safeRelativePath);

  if (!(await blobExists(absolutePath))) {
    throw new Error("主编译文件不存在");
  }

  const targetStat = await fs.stat(absolutePath);

  if (!targetStat.isFile()) {
    throw new Error("主编译文件必须是普通文件");
  }

  return safeRelativePath;
}

function normalizeCompileEngine(engine) {
  const normalizedEngine = String(engine ?? "").trim().toLowerCase();

  if (!isSupportedCompileEngine(normalizedEngine)) {
    throw new Error("编译引擎不受支持");
  }

  return normalizedEngine;
}

function applyProjectUpdate(project, update) {
  if (!update) {
    return project;
  }

  return normalizeProject({
    ...project,
    ...update,
    entries: update.entries ?? project.entries,
    members: update.members ?? project.members,
    dirtyState: update.dirtyState
      ? {
          ...project.dirtyState,
          ...update.dirtyState,
        }
      : project.dirtyState,
  });
}

async function updateProjectRecord(projectId, updater) {
  let matchedProject = null;
  await patchProjectsManifestAtomically((projects) =>
    projects.map((project) => {
      if (project.id !== projectId) {
        return project;
      }

      const nextProject = applyProjectUpdate(project, updater(project));
      matchedProject = nextProject;
      return nextProject;
    }),
  );

  if (!matchedProject) {
    throw new Error("项目不存在");
  }

  return matchedProject;
}

export async function ensureProjectStorage() {
  await ensureMetadataStorage();
  const store = await getMetadataStore();
  const existing = await store.readManifest({
    namespace: projectsNamespace,
    filePath: projectsManifestPath,
    fallbackValue: null,
  });

  if (!existing) {
    await writeProjectsManifest([]);
  }
}

export async function listProjects() {
  await ensureProjectStorage();
  const projects = await readProjectsManifest();
  return projects.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function getProject(projectId) {
  const projects = await listProjects();
  return projects.find((project) => project.id === projectId) ?? null;
}

function createOwnerMembership(ownerUser, timestamp) {
  return normalizeProjectMember(
    {
      userId: ownerUser.id,
      name: ownerUser.name,
      role: PROJECT_MEMBER_ROLE.owner,
      joinedAt: timestamp,
    },
    timestamp,
  );
}

async function adoptLegacyProjectOwnership(projectId, ownerUser) {
  const project = await getProject(projectId);

  if (!project) {
    throw new Error("项目不存在");
  }

  if (project.ownerId || (project.members ?? []).length > 0) {
    return project;
  }

  const ownerMembership = createOwnerMembership(ownerUser, project.createdAt ?? new Date().toISOString());
  return updateProjectRecord(projectId, () => ({
    ownerId: ownerUser.id,
    ownerName: ownerUser.name,
    members: [ownerMembership],
  }));
}

async function resolveWorkspaceBindingForCreate(ownerUser, options = {}) {
  const workspaceType = String(options.workspaceType ?? "personal").trim().toLowerCase();

  if (workspaceType === "personal") {
    return {
      workspaceType: "personal",
      organizationId: null,
      teamId: null,
      workspaceName: ownerUser.name,
    };
  }

  if (workspaceType === "organization") {
    if (!options.organizationId) {
      throw new Error("创建组织空间项目时必须提供 organizationId");
    }

    const organization = await getOrganizationById(options.organizationId);

    if (!organization) {
      throw new Error("组织不存在");
    }

    const membership = await getOrganizationMembership(organization.id, ownerUser.id);

    if (!membership) {
      throw new Error("你不是该组织成员，不能在组织空间创建项目");
    }

    return {
      workspaceType,
      organizationId: organization.id,
      teamId: null,
      workspaceName: organization.name,
    };
  }

  if (workspaceType === "team") {
    if (!options.teamId) {
      throw new Error("创建团队空间项目时必须提供 teamId");
    }

    const team = await getTeamById(options.teamId);

    if (!team) {
      throw new Error("团队不存在");
    }

    const membership = await getTeamMembership(team.id, ownerUser.id);

    if (!membership) {
      throw new Error("你不是该团队成员，不能在团队空间创建项目");
    }

    return {
      workspaceType,
      organizationId: team.organizationId,
      teamId: team.id,
      workspaceName: team.name,
    };
  }

  throw new Error("项目工作空间类型不受支持");
}

function deriveWorkspaceProjectRole(project, organizationMembership, teamMembership) {
  if (project.workspaceType === "team" && teamMembership) {
    return PROJECT_MEMBER_ROLE.editor;
  }

  if (project.workspaceType === "organization" && organizationMembership) {
    return organizationMembership.role === "billing_viewer"
      ? PROJECT_MEMBER_ROLE.viewer
      : PROJECT_MEMBER_ROLE.editor;
  }

  return null;
}

async function resolveProjectAccess(project, user) {
  const directMember = findProjectMember(project, user.id);

  if (directMember) {
    return {
      role: directMember.role,
      member: directMember,
      source: "project_member",
    };
  }

  let organizationMembership = null;
  let teamMembership = null;

  try {
    organizationMembership =
      project.organizationId && project.workspaceType !== "personal"
        ? await getOrganizationMembership(project.organizationId, user.id)
        : null;
    teamMembership =
      project.teamId && project.workspaceType === "team" ? await getTeamMembership(project.teamId, user.id) : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (!message.includes("平台数据库未配置")) {
      throw error;
    }
  }

  const workspaceRole = deriveWorkspaceProjectRole(project, organizationMembership, teamMembership);

  if (!workspaceRole) {
    return null;
  }

  return {
    role: workspaceRole,
    member: normalizeProjectMember(
      {
        userId: user.id,
        name: user.name,
        role: workspaceRole,
        joinedAt: teamMembership?.createdAt ?? organizationMembership?.createdAt ?? new Date().toISOString(),
        invitedBy: null,
      },
      project.createdAt,
    ),
    source: project.workspaceType === "team" ? "team_workspace" : "organization_workspace",
    organizationMembership,
    teamMembership,
  };
}

async function scanProjectEntriesFromFileSystem(projectId) {
  const projectRoot = getProjectRoot(projectId);
  const entries = [];

  async function walk(currentDirectory) {
    if (!(await blobExists(currentDirectory))) {
      return;
    }

    const directoryEntries = await fs.readdir(currentDirectory, { withFileTypes: true });

    for (const directoryEntry of directoryEntries.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolutePath = path.join(currentDirectory, directoryEntry.name);
      const relativePath = path.relative(projectRoot, absolutePath).replaceAll(path.sep, "/");

      if (!relativePath) {
        continue;
      }

      if (directoryEntry.isDirectory()) {
        entries.push({ path: relativePath, type: "directory" });
        await walk(absolutePath);
        continue;
      }

      entries.push({ path: relativePath, type: "file" });
    }
  }

  await walk(projectRoot);
  return entries;
}

function areProjectEntriesEquivalent(leftEntries, rightEntries) {
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }

  return leftEntries.every((leftEntry, index) => {
    const rightEntry = rightEntries[index];
    return (
      leftEntry.id === rightEntry.id &&
      leftEntry.path === rightEntry.path &&
      leftEntry.type === rightEntry.type
    );
  });
}

async function synchronizeProjectEntries(projectId) {
  const project = await getProject(projectId);

  if (!project) {
    throw new Error("项目不存在");
  }

  const scannedEntries = await scanProjectEntriesFromFileSystem(projectId);
  const existingEntriesByPath = new Map((project.entries ?? []).map((entry) => [entry.path, entry]));
  const timestamp = new Date().toISOString();
  const nextEntries = scannedEntries.map((scannedEntry) => {
    const existingEntry = existingEntriesByPath.get(scannedEntry.path);

    if (existingEntry && existingEntry.type === scannedEntry.type) {
      return existingEntry;
    }

    return createProjectEntry(scannedEntry.path, scannedEntry.type, timestamp);
  });

  if (!areProjectEntriesEquivalent(project.entries ?? [], nextEntries)) {
    return updateProjectRecord(projectId, () => ({
      entries: nextEntries,
    }));
  }

  return project;
}

function buildTreeFromEntries(entries) {
  const rootNodes = [];
  const directoryMap = new Map();

  function ensureDirectoryNode(relativePath) {
    const existing = directoryMap.get(relativePath);

    if (existing) {
      return existing;
    }

    const directoryNode = {
      id: entries.find((entry) => entry.path === relativePath && entry.type === "directory")?.id ?? crypto.randomUUID(),
      type: "directory",
      name: path.posix.basename(relativePath),
      path: relativePath,
      children: [],
    };

    directoryMap.set(relativePath, directoryNode);
    const parentPath = path.posix.dirname(relativePath);

    if (!parentPath || parentPath === ".") {
      rootNodes.push(directoryNode);
      return directoryNode;
    }

    const parentNode = ensureDirectoryNode(parentPath);
    parentNode.children.push(directoryNode);
    return directoryNode;
  }

  for (const entry of entries) {
    if (entry.type === "directory") {
      ensureDirectoryNode(entry.path);
      continue;
    }

    const fileNode = {
      id: entry.id,
      type: "file",
      name: path.posix.basename(entry.path),
      path: entry.path,
    };
    const parentPath = path.posix.dirname(entry.path);

    if (!parentPath || parentPath === ".") {
      rootNodes.push(fileNode);
      continue;
    }

    const parentNode = ensureDirectoryNode(parentPath);
    parentNode.children.push(fileNode);
  }

  function sortNodes(nodes) {
    nodes.sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === "directory" ? -1 : 1;
      }

      return left.path.localeCompare(right.path);
    });

    for (const node of nodes) {
      if (node.type === "directory") {
        sortNodes(node.children);
      }
    }
  }

  sortNodes(rootNodes);
  return rootNodes;
}

function findProjectEntryByPath(project, relativePath) {
  return (project.entries ?? []).find((entry) => entry.path === relativePath) ?? null;
}

function findProjectEntryById(project, entryId) {
  return (project.entries ?? []).find((entry) => entry.id === entryId) ?? null;
}

export async function createProject(projectName, ownerUser, options = {}) {
  const trimmedName = projectName.trim();

  if (!trimmedName) {
    throw new Error("项目名不能为空");
  }

  if (!ownerUser?.id || !ownerUser?.name) {
    throw new Error("项目所有者信息不完整");
  }

  await ensureProjectStorage();
  const now = new Date().toISOString();
  const ownerMembership = createOwnerMembership(ownerUser, now);
  const workspaceBinding = await resolveWorkspaceBindingForCreate(ownerUser, options);
  const initialFiles = normalizeInitialProjectFiles(trimmedName, options);
  const rootFile = resolveInitialRootFile(initialFiles, options);
  const compileEngine = options.compileEngine
    ? normalizeCompileEngine(options.compileEngine)
    : DEFAULT_COMPILE_ENGINE;
  const project = normalizeProject({
    id: crypto.randomUUID(),
    name: trimmedName,
    rootFile,
    compileEngine,
    ownerId: ownerUser.id,
    ownerName: ownerUser.name,
    workspaceType: workspaceBinding.workspaceType,
    organizationId: workspaceBinding.organizationId,
    teamId: workspaceBinding.teamId,
    workspaceName: workspaceBinding.workspaceName,
    entries: collectProjectEntriesForFiles(initialFiles, now),
    members: [ownerMembership],
    createdAt: now,
    updatedAt: now,
  });

  await patchProjectsManifestAtomically((projects) => [...projects, project]);

  const projectRoot = getProjectRoot(project.id);
  await ensureBlobDirectory(projectRoot);

  for (const file of initialFiles) {
    await writeTextBlob(path.join(projectRoot, file.path), file.content);
  }

  return project;
}

function findProjectMember(project, userId) {
  return (project.members ?? []).find((member) => member.userId === userId) ?? null;
}

export async function listProjectsForUser(user) {
  const projects = await listProjects();
  const visibleProjects = [];

  for (const project of projects) {
    const hydratedProject =
      !project.ownerId && (project.members ?? []).length === 0
        ? await adoptLegacyProjectOwnership(project.id, user)
        : project;

    const access = await resolveProjectAccess(hydratedProject, user);

    if (access) {
      visibleProjects.push(hydratedProject);
    }
  }

  return visibleProjects;
}

export async function resolveProjectEntryById(projectId, entryId) {
  const synchronizedProject = await synchronizeProjectEntries(projectId);
  return findProjectEntryById(synchronizedProject, entryId);
}

export async function requireProjectAccess(projectId, user, { roles, permission } = {}) {
  const project = await getProject(projectId);

  if (!project) {
    throw new Error("项目不存在");
  }

  const hydratedProject =
    !project.ownerId && (project.members ?? []).length === 0
      ? await adoptLegacyProjectOwnership(projectId, user)
      : project;
  const access = await resolveProjectAccess(hydratedProject, user);

  if (!access) {
    throw new Error("你没有访问该项目的权限");
  }

  if (Array.isArray(roles) && roles.length > 0 && !roles.includes(access.role)) {
    throw new Error("你没有执行该操作的权限");
  }

  if (permission && !hasProjectPermission(access.role, permission)) {
    throw new Error("你没有执行该操作的权限");
  }

  return {
    project: hydratedProject,
    member: access.member,
    accessSource: access.source,
  };
}

export async function getProjectRoleForUser(project, user) {
  const access = await resolveProjectAccess(project, user);
  return access?.role ?? null;
}

export async function listProjectMembers(projectId) {
  const project = await getProject(projectId);

  if (!project) {
    throw new Error("项目不存在");
  }

  return project.members ?? [];
}

export async function getProjectCompileSettings(projectId) {
  const project = await getProject(projectId);

  if (!project) {
    throw new Error("项目不存在");
  }

  return {
    rootFile: project.rootFile,
    compileEngine: project.compileEngine ?? DEFAULT_COMPILE_ENGINE,
  };
}

export async function updateProjectCompileSettings(projectId, settings) {
  const project = await getProject(projectId);

  if (!project) {
    throw new Error("项目不存在");
  }

  const nextRootFile =
    settings.rootFile !== undefined
      ? await assertCompilableRootFile(projectId, settings.rootFile)
      : project.rootFile;
  const nextCompileEngine =
    settings.compileEngine !== undefined
      ? normalizeCompileEngine(settings.compileEngine)
      : project.compileEngine ?? DEFAULT_COMPILE_ENGINE;

  return updateProjectRecord(projectId, () => ({
    rootFile: nextRootFile,
    compileEngine: nextCompileEngine,
    updatedAt: new Date().toISOString(),
  }));
}

export async function addProjectMember(projectId, memberInput) {
  return updateProjectRecord(projectId, (project) => {
    const nextMembers = [...(project.members ?? [])];
    const existingMemberIndex = nextMembers.findIndex((member) => member.userId === memberInput.userId);
    const nextMember = normalizeProjectMember(
      {
        ...memberInput,
        role: memberInput.role ?? PROJECT_MEMBER_ROLE.editor,
        joinedAt: memberInput.joinedAt ?? new Date().toISOString(),
      },
      project.createdAt,
    );

    if (existingMemberIndex >= 0) {
      nextMembers[existingMemberIndex] = {
        ...nextMembers[existingMemberIndex],
        ...nextMember,
        role:
          nextMembers[existingMemberIndex]?.role === PROJECT_MEMBER_ROLE.owner
            ? PROJECT_MEMBER_ROLE.owner
            : nextMember.role,
      };
    } else {
      nextMembers.push(nextMember);
    }

    return {
      members: nextMembers,
      updatedAt: new Date().toISOString(),
    };
  });
}

export async function removeProjectMember(projectId, userId) {
  return updateProjectRecord(projectId, (project) => {
    const nextMembers = (project.members ?? []).filter((member) => member.userId !== userId);

    if (nextMembers.length === (project.members ?? []).length) {
      throw new Error("项目成员不存在");
    }

    const ownerStillExists = nextMembers.some((member) => member.role === PROJECT_MEMBER_ROLE.owner);

    if (!ownerStillExists) {
      throw new Error("项目至少需要保留一个所有者");
    }

    return {
      members: nextMembers,
      updatedAt: new Date().toISOString(),
    };
  });
}

export async function renameProject(projectId, projectName) {
  const trimmedName = projectName.trim();

  if (!trimmedName) {
    throw new Error("项目名不能为空");
  }

  return updateProjectRecord(projectId, (project) => ({
    name: trimmedName,
    updatedAt: new Date().toISOString(),
    dirtyState: project.dirtyState,
  }));
}

export async function deleteProject(projectId) {
  let deleted = false;
  await patchProjectsManifestAtomically((projects) =>
    projects.filter((project) => {
      if (project.id !== projectId) {
        return true;
      }

      deleted = true;
      return false;
    }),
  );

  if (!deleted) {
    throw new Error("项目不存在");
  }

  await removeBlob(getProjectRoot(projectId));
  await removeBlob(getCollaborationProjectRoot(projectId));
}

export async function getProjectTree(projectId) {
  const project = await getProject(projectId);

  if (!project) {
    throw new Error("项目不存在");
  }

  const projectRoot = getProjectRoot(projectId);
  await ensureBlobDirectory(projectRoot);
  const synchronizedProject = await synchronizeProjectEntries(projectId);
  return buildTreeFromEntries(synchronizedProject.entries ?? []);
}

export async function readProjectFile(projectId, relativePath) {
  const project = await synchronizeProjectEntries(projectId);

  if (!project) {
    throw new Error("项目不存在");
  }

  const safeRelativePath = sanitizeRelativePath(relativePath);
  assertTextFilePath(safeRelativePath);
  const absolutePath = resolveInside(getProjectRoot(projectId), safeRelativePath);

  if (!(await blobExists(absolutePath))) {
    throw new Error("文件不存在");
  }

  const stat = await fs.stat(absolutePath);

  if (!stat.isFile()) {
    throw new Error("目标不是文件");
  }

  return {
    id: findProjectEntryByPath(project, safeRelativePath)?.id ?? null,
    path: safeRelativePath,
    content: await readTextBlob(absolutePath),
  };
}

export async function createProjectFile(projectId, relativePath, content = "") {
  const project = await getProject(projectId);

  if (!project) {
    throw new Error("项目不存在");
  }

  const safeRelativePath = sanitizeRelativePath(relativePath);
  assertTextFilePath(safeRelativePath);
  const absolutePath = resolveInside(getProjectRoot(projectId), safeRelativePath);

  if (await blobExists(absolutePath)) {
    throw new Error("文件已存在");
  }

  await writeTextBlob(absolutePath, content);
  const timestamp = new Date().toISOString();
  const updatedProject = await updateProjectRecord(projectId, (currentProject) => ({
    entries: [...(currentProject.entries ?? []), createProjectEntry(safeRelativePath, "file", timestamp)],
    updatedAt: timestamp,
    dirtyState: {
      isDirty: true,
      dirtySince: currentProject.dirtyState.isDirty ? currentProject.dirtyState.dirtySince : timestamp,
      lastEditedAt: timestamp,
    },
  }));
  return { id: findProjectEntryByPath(updatedProject, safeRelativePath)?.id ?? null, path: safeRelativePath };
}

export async function updateProjectFile(projectId, relativePath, content) {
  const project = await getProject(projectId);

  if (!project) {
    throw new Error("项目不存在");
  }

  const safeRelativePath = sanitizeRelativePath(relativePath);
  assertTextFilePath(safeRelativePath);
  const absolutePath = resolveInside(getProjectRoot(projectId), safeRelativePath);

  if (!(await blobExists(absolutePath))) {
    throw new Error("文件不存在");
  }

  await writeTextBlob(absolutePath, content);
  const timestamp = new Date().toISOString();
  const updatedProject = await updateProjectRecord(projectId, (currentProject) => ({
    entries: (currentProject.entries ?? []).map((entry) =>
      entry.path === safeRelativePath
        ? {
            ...entry,
            updatedAt: timestamp,
          }
        : entry,
    ),
    updatedAt: timestamp,
    dirtyState: {
      isDirty: true,
      dirtySince: currentProject.dirtyState.isDirty ? currentProject.dirtyState.dirtySince : timestamp,
      lastEditedAt: timestamp,
    },
  }));
  return { id: findProjectEntryByPath(updatedProject, safeRelativePath)?.id ?? null, path: safeRelativePath };
}

export async function createProjectDirectory(projectId, relativePath) {
  const project = await getProject(projectId);

  if (!project) {
    throw new Error("项目不存在");
  }

  const safeRelativePath = sanitizeRelativePath(relativePath);
  const absolutePath = resolveInside(getProjectRoot(projectId), safeRelativePath);

  if (await blobExists(absolutePath)) {
    throw new Error("目录已存在");
  }

  await ensureBlobDirectory(absolutePath);
  const timestamp = new Date().toISOString();
  const updatedProject = await updateProjectRecord(projectId, (currentProject) => ({
    entries: [...(currentProject.entries ?? []), createProjectEntry(safeRelativePath, "directory", timestamp)],
    updatedAt: timestamp,
    dirtyState: {
      isDirty: true,
      dirtySince: currentProject.dirtyState.isDirty ? currentProject.dirtyState.dirtySince : timestamp,
      lastEditedAt: timestamp,
    },
  }));
  return { id: findProjectEntryByPath(updatedProject, safeRelativePath)?.id ?? null, path: safeRelativePath };
}

export async function moveProjectEntry(projectId, fromPath, toPath) {
  const project = await synchronizeProjectEntries(projectId);

  if (!project) {
    throw new Error("项目不存在");
  }

  const safeFromPath = sanitizeRelativePath(fromPath);
  const safeToPath = sanitizeRelativePath(toPath);
  const sourcePath = resolveInside(getProjectRoot(projectId), safeFromPath);
  const targetPath = resolveInside(getProjectRoot(projectId), safeToPath);

  if (!(await blobExists(sourcePath))) {
    throw new Error("源路径不存在");
  }

  if (await blobExists(targetPath)) {
    throw new Error("目标路径已存在");
  }

  const sourceStat = await fs.stat(sourcePath);
  const nextRootFile = remapRelativePathByMove(project.rootFile, safeFromPath, safeToPath);

  if (nextRootFile !== project.rootFile && !isTexFilePath(nextRootFile)) {
    throw new Error("不能将当前主编译文件移动为非 .tex 路径");
  }

  await ensureDir(path.dirname(targetPath));
  await fs.rename(sourcePath, targetPath);

  const sourceEntry = findProjectEntryByPath(project, safeFromPath);

  if (sourceEntry?.type === "file") {
    const collaborationStatePath = getCollaborationFileStatePath(projectId, sourceEntry.id);

    if (await blobExists(collaborationStatePath)) {
      await ensureDir(path.dirname(collaborationStatePath));
    }
  }

  await updateProjectRecord(projectId, (currentProject) => ({
    rootFile: remapRelativePathByMove(currentProject.rootFile, safeFromPath, safeToPath),
    entries: (currentProject.entries ?? []).map((entry) => ({
      ...entry,
      path: remapRelativePathByMove(entry.path, safeFromPath, safeToPath),
      updatedAt:
        remapRelativePathByMove(entry.path, safeFromPath, safeToPath) !== entry.path
          ? new Date().toISOString()
          : entry.updatedAt,
    })),
    updatedAt: new Date().toISOString(),
    dirtyState: {
      isDirty: true,
      dirtySince: currentProject.dirtyState.isDirty
        ? currentProject.dirtyState.dirtySince
        : new Date().toISOString(),
      lastEditedAt: new Date().toISOString(),
    },
  }));
  return {
    fromPath: safeFromPath,
    toPath: safeToPath,
  };
}

export async function deleteProjectEntry(projectId, relativePath) {
  const project = await synchronizeProjectEntries(projectId);

  if (!project) {
    throw new Error("项目不存在");
  }

  const safeRelativePath = sanitizeRelativePath(relativePath);
  const absolutePath = resolveInside(getProjectRoot(projectId), safeRelativePath);

  if (
    project.rootFile === safeRelativePath ||
    project.rootFile.startsWith(`${safeRelativePath}/`)
  ) {
    throw new Error("不能删除当前主编译文件，请先修改项目编译设置");
  }

  if (!(await blobExists(absolutePath))) {
    throw new Error("路径不存在");
  }

  const absoluteStat = await fs.stat(absolutePath);
  await removeBlob(absolutePath);
  const removedEntries = (project.entries ?? []).filter(
    (entry) => entry.path === safeRelativePath || entry.path.startsWith(`${safeRelativePath}/`),
  );

  for (const removedEntry of removedEntries.filter((entry) => entry.type === "file")) {
    await removeBlob(getCollaborationFileStatePath(projectId, removedEntry.id));
  }

  await updateProjectRecord(projectId, (currentProject) => ({
    entries: (currentProject.entries ?? []).filter(
      (entry) => entry.path !== safeRelativePath && !entry.path.startsWith(`${safeRelativePath}/`),
    ),
    updatedAt: new Date().toISOString(),
    dirtyState: {
      isDirty: true,
      dirtySince: currentProject.dirtyState.isDirty
        ? currentProject.dirtyState.dirtySince
        : new Date().toISOString(),
      lastEditedAt: new Date().toISOString(),
    },
  }));
}

export async function readProjectRootInfo(projectId) {
  const project = await getProject(projectId);

  if (!project) {
    throw new Error("项目不存在");
  }

  return {
    project,
    projectRoot: getProjectRoot(projectId),
  };
}

export async function markProjectEdited(projectId, timestamp = new Date().toISOString()) {
  return updateProjectRecord(projectId, (project) => ({
    updatedAt: timestamp,
    dirtyState: {
      isDirty: true,
      dirtySince: project.dirtyState.isDirty ? project.dirtyState.dirtySince : timestamp,
      lastEditedAt: timestamp,
    },
  }));
}

export async function markProjectSnapshotRecorded(
  projectId,
  { snapshotType, createdAt = new Date().toISOString(), clearDirty = false },
) {
  return updateProjectRecord(projectId, (project) => ({
    dirtyState: {
      lastSnapshotAt: createdAt,
      lastSnapshotType: snapshotType,
      isDirty: clearDirty ? false : project.dirtyState.isDirty,
      dirtySince: clearDirty ? null : project.dirtyState.dirtySince,
    },
  }));
}

export async function markProjectRestored(projectId, timestamp = new Date().toISOString()) {
  return updateProjectRecord(projectId, () => ({
    updatedAt: timestamp,
    dirtyState: {
      isDirty: false,
      dirtySince: null,
      lastEditedAt: timestamp,
    },
  }));
}

/*
 * Code Review:
 * - 项目清单现在同时承担项目脏状态和成员关系的单一真相来源，便于自动快照与访问控制围绕同一份元数据决策。
 * - `markProjectSnapshotRecorded` 与 `markProjectRestored` 避免了快照模块直接修改项目清单结构，保持职责边界稳定。
 * - 当前仍以单文件 `projects.json` 维护项目元数据，但关键写路径已通过元数据门面的原子 patch 串行化，避免并发写覆盖。
 * - 模板化项目创建仍复用同一仓储入口，只新增“初始文件集”能力，避免把模板落盘逻辑散落到 API 层。
 */
