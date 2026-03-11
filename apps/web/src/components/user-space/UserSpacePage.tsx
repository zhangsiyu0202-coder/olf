/*
 * File: UserSpacePage.tsx
 * Module: apps/web/components/user-space (用户空间页面)
 *
 * Responsibility:
 *   - 组装头像入口的独立“用户空间”页面，协调三栏布局、局部筛选与项目上下文缓存。
 *   - 把当前用户可访问项目的浏览、筛选和项目级详情整合到同一页，而不侵入写作工作台。
 *
 * Dependencies:
 *   - react
 *   - lucide-react
 *   - ../../types
 *   - ./UserSpaceSidebar
 *   - ./UserSpaceProjectPanel
 *   - ./UserSpaceActivityAside
 *   - ./userSpaceTypes
 *
 * Last Updated:
 *   - 2026-03-09 by Codex - 对齐空间作用域、中文页头与中栏筛选同步
 */

import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  OrganizationSummary,
  ProjectSummary,
  SessionUser,
  TeamSummary,
  WorkspaceSummary,
} from "../../types";
import UserSpaceActivityAside from "./UserSpaceActivityAside";
import UserSpaceProjectPanel from "./UserSpaceProjectPanel";
import UserSpaceSidebar from "./UserSpaceSidebar";
import { USER_SPACE_SCOPE_OPTIONS } from "./userSpaceTypes";
import type {
  UserSpaceProjectContext,
  UserSpaceScopeFilter,
  UserSpaceViewMode,
  UserSpaceWorkspaceOption,
  UserSpaceWorkspaceScope,
} from "./userSpaceTypes";

const USER_SPACE_RECENT_LIMIT = 8;

function getWorkspaceScopeKey(workspace: WorkspaceSummary): UserSpaceWorkspaceScope {
  if (workspace.type === "personal") {
    return "personal";
  }

  if (workspace.type === "organization") {
    return `organization:${workspace.organizationId ?? workspace.id}`;
  }

  return `team:${workspace.teamId ?? workspace.id}`;
}

function sortProjectsByUpdatedAt(projects: ProjectSummary[]) {
  return [...projects].sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
}

function matchesWorkspaceScope(project: ProjectSummary, workspaceScope: UserSpaceWorkspaceScope) {
  if (workspaceScope === "all") {
    return true;
  }

  if (workspaceScope === "personal") {
    return project.workspaceType === "personal";
  }

  if (workspaceScope.startsWith("organization:")) {
    return project.workspaceType === "organization" && workspaceScope === `organization:${project.organizationId ?? ""}`;
  }

  return project.workspaceType === "team" && workspaceScope === `team:${project.teamId ?? ""}`;
}

function matchesScopeFilter(project: ProjectSummary, scopeFilter: UserSpaceScopeFilter, sessionUserId: string) {
  if (scopeFilter === "owned") {
    return project.ownerId === sessionUserId;
  }

  if (scopeFilter === "shared") {
    return project.ownerId !== sessionUserId || project.memberCount > 1;
  }

  return true;
}

function buildWorkspaceOptions({
  allWorkspaces,
  projects,
}: {
  allWorkspaces: WorkspaceSummary[];
  projects: ProjectSummary[];
}) {
  const options: UserSpaceWorkspaceOption[] = [
    {
      key: "all",
      label: "全部空间",
      type: "all",
      count: projects.length,
    },
  ];

  const personalWorkspace = allWorkspaces.find((workspace) => workspace.type === "personal") ?? null;

  if (personalWorkspace) {
    options.push({
      key: getWorkspaceScopeKey(personalWorkspace),
      label: "个人空间",
      type: "personal",
      count: projects.filter((project) => project.workspaceType === "personal").length,
    });
  }

  for (const workspace of allWorkspaces) {
    if (workspace.type === "organization") {
      options.push({
        key: getWorkspaceScopeKey(workspace),
        label: workspace.name,
        type: "organization",
        count: projects.filter(
          (project) => project.workspaceType === "organization" && project.organizationId === workspace.organizationId,
        ).length,
      });
    }

    if (workspace.type === "team") {
      options.push({
        key: getWorkspaceScopeKey(workspace),
        label: workspace.name,
        type: "team",
        count: projects.filter((project) => project.workspaceType === "team" && project.teamId === workspace.teamId)
          .length,
      });
    }
  }

  return options.filter((option, index, items) => items.findIndex((entry) => entry.key === option.key) === index);
}

export default function UserSpacePage({
  sessionUser,
  projects,
  allWorkspaces,
  organizationWorkspaces,
  teamWorkspaces,
  onBack,
  onCreateProject,
  onOpenTemplates,
  onOpenProject,
  onRenameProject,
  onDeleteProject,
  onLoadProjectContext,
}: {
  sessionUser: SessionUser;
  projects: ProjectSummary[];
  allWorkspaces: WorkspaceSummary[];
  organizationWorkspaces: OrganizationSummary[];
  teamWorkspaces: TeamSummary[];
  onBack: () => void;
  onCreateProject: () => void;
  onOpenTemplates: () => void;
  onOpenProject: (project: ProjectSummary) => void;
  onRenameProject: (project: ProjectSummary) => void;
  onDeleteProject: (project: ProjectSummary) => void;
  onLoadProjectContext: (projectId: string) => Promise<UserSpaceProjectContext>;
}) {
  const [scopeFilter, setScopeFilter] = useState<UserSpaceScopeFilter>("all");
  const [workspaceScope, setWorkspaceScope] = useState<UserSpaceWorkspaceScope>("all");
  const [viewMode, setViewMode] = useState<UserSpaceViewMode>("list");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectDetailCache, setProjectDetailCache] = useState<Record<string, UserSpaceProjectContext>>({});
  const [projectContextErrors, setProjectContextErrors] = useState<Record<string, string>>({});
  const [loadingProjectContextId, setLoadingProjectContextId] = useState<string | null>(null);

  const sortedProjects = useMemo(() => sortProjectsByUpdatedAt(projects), [projects]);
  const workspaceOptions = useMemo(
    () =>
      buildWorkspaceOptions({
        allWorkspaces,
        projects: sortedProjects,
      }),
    [allWorkspaces, sortedProjects],
  );
  const filteredProjects = useMemo(() => {
    const scopedProjects = sortedProjects.filter(
      (project) => matchesWorkspaceScope(project, workspaceScope) && matchesScopeFilter(project, scopeFilter, sessionUser.id),
    );

    if (scopeFilter === "recent") {
      return scopedProjects.slice(0, USER_SPACE_RECENT_LIMIT);
    }

    return scopedProjects;
  }, [scopeFilter, sessionUser.id, sortedProjects, workspaceScope]);
  const selectedProject = useMemo(
    () => filteredProjects.find((project) => project.id === selectedProjectId) ?? null,
    [filteredProjects, selectedProjectId],
  );
  const selectedProjectContext = selectedProjectId ? projectDetailCache[selectedProjectId] ?? null : null;
  const selectedProjectError = selectedProjectId ? projectContextErrors[selectedProjectId] ?? null : null;

  useEffect(() => {
    if (filteredProjects.length === 0) {
      setSelectedProjectId(null);
      return;
    }

    if (!selectedProjectId || !filteredProjects.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(filteredProjects[0]?.id ?? null);
    }
  }, [filteredProjects, selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId || projectDetailCache[selectedProjectId] || loadingProjectContextId === selectedProjectId) {
      return;
    }

    void (async () => {
      try {
        setLoadingProjectContextId(selectedProjectId);
        const payload = await onLoadProjectContext(selectedProjectId);
        setProjectDetailCache((current) => ({
          ...current,
          [selectedProjectId]: payload,
        }));
        setProjectContextErrors((current) => {
          const next = { ...current };
          delete next[selectedProjectId];
          return next;
        });
      } catch (error) {
        setProjectContextErrors((current) => ({
          ...current,
          [selectedProjectId]: error instanceof Error ? error.message : "项目详情加载失败",
        }));
      } finally {
        setLoadingProjectContextId((current) => (current === selectedProjectId ? null : current));
      }
    })();
  }, [loadingProjectContextId, onLoadProjectContext, projectDetailCache, selectedProjectId]);

  async function handleRetryProjectContext() {
    if (!selectedProjectId) {
      return;
    }

    setProjectContextErrors((current) => {
      const next = { ...current };
      delete next[selectedProjectId];
      return next;
    });
    setProjectDetailCache((current) => {
      const next = { ...current };
      delete next[selectedProjectId];
      return next;
    });
  }

  return (
    <main className="user-space-page">
      <section className="user-space-page-header user-space-panel">
        <button type="button" className="ghost-button user-space-back-button" onClick={onBack}>
          <ArrowLeft size={16} />
          <span>返回上一个页面</span>
        </button>
        <div>
          <small>用户空间</small>
          <strong>{sessionUser.name} 的项目空间</strong>
        </div>
      </section>

      <section className="user-space-layout">
        <UserSpaceSidebar
          sessionUser={sessionUser}
          projectCount={projects.length}
          organizationCount={organizationWorkspaces.length}
          teamCount={teamWorkspaces.length}
          scopeFilter={scopeFilter}
          workspaceScope={workspaceScope}
          workspaceOptions={workspaceOptions}
          onScopeChange={setScopeFilter}
          onWorkspaceScopeChange={setWorkspaceScope}
          onCreateProject={onCreateProject}
        />

        <UserSpaceProjectPanel
          totalProjectCount={projects.length}
          projects={filteredProjects}
          selectedProjectId={selectedProjectId}
          scopeFilter={scopeFilter}
          viewMode={viewMode}
          scopeOptions={USER_SPACE_SCOPE_OPTIONS}
          onScopeChange={setScopeFilter}
          onViewModeChange={setViewMode}
          onSelectProject={setSelectedProjectId}
          onOpenProject={onOpenProject}
          onRenameProject={onRenameProject}
          onDeleteProject={onDeleteProject}
          onCreateProject={onCreateProject}
          onOpenTemplates={onOpenTemplates}
        />

        <UserSpaceActivityAside
          project={selectedProject}
          context={selectedProjectContext}
          isLoading={loadingProjectContextId === selectedProjectId}
          error={selectedProjectError}
          onRetry={() => void handleRetryProjectContext()}
          onOpenProject={onOpenProject}
        />
      </section>
    </main>
  );
}

/*
 * Code Review:
 * - 页面把项目上下文缓存保留在本地，而不是上提到 `App`，因为这类缓存只对用户空间可见，继续上提只会放大 `App` 的状态负担。
 * - 首次进入默认选中筛选结果中的最近修改项目，既满足“开页即有内容”，也避免无意义的右栏空白。
 * - 右栏上下文采用按需加载与缓存策略，保证首屏只消耗项目列表渲染成本，不为所有项目预拉成员和时间线。
 */
