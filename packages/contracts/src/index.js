/*
 * File: index.js
 * Module: packages/contracts (共享契约)
 *
 * Responsibility:
 *   - 提供 MVP 阶段前后端和 Worker 共用的常量、状态枚举与基础校验规则。
 *   - 保持错误码、任务状态、支持的文本文件类型在仓库中的单一真相来源。
 *
 * Runtime Logic Overview:
 *   1. API 服务读取本文件中的约束以校验用户输入。
 *   2. Worker 读取本文件中的任务状态常量以更新编译生命周期。
 *   3. 前端通过 API 间接依赖本文件定义的契约结果。
 *
 * Key Data Flow:
 *   - 输入：无运行时输入，模块仅暴露常量与纯函数。
 *   - 输出：编译状态、支持的文本文件扩展名、默认文件名、错误码和成员角色常量。
 *
 * Future Extension:
 *   - 可继续沉淀请求/响应 DTO、错误类型和权限枚举。
 *   - 未来切到 TypeScript 后，可把这里升级为显式类型定义入口。
 *
 * Dependencies:
 *   - Node.js 原生运行时
 *
 * Last Updated:
 *   - 2026-03-08 by Codex - 扩展项目级编译设置与支持的 LaTeX 引擎契约
 */

export const DEFAULT_PORT = 3000;
export const DEFAULT_MAIN_FILE = "main.tex";
export const DEFAULT_COMPILE_ENGINE = "pdflatex";
export const SNAPSHOT_RETENTION_LIMIT = 40;
export const AUTO_CHECKPOINT_THRESHOLD_MS = 10 * 60 * 1000;
export const AUTO_CHECKPOINT_SCAN_INTERVAL_MS = 60 * 1000;
export const PROJECT_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const REQUEST_USER_ID_HEADER = "x-overleaf-user-id";
export const REQUEST_USER_NAME_HEADER = "x-overleaf-user-name";

export const COMPILE_STATUS = Object.freeze({
  pending: "pending",
  running: "running",
  succeeded: "succeeded",
  failed: "failed",
});

export const ERROR_CODE = Object.freeze({
  badRequest: "BAD_REQUEST",
  unauthorized: "UNAUTHORIZED",
  notFound: "NOT_FOUND",
  conflict: "CONFLICT",
  forbidden: "FORBIDDEN",
  unsupportedFile: "UNSUPPORTED_FILE",
  internal: "INTERNAL_ERROR",
});

export const PROJECT_MEMBER_ROLE = Object.freeze({
  owner: "owner",
  editor: "editor",
  commenter: "commenter",
  viewer: "viewer",
});

export const ORGANIZATION_ROLE = Object.freeze({
  owner: "owner",
  admin: "admin",
  member: "member",
  billingViewer: "billing_viewer",
});

export const TEAM_ROLE = Object.freeze({
  owner: "owner",
  maintainer: "maintainer",
  member: "member",
});

export const PROJECT_PERMISSION = Object.freeze({
  read: "read",
  write: "write",
  comment: "comment",
  compile: "compile",
  manageMembers: "manage_members",
  manageSettings: "manage_settings",
  deleteProject: "delete_project",
});

const projectRolePermissions = Object.freeze({
  [PROJECT_MEMBER_ROLE.owner]: new Set(Object.values(PROJECT_PERMISSION)),
  [PROJECT_MEMBER_ROLE.editor]: new Set([
    PROJECT_PERMISSION.read,
    PROJECT_PERMISSION.write,
    PROJECT_PERMISSION.comment,
    PROJECT_PERMISSION.compile,
  ]),
  [PROJECT_MEMBER_ROLE.commenter]: new Set([
    PROJECT_PERMISSION.read,
    PROJECT_PERMISSION.comment,
  ]),
  [PROJECT_MEMBER_ROLE.viewer]: new Set([
    PROJECT_PERMISSION.read,
  ]),
});

export const COMPILE_ENGINE = Object.freeze({
  pdflatex: "pdflatex",
  xelatex: "xelatex",
  lualatex: "lualatex",
});

export const SNAPSHOT_TYPE = Object.freeze({
  compileSuccess: "compile_success",
  autoCheckpoint: "auto_checkpoint",
  restoreGuard: "restore_guard",
});

export const TEXT_FILE_EXTENSIONS = new Set([
  ".tex",
  ".bib",
  ".sty",
  ".cls",
  ".txt",
  ".md",
  ".log",
]);

export const STATIC_FILE_TYPES = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".pdf": "application/pdf",
});

export function isTerminalCompileStatus(status) {
  return status === COMPILE_STATUS.succeeded || status === COMPILE_STATUS.failed;
}

export function isSupportedCompileEngine(engine) {
  return Object.values(COMPILE_ENGINE).includes(engine);
}

export function hasProjectPermission(role, permission) {
  return projectRolePermissions[role]?.has(permission) ?? false;
}

/*
 * Code Review:
 * - 该文件保持为纯常量层，避免把业务流程混入共享契约。
 * - `TEXT_FILE_EXTENSIONS` 当前只覆盖 MVP 需要编辑的文本格式，后续新增时应同步更新前后端行为。
 * - 成员角色、邀请 TTL 与请求用户头名集中定义，避免 API、前端和协作服务各自维护一套魔法字符串。
 * - 项目级编译设置同样收敛到共享契约，避免 API、Worker 和前端各自维护一套引擎枚举。
 * - 错误码刻意保持精简，先服务当前成品阶段闭环，避免提前扩展复杂错误体系。
 */
