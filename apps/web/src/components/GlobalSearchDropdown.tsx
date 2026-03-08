/*
 * File: GlobalSearchDropdown.tsx
 * Module: apps/web (全局聚合搜索面板)
 *
 * Responsibility:
 *   - 展示顶栏全局搜索的分组结果，并用来源标签清晰区分不同数据源。
 *   - 把搜索结果点击动作回传给上层，由上层决定跳转项目、文件、模板或命令。
 *
 * Runtime Logic Overview:
 *   1. `App` 在输入变化后请求聚合搜索结果。
 *   2. 本组件按分组渲染结果，避免项目、文件、论文和模板混成一团。
 *   3. 点击结果后由上层执行对应跳转或动作。
 *
 * Dependencies:
 *   - react
 *   - ../types
 *
 * Last Updated:
 *   - 2026-03-08 by Codex - 初始化带来源标签的全局搜索下拉层
 */

import type { GlobalSearchGroup, GlobalSearchItem } from "../types";

function getSearchItemTypeLabel(item: GlobalSearchItem) {
  switch (item.type) {
    case "project":
      return "项目";
    case "file":
      return "文件";
    case "project-paper":
      return "项目论文";
    case "external-paper":
      return "外部论文";
    case "template":
      return "模板";
    case "command":
      return "命令";
    default:
      return "结果";
  }
}

export default function GlobalSearchDropdown({
  query,
  loading,
  groups,
  onSelect,
}: {
  query: string;
  loading: boolean;
  groups: GlobalSearchGroup[];
  onSelect: (item: GlobalSearchItem) => void;
}) {
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    return null;
  }

  return (
    <div className="global-search-dropdown">
      <div className="global-search-dropdown-header">
        <strong>全局搜索</strong>
        <small>{loading ? "搜索中..." : `关键词：${trimmedQuery}`}</small>
      </div>

      {loading ? <div className="global-search-empty">正在聚合项目、模板与论文结果...</div> : null}
      {!loading && groups.length === 0 ? <div className="global-search-empty">没有找到匹配结果</div> : null}

      {!loading
        ? groups.map((group) => (
            <section key={group.key} className="global-search-group">
              <div className="global-search-group-title">{group.label}</div>
              <div className="global-search-group-list">
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="global-search-item"
                    onClick={() => onSelect(item)}
                  >
                    <div className="global-search-item-main">
                      <strong>{item.title}</strong>
                      <small>{item.subtitle}</small>
                    </div>
                    <div className="global-search-item-meta">
                      <span className="global-search-item-type">{getSearchItemTypeLabel(item)}</span>
                      <span className="global-search-item-source">{item.sourceLabel}</span>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ))
        : null}
    </div>
  );
}

/*
 * Code Review:
 * - 搜索结果按组渲染而不是统一平铺，是为了明确区分“项目 / 文件 / 论文 / 模板 / 命令”的语义边界。
 * - 每条结果都同时显示类型标签和来源标签，避免顶栏搜索在信息密度变高后退化成不可辨认的列表。
 * - 跳转逻辑故意保留在上层，保持本组件只负责展示，不侵入项目与编辑器状态管理。
 */
