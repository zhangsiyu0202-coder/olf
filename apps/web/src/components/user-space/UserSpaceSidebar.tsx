/*
 * File: UserSpaceSidebar.tsx
 * Module: apps/web/components/user-space (用户空间左栏)
 *
 * Responsibility:
 *   - 渲染用户空间页的空间筛选、项目范围筛选和账号概览卡片。
 *   - 把“项目标签”替换为当前系统真实存在的工作空间筛选，不制造虚假的信息维度。
 *
 * Dependencies:
 *   - lucide-react
 *   - ../../types
 *   - ./userSpaceTypes
 *
 * Last Updated:
 *   - 2026-03-09 by Codex - 对齐计划中的左栏筛选文案与账号概览结构
 */

import {
  Building2,
  FolderKanban,
  Plus,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";
import type { SessionUser } from "../../types";
import {
  USER_SPACE_SCOPE_OPTIONS,
  type UserSpaceScopeFilter,
  type UserSpaceWorkspaceOption,
  type UserSpaceWorkspaceScope,
} from "./userSpaceTypes";

function renderWorkspaceIcon(type: UserSpaceWorkspaceOption["type"]) {
  switch (type) {
    case "personal":
      return <UserRound size={16} />;
    case "organization":
      return <Building2 size={16} />;
    case "team":
      return <Users size={16} />;
    default:
      return <FolderKanban size={16} />;
  }
}

export default function UserSpaceSidebar({
  sessionUser,
  projectCount,
  organizationCount,
  teamCount,
  scopeFilter,
  workspaceScope,
  workspaceOptions,
  onScopeChange,
  onWorkspaceScopeChange,
  onCreateProject,
}: {
  sessionUser: SessionUser;
  projectCount: number;
  organizationCount: number;
  teamCount: number;
  scopeFilter: UserSpaceScopeFilter;
  workspaceScope: UserSpaceWorkspaceScope;
  workspaceOptions: UserSpaceWorkspaceOption[];
  onScopeChange: (value: UserSpaceScopeFilter) => void;
  onWorkspaceScopeChange: (value: UserSpaceWorkspaceScope) => void;
  onCreateProject: () => void;
}) {
  return (
    <aside className="user-space-sidebar user-space-panel">
      <div className="user-space-sidebar-head">
        <small>用户空间</small>
        <h2>用户空间</h2>
        <p>管理你当前能访问的项目、空间与协作上下文。</p>
      </div>

      <button type="button" className="accent-button user-space-create-button" onClick={onCreateProject}>
        <Plus size={16} />
        <span>创建新项目</span>
      </button>

      <section className="user-space-sidebar-section">
        <div className="user-space-section-title">项目范围筛选</div>
        <div className="user-space-nav-list">
          {USER_SPACE_SCOPE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`user-space-nav-item${scopeFilter === option.value ? " user-space-nav-item-active" : ""}`}
              onClick={() => onScopeChange(option.value)}
            >
              <div>
                <strong>{option.sidebarLabel}</strong>
                <small>{option.description}</small>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="user-space-sidebar-section">
        <div className="user-space-section-title">空间筛选</div>
        <div className="user-space-filter-list">
          {workspaceOptions.map((option) => (
            <button
              key={option.key}
              type="button"
              className={`user-space-filter-item${workspaceScope === option.key ? " user-space-filter-item-active" : ""}`}
              onClick={() => onWorkspaceScopeChange(option.key)}
            >
              <span className="user-space-filter-icon">{renderWorkspaceIcon(option.type)}</span>
              <span>{option.label}</span>
              <small>{option.count}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="user-space-account-card">
        <div className="user-space-account-head">
          <div className="user-space-account-avatar">{sessionUser.name.slice(0, 1).toUpperCase()}</div>
          <div>
            <strong>{sessionUser.name}</strong>
            <small>{sessionUser.email ?? "已登录用户"}</small>
          </div>
        </div>

        <div className="user-space-account-metrics">
          <div>
            <span>项目数</span>
            <strong>{projectCount}</strong>
          </div>
          <div>
            <span>组织</span>
            <strong>{organizationCount}</strong>
          </div>
          <div>
            <span>团队</span>
            <strong>{teamCount}</strong>
          </div>
        </div>

        <div className="user-space-account-footnote">
          <ShieldCheck size={16} />
          <span>当前页面只展示真实可访问项目，不虚构标签、存储和状态统计。</span>
        </div>
      </section>
    </aside>
  );
}

/*
 * Code Review:
 * - 左栏只承载当前系统真实存在的空间和项目范围筛选，避免参考稿里的“项目标签”被硬套到没有数据支撑的产品结构上。
 * - 账号概览卡片只展示当前前端已经稳定可得的数据，避免为了视觉完整度引入伪统计。
 * - 主视图筛选和空间筛选被拆成两个独立按钮组，后续若要追加收藏/归档等真实维度，不会破坏现有结构。
 */
