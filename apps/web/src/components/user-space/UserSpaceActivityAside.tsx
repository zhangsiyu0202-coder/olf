/*
 * File: UserSpaceActivityAside.tsx
 * Module: apps/web/components/user-space (用户空间右栏)
 *
 * Responsibility:
 *   - 展示当前选中项目的概览、最近动态时间线和协作成员。
 *   - 把参考图中的“最近动态/团队成员”收敛成当前项目级上下文，而不是伪造全局活动流。
 *
 * Dependencies:
 *   - lucide-react
 *   - ../../types
 *   - ./userSpaceTypes
 *
 * Last Updated:
 *   - 2026-03-09 by Codex - 补齐项目概览字段与右栏加载占位态
 */

import { RefreshCcw, ShieldCheck } from "lucide-react";
import type { ProjectSummary } from "../../types";
import type { UserSpaceProjectContext, UserSpaceTimelineItem } from "./userSpaceTypes";

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

function formatRelativeDate(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildTimelineItems(context: UserSpaceProjectContext | null): UserSpaceTimelineItem[] {
  if (!context) {
    return [];
  }

  const auditItems = context.auditLogs.map((log) => ({
    id: `audit:${log.id}`,
    kind: "audit" as const,
    label: log.action.replaceAll(".", " / "),
    detail: `${log.targetType}${log.targetId ? ` · ${log.targetId}` : ""}`,
    createdAt: log.createdAt,
  }));

  const versionItems = context.versionEvents.map((event) => ({
    id: `version:${event.id}`,
    kind: "version" as const,
    label: event.eventType.replaceAll("_", " "),
    detail: event.filePath ?? event.snapshotId ?? "项目级事件",
    createdAt: event.createdAt,
  }));

  return [...auditItems, ...versionItems]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, 10);
}

export default function UserSpaceActivityAside({
  project,
  context,
  isLoading,
  error,
  onRetry,
  onOpenProject,
}: {
  project: ProjectSummary | null;
  context: UserSpaceProjectContext | null;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpenProject: (project: ProjectSummary) => void;
}) {
  const timelineItems = buildTimelineItems(context);

  return (
    <aside className="user-space-activity-aside user-space-panel">
      {!project ? (
        <div className="user-space-empty-state">
          <strong>请选择一个项目查看详细信息</strong>
          <p>右侧会显示该项目的最近动态和协作成员，而不是整个平台的混合 feed。</p>
        </div>
      ) : (
        <>
          <section className="user-space-aside-card">
            <div className="user-space-aside-card-head">
              <div>
                <small>当前项目</small>
                <h3>{project.name}</h3>
              </div>
              <button type="button" className="mini-button" onClick={() => onOpenProject(project)}>
                进入工作台
              </button>
            </div>

            <div className="user-space-project-facts">
              <div>
                <span>所属空间</span>
                <strong>{project.workspaceName ?? "个人空间"}</strong>
              </div>
              <div>
                <span>所有者</span>
                <strong>{project.ownerName ?? "未知"}</strong>
              </div>
              <div>
                <span>根文件</span>
                <strong>{project.rootFile}</strong>
              </div>
              <div>
                <span>编译引擎</span>
                <strong>{project.compileEngine}</strong>
              </div>
              <div>
                <span>成员数</span>
                <strong>{project.memberCount}</strong>
              </div>
              <div>
                <span>最近修改</span>
                <strong>{formatRelativeDate(project.updatedAt)}</strong>
              </div>
              <div>
                <span>当前权限</span>
                <strong>{formatProjectRole(project.currentUserRole)}</strong>
              </div>
            </div>
          </section>

          <section className="user-space-aside-card">
            <div className="user-space-section-header">
              <div>
                <small>项目动态</small>
                <h3>最近动态</h3>
              </div>
              {isLoading ? <span className="user-space-loading-pill">加载中</span> : null}
            </div>

            {error ? (
              <div className="user-space-error-card">
                <strong>项目详情加载失败</strong>
                <p>{error}</p>
                <button type="button" className="ghost-button" onClick={onRetry}>
                  <RefreshCcw size={16} />
                  <span>重试</span>
                </button>
              </div>
            ) : isLoading && !context ? (
              <div className="user-space-skeleton-stack" aria-hidden="true">
                <div className="user-space-skeleton-line user-space-skeleton-line-wide" />
                <div className="user-space-skeleton-line" />
                <div className="user-space-skeleton-line user-space-skeleton-line-short" />
                <div className="user-space-skeleton-line user-space-skeleton-line-wide" />
              </div>
            ) : timelineItems.length === 0 ? (
              <div className="user-space-empty-note">当前项目还没有足够的审计或版本事件记录。</div>
            ) : (
              <div className="user-space-timeline">
                {timelineItems.map((item) => (
                  <div key={item.id} className="user-space-timeline-item">
                    <span className={`user-space-timeline-dot user-space-timeline-dot-${item.kind}`} />
                    <div>
                      <strong>{item.label}</strong>
                      <p>{item.detail}</p>
                      <small>{formatRelativeDate(item.createdAt)}</small>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="user-space-aside-card">
            <div className="user-space-section-header">
              <div>
                <small>协作详情</small>
                <h3>协作成员</h3>
              </div>
            </div>

            {error ? (
              <div className="user-space-empty-note">加载失败时不展示成员列表，请先重试项目上下文。</div>
            ) : isLoading && !context ? (
              <div className="user-space-skeleton-stack" aria-hidden="true">
                <div className="user-space-skeleton-member" />
                <div className="user-space-skeleton-member" />
                <div className="user-space-skeleton-member" />
              </div>
            ) : context?.members.length ? (
              <div className="user-space-member-list">
                {context.members.map((member) => (
                  <div key={member.userId} className="user-space-member-item">
                    <div className="user-space-member-avatar">{member.name.slice(0, 1).toUpperCase()}</div>
                    <div>
                      <strong>{member.name}</strong>
                      <small>{formatProjectRole(member.role)}</small>
                    </div>
                    <span>{formatRelativeDate(member.joinedAt)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="user-space-empty-note">当前项目还没有额外成员记录或只有你自己。</div>
            )}
          </section>

          <section className="user-space-aside-guardrail">
            <ShieldCheck size={16} />
            <span>右侧时间线只使用当前项目的审计日志与版本事件，不伪装成全平台活动流。</span>
          </section>
        </>
      )}
    </aside>
  );
}

/*
 * Code Review:
 * - 右栏只围绕“当前选中项目”展开，避免在没有后端支撑的情况下伪造全局活动 feed。
 * - 时间线把 audit log 和 version event 合并为统一视图，但仍保留 `kind`，后续可以继续做更细的视觉区分。
 * - 加载态使用占位骨架而不是整栏空白，符合计划里“按需加载但保持右栏稳定”的要求。
 * - 错误态只阻断右栏，不影响中栏项目浏览，保证页面主任务仍然可用。
 */
