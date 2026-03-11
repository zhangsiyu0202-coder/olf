/*
 * File: UserSpaceProjectPanel.tsx
 * Module: apps/web/components/user-space (用户空间中栏)
 *
 * Responsibility:
 *   - 渲染用户空间页的项目总览、列表/网格切换和快速开始区块。
 *   - 让用户在不进入编辑器的前提下，先完成项目筛选、浏览和工作台入口选择。
 *
 * Dependencies:
 *   - lucide-react
 *   - ../../types
 *   - ./userSpaceTypes
 *
 * Last Updated:
 *   - 2026-03-09 by Codex - 补齐二级筛选条、操作菜单与严格列表交互
 */

import {
  BookText,
  Ellipsis,
  FileCode2,
  FolderOpen,
  Grid2x2,
  List,
  Plus,
  Sparkles,
  Users,
} from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";
import type { ProjectSummary } from "../../types";
import type { UserSpaceScopeFilter, UserSpaceScopeOption, UserSpaceViewMode } from "./userSpaceTypes";

function formatProjectRole(role: ProjectSummary["currentUserRole"]) {
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
      return "成员";
  }
}

function formatWorkspaceLabel(project: ProjectSummary) {
  const typeLabel =
    project.workspaceType === "organization"
      ? "组织"
      : project.workspaceType === "team"
        ? "团队"
        : "个人";

  return `${project.workspaceName ?? "个人空间"} · ${typeLabel}`;
}

function formatWorkspaceType(project: ProjectSummary) {
  if (project.workspaceType === "organization") {
    return "组织空间";
  }

  if (project.workspaceType === "team") {
    return "团队空间";
  }

  return "个人空间";
}

function formatRelativeDate(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildProjectIcon(project: ProjectSummary) {
  if (project.compileEngine === "xelatex") {
    return <BookText size={18} />;
  }

  if (project.compileEngine === "lualatex") {
    return <Sparkles size={18} />;
  }

  return <FileCode2 size={18} />;
}

function scopeLabel(scopeFilter: UserSpaceScopeFilter) {
  switch (scopeFilter) {
    case "owned":
      return "我创建的";
    case "shared":
      return "与我共享";
    case "recent":
      return "最近更新";
    default:
      return "全部项目";
  }
}

function ProjectActionMenu({
  project,
  isOpen,
  onToggle,
  onClose,
  onOpenProject,
  onRenameProject,
  onDeleteProject,
}: {
  project: ProjectSummary;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onOpenProject: (project: ProjectSummary) => void;
  onRenameProject: (project: ProjectSummary) => void;
  onDeleteProject: (project: ProjectSummary) => void;
}) {
  const canRename = project.currentUserRole === "owner" || project.currentUserRole === "editor";
  const canDelete = project.currentUserRole === "owner";

  return (
    <div
      className="user-space-project-action-menu-shell"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className={`icon-button user-space-project-action-trigger${isOpen ? " user-space-project-action-trigger-active" : ""}`}
        onClick={onToggle}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        title="项目操作"
      >
        <Ellipsis size={16} />
      </button>

      {isOpen ? (
        <div className="user-space-project-action-menu" role="menu">
          <button
            type="button"
            className="user-space-project-action-item"
            onClick={() => {
              onClose();
              onOpenProject(project);
            }}
          >
            进入工作台
          </button>
          {canRename ? (
            <button
              type="button"
              className="user-space-project-action-item"
              onClick={() => {
                onClose();
                onRenameProject(project);
              }}
            >
              重命名
            </button>
          ) : null}
          {canDelete ? (
            <button
              type="button"
              className="user-space-project-action-item user-space-project-action-item-danger"
              onClick={() => {
                onClose();
                onDeleteProject(project);
              }}
            >
              删除
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function UserSpaceProjectPanel({
  totalProjectCount,
  projects,
  selectedProjectId,
  scopeFilter,
  scopeOptions,
  viewMode,
  onScopeChange,
  onViewModeChange,
  onSelectProject,
  onOpenProject,
  onRenameProject,
  onDeleteProject,
  onCreateProject,
  onOpenTemplates,
}: {
  totalProjectCount: number;
  projects: ProjectSummary[];
  selectedProjectId: string | null;
  scopeFilter: UserSpaceScopeFilter;
  scopeOptions: UserSpaceScopeOption[];
  viewMode: UserSpaceViewMode;
  onScopeChange: (value: UserSpaceScopeFilter) => void;
  onViewModeChange: (value: UserSpaceViewMode) => void;
  onSelectProject: (projectId: string) => void;
  onOpenProject: (project: ProjectSummary) => void;
  onRenameProject: (project: ProjectSummary) => void;
  onDeleteProject: (project: ProjectSummary) => void;
  onCreateProject: () => void;
  onOpenTemplates: () => void;
}) {
  const [openActionProjectId, setOpenActionProjectId] = useState<string | null>(null);
  const hasAnyProjects = totalProjectCount > 0;
  const recentProject = projects[0] ?? null;

  useEffect(() => {
    if (!openActionProjectId) {
      return;
    }

    function handleDocumentClick() {
      setOpenActionProjectId(null);
    }

    document.addEventListener("click", handleDocumentClick);
    return () => {
      document.removeEventListener("click", handleDocumentClick);
    };
  }, [openActionProjectId]);

  function handleSelectProjectKeyDown(event: KeyboardEvent<HTMLElement>, projectId: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelectProject(projectId);
    }
  }

  return (
    <section className="user-space-project-panel user-space-panel">
      <div className="user-space-project-panel-head">
        <div>
          <small>项目总览</small>
          <h1>我的项目</h1>
          <p>管理你可访问的 LaTeX 项目与协作空间，先筛选，再进入写作工作台。</p>
        </div>

        <div className="user-space-project-toolbar">
          <div className="user-space-filter-summary">{scopeLabel(scopeFilter)}</div>
          <div className="user-space-view-switch">
            <button
              type="button"
              className={`user-space-view-switch-button${viewMode === "list" ? " user-space-view-switch-button-active" : ""}`}
              onClick={() => onViewModeChange("list")}
              aria-pressed={viewMode === "list"}
              title="列表视图"
            >
              <List size={16} />
            </button>
            <button
              type="button"
              className={`user-space-view-switch-button${viewMode === "grid" ? " user-space-view-switch-button-active" : ""}`}
              onClick={() => onViewModeChange("grid")}
              aria-pressed={viewMode === "grid"}
              title="网格视图"
            >
              <Grid2x2 size={16} />
            </button>
          </div>
        </div>
      </div>

      <div className="user-space-scope-tabs" role="tablist" aria-label="项目范围筛选">
        {scopeOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={scopeFilter === option.value}
            className={`user-space-scope-tab${scopeFilter === option.value ? " user-space-scope-tab-active" : ""}`}
            onClick={() => onScopeChange(option.value)}
          >
            {option.panelLabel}
          </button>
        ))}
      </div>

      <div className="user-space-project-summary">
        <div>
          <strong>{projects.length}</strong>
          <span>{scopeLabel(scopeFilter)}</span>
        </div>
        <small>项目默认按最近修改时间排序。</small>
      </div>

      {projects.length === 0 ? (
        <div className="user-space-empty-state">
          <strong>{hasAnyProjects ? "当前筛选条件下没有项目" : "你还没有任何项目"}</strong>
          <p>
            {hasAnyProjects
              ? "可以切换空间筛选或项目范围筛选，重新定位你要进入的工作台。"
              : "先创建空白项目，或者去模板库挑一个适合的模板骨架。"}
          </p>
          <div className="user-space-empty-actions">
            <button type="button" className="accent-button" onClick={onCreateProject}>
              <Plus size={16} />
              <span>新建项目</span>
            </button>
            <button type="button" className="ghost-button" onClick={onOpenTemplates}>
              前往模板库
            </button>
          </div>
        </div>
      ) : viewMode === "list" ? (
        <div className="user-space-project-list">
          <div className="user-space-project-list-head">
            <span>项目名称</span>
            <span>所属空间</span>
            <span>所有者</span>
            <span>最近修改</span>
            <span>当前权限</span>
            <span>操作</span>
          </div>

          {projects.map((project) => (
            <article
              key={project.id}
              role="button"
              tabIndex={0}
              className={`user-space-project-row${selectedProjectId === project.id ? " user-space-project-row-active" : ""}`}
              onClick={() => onSelectProject(project.id)}
              onKeyDown={(event) => handleSelectProjectKeyDown(event, project.id)}
            >
              <div className="user-space-project-main">
                <span className="user-space-project-icon">{buildProjectIcon(project)}</span>
                <div className="user-space-project-copy">
                  <strong onDoubleClick={() => onOpenProject(project)}>{project.name}</strong>
                  <small>
                    {project.compileEngine} · {formatWorkspaceType(project)} · {project.memberCount} 人协作
                  </small>
                </div>
              </div>
              <span>{formatWorkspaceLabel(project)}</span>
              <span>{project.ownerName ?? "未知"}</span>
              <span>{formatRelativeDate(project.updatedAt)}</span>
              <span className="user-space-role-pill">{formatProjectRole(project.currentUserRole)}</span>
              <ProjectActionMenu
                project={project}
                isOpen={openActionProjectId === project.id}
                onToggle={() => setOpenActionProjectId((current) => (current === project.id ? null : project.id))}
                onClose={() => setOpenActionProjectId(null)}
                onOpenProject={onOpenProject}
                onRenameProject={onRenameProject}
                onDeleteProject={onDeleteProject}
              />
            </article>
          ))}
        </div>
      ) : (
        <div className="user-space-project-grid">
          {projects.map((project) => (
            <article
              key={project.id}
              role="button"
              tabIndex={0}
              className={`user-space-project-card${selectedProjectId === project.id ? " user-space-project-card-active" : ""}`}
              onClick={() => onSelectProject(project.id)}
              onKeyDown={(event) => handleSelectProjectKeyDown(event, project.id)}
            >
              <div className="user-space-project-card-head">
                <span className="user-space-project-icon">{buildProjectIcon(project)}</span>
                <div className="user-space-project-card-head-actions">
                  <span className="user-space-role-pill">{formatProjectRole(project.currentUserRole)}</span>
                  <ProjectActionMenu
                    project={project}
                    isOpen={openActionProjectId === project.id}
                    onToggle={() => setOpenActionProjectId((current) => (current === project.id ? null : project.id))}
                    onClose={() => setOpenActionProjectId(null)}
                    onOpenProject={onOpenProject}
                    onRenameProject={onRenameProject}
                    onDeleteProject={onDeleteProject}
                  />
                </div>
              </div>
              <strong onDoubleClick={() => onOpenProject(project)}>{project.name}</strong>
              <small>{formatWorkspaceLabel(project)}</small>
              <small>所有者：{project.ownerName ?? "未知"}</small>
              <small>最近修改：{formatRelativeDate(project.updatedAt)}</small>
              <small>
                <Users size={14} />
                <span>{project.memberCount} 人协作</span>
              </small>
              <button
                type="button"
                className="mini-button user-space-open-project-button"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenProject(project);
                }}
              >
                进入工作台
              </button>
            </article>
          ))}
        </div>
      )}

      <div className="user-space-quick-start">
        <div>
          <small>快速开始</small>
          <strong>从这里继续开始写作</strong>
          <p>当前没有本地 zip 导入能力时，优先保留真实可接上的快速开始动作。</p>
        </div>
        <div className="user-space-quick-start-actions">
          <button type="button" className="accent-button" onClick={onCreateProject}>
            <Plus size={16} />
            <span>新建空白项目</span>
          </button>
          <button type="button" className="ghost-button" onClick={onOpenTemplates}>
            <FolderOpen size={16} />
            <span>从模板库创建</span>
          </button>
          {recentProject ? (
            <button type="button" className="ghost-button" onClick={() => onOpenProject(recentProject)}>
              <BookText size={16} />
              <span>打开最近项目</span>
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/*
 * Code Review:
 * - 项目列表默认使用 list 视图，是因为当前真实数据更接近表格式浏览；grid 只作为辅助视图存在，不反客为主。
 * - 中栏二级筛选条与左栏共享同一 `scopeFilter`，避免出现双重真相来源。
 * - 操作区改成轻量菜单按钮后，保留了计划中的三项固定动作，同时避免列表行内堆满按钮影响信息密度。
 * - 快速开始区块替代了参考图里的上传区，因为当前没有稳定的 zip 导入主链路，硬做只会产生假入口。
 */
