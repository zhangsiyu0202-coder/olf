/*
 * File: ExplorePage.tsx
 * Module: apps/web (模板探索页)
 *
 * Responsibility:
 *   - 承载模板探索、模板筛选、模板详情预览和“以模板创建项目”的前端界面。
 *   - 作为写作工作台的前置入口，帮助用户先选资源，再进入编辑器。
 *
 * Runtime Logic Overview:
 *   1. 父级 `App` 提供模板列表、当前筛选状态和模板详情。
 *   2. 本组件渲染探索页布局，并把筛选和创建动作回调给上层。
 *   3. 用户选中模板后可预览文件骨架，再以该模板创建项目进入写作区。
 *
 * Dependencies:
 *   - react
 *   - ../types
 *
 * Last Updated:
 *   - 2026-03-08 by Codex - 接入官方模板镜像文案并突出论文模板优先
 */

import type { ProjectTemplateDetail, ProjectTemplateSummary, WorkspaceSummary } from "../types";

function formatTemplateDate(value: string) {
  return new Date(value).toLocaleDateString("zh-CN");
}

const categoryOptions = [
  { value: "all", label: "全部类型" },
  { value: "article", label: "通用论文" },
  { value: "conference", label: "双栏投稿" },
  { value: "thesis", label: "学位论文" },
  { value: "report", label: "报告提案" },
  { value: "book", label: "书稿" },
  { value: "slides", label: "演示文稿" },
  { value: "poster", label: "海报" },
  { value: "cv", label: "简历" },
  { value: "letter", label: "信件" },
  { value: "example", label: "功能示例" },
];

const sourceOptions = [
  { value: "all", label: "全部来源" },
  { value: "platform", label: "平台精选" },
  { value: "example", label: "功能示例" },
  { value: "official", label: "官方模板镜像" },
  { value: "team", label: "团队模板" },
  { value: "private", label: "私有模板" },
];

export default function ExplorePage({
  activeWorkspace,
  templates,
  selectedTemplateId,
  selectedTemplate,
  query,
  category,
  sourceType,
  isLoading,
  isCreating,
  onQueryChange,
  onCategoryChange,
  onSourceTypeChange,
  onSelectTemplate,
  onCreateFromTemplate,
}: {
  activeWorkspace: WorkspaceSummary | null;
  templates: ProjectTemplateSummary[];
  selectedTemplateId: string | null;
  selectedTemplate: ProjectTemplateDetail | null;
  query: string;
  category: string;
  sourceType: string;
  isLoading: boolean;
  isCreating: boolean;
  onQueryChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onSourceTypeChange: (value: string) => void;
  onSelectTemplate: (templateId: string) => void;
  onCreateFromTemplate: (template: ProjectTemplateSummary | ProjectTemplateDetail) => void;
}) {
  const primaryTemplate =
    selectedTemplate ??
    templates.find((template) => template.id === selectedTemplateId) ??
    templates[0] ??
    null;

  return (
    <main className="explore-shell">
      <section className="explore-hero">
        <div className="explore-hero-copy">
          <small>探索模板与示例工程</small>
          <h1>从资源开始，而不是从空白页开始</h1>
          <p>
            探索页现在作为写论文的前置入口。所有模板都能直接创建项目并进入编辑器，不保留只能展示的外链花瓶。
          </p>
          <div className="explore-hero-meta">
            <span>当前工作空间：{activeWorkspace?.name ?? "未选择工作空间"}</span>
            <span>模板数量：{templates.length}</span>
          </div>
        </div>
          <div className="explore-hero-card">
          <strong>当前资源策略</strong>
          <ul>
            <li>平台精选覆盖论文主链路，保留通用论文、综述、补充材料与审稿回复等高频场景</li>
            <li>功能示例模板保留给 BibTeX、相关工作等专项练习与演示</li>
            <li>官方模板镜像已接入 IEEEtran、acmart、elsarticle、llncs，以及 CVPR / ICCV / 3DV、NeurIPS、ICML、ICLR、AAAI、ACL、ECCV、AISTATS、COLM、KDD、WWW、SIGIR、CIKM</li>
            <li>进入探索页主列表的模板，必须可以直接创建项目并继续写作</li>
          </ul>
        </div>
      </section>

      <section className="explore-filters">
        <label className="explore-filter-search">
          <span>⌕</span>
          <input
            type="text"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="搜索模板、标签或用途"
          />
        </label>
        <label className="explore-filter-select">
          <span>类型</span>
          <select value={category} onChange={(event) => onCategoryChange(event.target.value)}>
            {categoryOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="explore-filter-select">
          <span>来源</span>
          <select value={sourceType} onChange={(event) => onSourceTypeChange(event.target.value)}>
            {sourceOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="explore-layout">
        <div className="explore-template-list">
          {isLoading ? <div className="explore-empty-card">模板目录加载中...</div> : null}
          {!isLoading && templates.length === 0 ? <div className="explore-empty-card">当前筛选下没有匹配模板</div> : null}
          {!isLoading
            ? templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className={`explore-template-card${
                    template.id === primaryTemplate?.id ? " explore-template-card-active" : ""
                  }`}
                  onClick={() => onSelectTemplate(template.id)}
                >
                  <div className="explore-template-card-top">
                    <div>
                      <strong>{template.title}</strong>
                      <small>
                        {template.categoryLabel} · {template.sourceLabel} · {template.trustLabel}
                      </small>
                    </div>
                    {template.featured ? <span className="explore-pill">推荐</span> : null}
                  </div>
                  <p>{template.description}</p>
                  <div className="explore-template-tags">
                    {template.tags.slice(0, 4).map((tag) => (
                      <span key={`${template.id}-${tag}`} className="explore-tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                  <div className="explore-template-meta">
                    <span>可直接创建</span>
                    <span>{template.compileEngine}</span>
                    <span>{template.fileCount} 个文件</span>
                    <span>更新于 {formatTemplateDate(template.updatedAt)}</span>
                  </div>
                </button>
              ))
            : null}
        </div>

        <div className="explore-template-detail">
          {!primaryTemplate ? <div className="explore-empty-card">请选择一个模板查看详情</div> : null}
          {primaryTemplate ? (
            <>
              <div className="explore-detail-header">
                <div>
                  <small>
                    {primaryTemplate.categoryLabel} · {primaryTemplate.sourceLabel} · {primaryTemplate.trustLabel}
                  </small>
                  <h2>{primaryTemplate.title}</h2>
                  <p>{primaryTemplate.description}</p>
                </div>
                <div className="explore-detail-actions">
                  <button
                    type="button"
                    className="accent-button"
                    disabled={isCreating}
                    onClick={() => onCreateFromTemplate(primaryTemplate)}
                  >
                    {isCreating ? "创建中..." : "以此模板创建项目"}
                  </button>
                </div>
              </div>

              <div className="explore-detail-grid">
                <div className="explore-detail-card">
                  <strong>适用场景</strong>
                  <ul>
                    {primaryTemplate.recommendedFor.map((item) => (
                      <li key={`${primaryTemplate.id}-usage-${item}`}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div className="explore-detail-card">
                  <strong>模板亮点</strong>
                  <ul>
                    {primaryTemplate.highlights.map((item) => (
                      <li key={`${primaryTemplate.id}-highlight-${item}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="explore-detail-card">
                <strong>可信信息</strong>
                <ul>
                  <li>来源类型：{primaryTemplate.sourceLabel}</li>
                  <li>可信标签：{primaryTemplate.trustLabel}</li>
                  <li>提供方：{primaryTemplate.providerName ?? "平台内置"}</li>
                  <li>当前接入方式：本地镜像，可直接创建并进入编辑器</li>
                </ul>
              </div>

              <div className="explore-detail-card">
                <strong>主文件预览</strong>
                <small>
                  {primaryTemplate.compileEngine} · {primaryTemplate.rootFile}
                </small>
                <pre>{selectedTemplate?.previewSnippet ?? "暂无预览"}</pre>
              </div>

              <div className="explore-detail-card">
                <strong>文件骨架</strong>
                <div className="explore-file-preview-list">
                  {(selectedTemplate?.files ?? []).map((file: ProjectTemplateDetail["files"][number]) => (
                    <div key={`${primaryTemplate.id}-${file.path}`} className="explore-file-preview-card">
                      <strong>{file.path}</strong>
                      <pre>{file.preview}</pre>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : null}
        </div>
      </section>
    </main>
  );
}

/*
 * Code Review:
 * - 探索页把“模板列表”和“模板详情”拆成左右布局，优先满足选资源再进入写作的主链路，而不是堆砌营销式卡片墙。
 * - 模板过滤维度只保留“类型 + 来源 + 搜索词”，遵循简单优先，避免过早做复杂 faceted search。
 * - 当前探索页只收录可直接创建的本地模板，避免出现“选了模板却不能进入编辑器”的产品断层。
 */
