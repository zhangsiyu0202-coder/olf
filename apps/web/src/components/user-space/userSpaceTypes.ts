/*
 * File: userSpaceTypes.ts
 * Module: apps/web/components/user-space (用户空间视图模型)
 *
 * Responsibility:
 *   - 为头像入口的独立“用户空间”页面提供局部视图模型和派生类型。
 *   - 避免把只属于用户空间的筛选、时间线和上下文结构扩散到全局 `types.ts`。
 *
 * Dependencies:
 *   - ../../types
 *
 * Last Updated:
 *   - 2026-03-09 by Codex - 补充用户空间筛选项与空间作用域定义
 */

import type {
  AuditLogRecord,
  ProjectMember,
  VersionEventRecord,
  WorkspaceSummary,
} from "../../types";

export type UserSpaceScopeFilter = "all" | "owned" | "shared" | "recent";

export type UserSpaceViewMode = "list" | "grid";

export type UserSpaceWorkspaceScope = "all" | "personal" | `organization:${string}` | `team:${string}`;

export interface UserSpaceScopeOption {
  value: UserSpaceScopeFilter;
  sidebarLabel: string;
  panelLabel: string;
  description: string;
}

export const USER_SPACE_SCOPE_OPTIONS: UserSpaceScopeOption[] = [
  { value: "all", sidebarLabel: "全部项目", panelLabel: "全部", description: "查看你可访问的全部 LaTeX 项目" },
  { value: "owned", sidebarLabel: "我创建的", panelLabel: "我创建的", description: "筛出由你创建的项目" },
  { value: "shared", sidebarLabel: "与我共享", panelLabel: "与我共享", description: "筛出多人协作或他人共享给你的项目" },
  { value: "recent", sidebarLabel: "最近修改", panelLabel: "最近更新", description: "查看最近更新的重点项目" },
];

export interface UserSpaceWorkspaceOption {
  key: UserSpaceWorkspaceScope;
  label: string;
  type: "all" | WorkspaceSummary["type"];
  count: number;
}

export interface UserSpaceProjectContext {
  members: ProjectMember[];
  auditLogs: AuditLogRecord[];
  versionEvents: VersionEventRecord[];
}

export interface UserSpaceTimelineItem {
  id: string;
  kind: "audit" | "version";
  label: string;
  detail: string;
  createdAt: string;
}

/*
 * Code Review:
 * - 用户空间的筛选和时间线模型被限制在局部文件中，避免把“页面态”伪装成共享 DTO。
 * - `UserSpaceWorkspaceScope` 直接复用当前项目里的 `personal/organization/team` 语义，减少二次映射成本。
 * - 当前上下文结构只覆盖成员、审计和版本事件，后续若要补充统计数据，应优先在这里扩展而不是污染全局类型。
 */
