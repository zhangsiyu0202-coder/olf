/*
 * File: ExplorePage.tsx
 * Module: apps/web (模板探索页)
 *
 * Responsibility:
 *   - 把模板探索入口组织成“分类总览 + 分类详情”双视图，帮助用户先选写作场景，再挑具体模板。
 *   - 在不引入新路由和不改后端接口的前提下，把模板搜索、来源过滤和详情展开都收敛在前端视图层。
 *
 * Runtime Logic Overview:
 *   1. 父级 `App` 提供全量模板目录、当前搜索词、来源过滤和已选模板详情。
 *   2. 本组件在内存中按分类分组模板，并在“分类总览 / 分类详情”之间切换。
 *   3. 用户进入分类后可浏览模板卡片，并在同页下方展开详情后直接创建项目。
 *
 * Dependencies:
 *   - react
 *   - ../types
 *
 * Last Updated:
 *   - 2026-03-09 by Codex - 重构为分类总览与分类详情双视图模板广场
 */

import { useEffect, useMemo, useState } from "react";
import type { ProjectTemplateDetail, ProjectTemplateSummary, WorkspaceSummary } from "../types";

type ExploreViewMode = "overview" | "category";

type ExploreCategoryDefinition = {
  key: string;
  title: string;
  description: string;
  tags: string[];
};

type ExploreCategorySummary = ExploreCategoryDefinition & {
  templates: ProjectTemplateSummary[];
  count: number;
};

const templateTitleCollator = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "base",
});

const sourceOptions = [
  { value: "all", label: "全部来源" },
  { value: "platform", label: "平台精选" },
  { value: "official", label: "官方模板镜像" },
  { value: "example", label: "功能示例" },
];

const categoryDefinitions: ExploreCategoryDefinition[] = [
  {
    key: "article",
    title: "通用论文",
    description: "适合期刊论文、预印本和标准学术文章的起稿模板。",
    tags: ["journal", "preprint", "research"],
  },
  {
    key: "conference",
    title: "会议投稿",
    description: "聚合双栏和官方 author kit，适合作为会议投稿起点。",
    tags: ["conference", "review", "camera-ready"],
  },
  {
    key: "thesis",
    title: "学位论文",
    description: "面向毕业论文和章节型长文写作的完整骨架。",
    tags: ["thesis", "chapters", "longform"],
  },
  {
    key: "report",
    title: "报告 / 提案",
    description: "适合技术报告、研究提案和补充材料等结构化文稿。",
    tags: ["report", "proposal", "supplement"],
  },
  {
    key: "book",
    title: "书稿",
    description: "适合章节型写作和长篇排版的书稿模板。",
    tags: ["book", "chapters", "manuscript"],
  },
  {
    key: "slides",
    title: "演示文稿",
    description: "用于答辩、汇报和讲座的 LaTeX 幻灯片模板。",
    tags: ["slides", "beamer", "presentation"],
  },
  {
    key: "poster",
    title: "海报",
    description: "适合学术海报和展板场景的版面模板。",
    tags: ["poster", "layout", "visual"],
  },
  {
    key: "cv",
    title: "简历",
    description: "适合作为个人履历和学术主页材料的简洁模板。",
    tags: ["cv", "resume", "profile"],
  },
  {
    key: "letter",
    title: "信件",
    description: "用于投稿附信、推荐信和正式往来函件。",
    tags: ["letter", "cover", "formal"],
  },
  {
    key: "example",
    title: "功能示例",
    description: "保留给 BibTeX、相关工作与专项练习等功能演示模板。",
    tags: ["example", "bibtex", "practice"],
  },
];

function formatTemplateDate(value: string) {
  return new Date(value).toLocaleDateString("zh-CN");
}

function getSourceLabel(sourceType: string) {
  return sourceOptions.find((option) => option.value === sourceType)?.label ?? sourceType;
}

function buildTemplateSearchText(template: ProjectTemplateSummary) {
  return [
    template.title,
    template.description,
    template.categoryLabel,
    template.sourceLabel,
    template.trustLabel,
    template.providerName ?? "",
    ...template.tags,
    ...template.highlights,
    ...template.recommendedFor,
  ]
    .join(" ")
    .toLowerCase();
}

function sortTemplates(templates: ProjectTemplateSummary[]) {
  return [...templates].sort((left, right) => {
    const leftPriority = left.sourceType === "official" ? 0 : 1;
    const rightPriority = right.sourceType === "official" ? 0 : 1;
    const sourceDelta = leftPriority - rightPriority;

    if (sourceDelta !== 0) {
      return sourceDelta;
    }

    const featuredDelta = Number(right.featured) - Number(left.featured);

    if (featuredDelta !== 0) {
      return featuredDelta;
    }

    return templateTitleCollator.compare(left.title, right.title);
  });
}

function getVisibleTemplates({
  templates,
  query,
  sourceType,
}: {
  templates: ProjectTemplateSummary[];
  query: string;
  sourceType: string;
}) {
  const normalizedQuery = query.trim().toLowerCase();

  return templates.filter((template) => {
    if (sourceType !== "all" && template.sourceType !== sourceType) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    return buildTemplateSearchText(template).includes(normalizedQuery);
  });
}

function buildCategorySummaries(templates: ProjectTemplateSummary[]) {
  return categoryDefinitions
    .map((definition) => {
      const categoryTemplates = sortTemplates(templates.filter((template) => template.category === definition.key));

      return {
        ...definition,
        templates: categoryTemplates,
        count: categoryTemplates.length,
      };
    })
    .filter((summary) => summary.count > 0);
}

function buildFeaturedTemplates(templates: ProjectTemplateSummary[]) {
  const sortedTemplates = sortTemplates(templates);
  const featuredTemplates = sortedTemplates.filter((template) => template.featured);
  const fallbackTemplates = sortedTemplates.filter((template) => !template.featured);

  return [...featuredTemplates, ...fallbackTemplates].slice(0, 3);
}

function CategoryCover({ categoryKey }: { categoryKey: string }) {
  return (
    <div className="explore-category-cover" data-category={categoryKey} aria-hidden="true">
      <span className="explore-category-shape explore-category-shape-1" />
      <span className="explore-category-shape explore-category-shape-2" />
      <span className="explore-category-shape explore-category-shape-3" />
      <span className="explore-category-shape explore-category-shape-4" />
      <span className="explore-category-shape explore-category-shape-5" />
    </div>
  );
}

function TemplateCard({
  template,
  selected,
  emphasis = "default",
  onSelect,
}: {
  template: ProjectTemplateSummary;
  selected: boolean;
  emphasis?: "default" | "featured";
  onSelect: (templateId: string) => void;
}) {
  return (
    <button
      type="button"
      className={`explore-template-summary-card${
        selected ? " explore-template-summary-card-active" : ""
      }${emphasis === "featured" ? " explore-template-summary-card-featured" : ""}`}
      onClick={() => onSelect(template.id)}
    >
      <div className="explore-template-summary-card-head">
        <div>
          <small>
            {template.sourceLabel} · {template.trustLabel}
          </small>
          <strong>{template.title}</strong>
        </div>
        {template.featured ? <span className="explore-pill">推荐</span> : null}
      </div>
      <p>{template.description}</p>
      <div className="explore-template-tags">
        {template.tags.slice(0, emphasis === "featured" ? 4 : 3).map((tag) => (
          <span key={`${template.id}-${tag}`} className="explore-tag">
            {tag}
          </span>
        ))}
      </div>
      <div className="explore-template-meta">
        <span>{template.compileEngine}</span>
        <span>{template.fileCount} 个文件</span>
        <span>更新于 {formatTemplateDate(template.updatedAt)}</span>
      </div>
    </button>
  );
}

function TemplateDetailPanel({
  template,
  selectedTemplate,
  isCreating,
  onCreateFromTemplate,
}: {
  template: ProjectTemplateSummary;
  selectedTemplate: ProjectTemplateDetail | null;
  isCreating: boolean;
  onCreateFromTemplate: (template: ProjectTemplateSummary | ProjectTemplateDetail) => void;
}) {
  const detailReady = selectedTemplate?.id === template.id;
  const previewSnippet = detailReady ? selectedTemplate.previewSnippet : "正在加载主文件预览...";
  const filePaths = detailReady ? selectedTemplate.files.map((file) => file.path) : [];

  return (
    <section className="explore-detail-panel">
      <div className="explore-detail-panel-header">
        <div className="explore-detail-panel-copy">
          <small>
            {template.categoryLabel} · {template.sourceLabel} · {template.trustLabel}
          </small>
          <h3>{template.title}</h3>
          <p>{template.description}</p>
          <div className="explore-template-tags">
            {template.tags.slice(0, 5).map((tag) => (
              <span key={`${template.id}-detail-${tag}`} className="explore-tag">
                {tag}
              </span>
            ))}
          </div>
        </div>
        <div className="explore-detail-actions">
          <button
            type="button"
            className="accent-button"
            disabled={isCreating}
            onClick={() => onCreateFromTemplate(detailReady ? selectedTemplate : template)}
          >
            {isCreating ? "创建中..." : "以此模板创建项目"}
          </button>
        </div>
      </div>

      <div className="explore-detail-grid">
        <div className="explore-detail-card">
          <strong>适用场景</strong>
          <ul>
            {template.recommendedFor.map((item) => (
              <li key={`${template.id}-usage-${item}`}>{item}</li>
            ))}
          </ul>
        </div>

        <div className="explore-detail-card">
          <strong>模板亮点</strong>
          <ul>
            {template.highlights.map((item) => (
              <li key={`${template.id}-highlight-${item}`}>{item}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="explore-detail-card">
        <strong>关键信息</strong>
        <div className="explore-detail-facts">
          <div className="explore-detail-fact">
            <span>编译引擎</span>
            <strong>{template.compileEngine}</strong>
          </div>
          <div className="explore-detail-fact">
            <span>根文件</span>
            <strong>{template.rootFile}</strong>
          </div>
          <div className="explore-detail-fact">
            <span>文件数量</span>
            <strong>{template.fileCount} 个</strong>
          </div>
          <div className="explore-detail-fact">
            <span>来源类型</span>
            <strong>{template.sourceLabel}</strong>
          </div>
          <div className="explore-detail-fact">
            <span>可信标签</span>
            <strong>{template.trustLabel}</strong>
          </div>
          <div className="explore-detail-fact">
            <span>提供方</span>
            <strong>{template.providerName ?? "平台内置"}</strong>
          </div>
        </div>
      </div>

      <div className="explore-detail-card">
        <strong>主文件预览</strong>
        <small>
          {template.compileEngine} · {template.rootFile}
        </small>
        <pre>{previewSnippet}</pre>
      </div>

      <div className="explore-detail-card">
        <strong>文件骨架</strong>
        {detailReady ? (
          <div className="explore-file-chip-list">
            {filePaths.map((path) => (
              <span key={`${template.id}-path-${path}`} className="explore-file-chip">
                {path}
              </span>
            ))}
          </div>
        ) : (
          <small>正在加载文件路径...</small>
        )}
      </div>
    </section>
  );
}

export default function ExplorePage({
  activeWorkspace,
  templates,
  selectedTemplateId,
  selectedTemplate,
  query,
  sourceType,
  isLoading,
  isCreating,
  onQueryChange,
  onSourceTypeChange,
  onSelectTemplate,
  onCreateFromTemplate,
}: {
  activeWorkspace: WorkspaceSummary | null;
  templates: ProjectTemplateSummary[];
  selectedTemplateId: string | null;
  selectedTemplate: ProjectTemplateDetail | null;
  query: string;
  sourceType: string;
  isLoading: boolean;
  isCreating: boolean;
  onQueryChange: (value: string) => void;
  onSourceTypeChange: (value: string) => void;
  onSelectTemplate: (templateId: string) => void;
  onCreateFromTemplate: (template: ProjectTemplateSummary | ProjectTemplateDetail) => void;
}) {
  const [viewMode, setViewMode] = useState<ExploreViewMode>("overview");
  const [activeCategoryKey, setActiveCategoryKey] = useState<string | null>(null);

  const visibleTemplates = useMemo(
    () =>
      getVisibleTemplates({
        templates,
        query,
        sourceType,
      }),
    [query, sourceType, templates],
  );
  const categorySummaries = useMemo(() => buildCategorySummaries(visibleTemplates), [visibleTemplates]);
  const activeCategory = useMemo(
    () => categorySummaries.find((summary) => summary.key === activeCategoryKey) ?? null,
    [activeCategoryKey, categorySummaries],
  );
  const featuredTemplates = useMemo(
    () => (activeCategory ? buildFeaturedTemplates(activeCategory.templates) : []),
    [activeCategory],
  );
  const featuredTemplateIds = useMemo(() => new Set(featuredTemplates.map((template) => template.id)), [featuredTemplates]);
  const remainingTemplates = useMemo(
    () => (activeCategory ? activeCategory.templates.filter((template) => !featuredTemplateIds.has(template.id)) : []),
    [activeCategory, featuredTemplateIds],
  );
  const selectedTemplateSummary = useMemo(
    () => activeCategory?.templates.find((template) => template.id === selectedTemplateId) ?? null,
    [activeCategory, selectedTemplateId],
  );
  const selectedTemplateDetail = selectedTemplate?.id === selectedTemplateSummary?.id ? selectedTemplate : null;

  useEffect(() => {
    if (viewMode === "category" && activeCategoryKey && !activeCategory) {
      setViewMode("overview");
      setActiveCategoryKey(null);
    }
  }, [activeCategory, activeCategoryKey, viewMode]);

  function handleOpenCategory(categoryKey: string) {
    setActiveCategoryKey(categoryKey);
    setViewMode("category");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleReturnToOverview() {
    setViewMode("overview");
    setActiveCategoryKey(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <main className="explore-shell">
      <section className="explore-page-header">
        <div className="explore-page-headline">
          {viewMode === "category" ? (
            <button type="button" className="ghost-button explore-back-button" onClick={handleReturnToOverview}>
              ← 返回所有模板
            </button>
          ) : null}
          <small>{viewMode === "overview" ? "模板类别导航" : "LaTeX 模板分类"}</small>
          <h1>{viewMode === "overview" ? "模板类别" : `LaTeX 模板 — ${activeCategory?.title ?? "模板类别"}`}</h1>
          <p>
            {viewMode === "overview"
              ? "先按写作目标选择分类，再进入模板列表挑选最合适的起稿骨架。"
              : activeCategory?.description ?? "当前分类下没有符合筛选条件的模板。"}
          </p>
          <div className="explore-page-meta">
            <span>当前工作空间：{activeWorkspace?.name ?? "未选择工作空间"}</span>
            <span>当前可用模板：{visibleTemplates.length}</span>
            <span>来源筛选：{getSourceLabel(sourceType)}</span>
          </div>
        </div>

        <div className="explore-page-toolbar">
          <label className="explore-filter-search">
            <span>⌕</span>
            <input
              type="text"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="搜索模板、标签或用途"
            />
          </label>

          <div className="explore-source-switch" aria-label="模板来源过滤">
            {sourceOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`explore-source-button${sourceType === option.value ? " explore-source-button-active" : ""}`}
                onClick={() => onSourceTypeChange(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {viewMode === "overview" ? (
        <section className="explore-overview">
          {isLoading ? <div className="explore-empty-card">模板目录加载中...</div> : null}
          {!isLoading && categorySummaries.length === 0 ? (
            <div className="explore-empty-card">当前筛选下没有匹配的模板类别</div>
          ) : null}
          {!isLoading && categorySummaries.length > 0 ? (
            <div className="explore-category-grid">
              {categorySummaries.map((category) => (
                <button
                  key={category.key}
                  type="button"
                  className="explore-category-card"
                  onClick={() => handleOpenCategory(category.key)}
                >
                  <CategoryCover categoryKey={category.key} />
                  <div className="explore-category-card-body">
                    <div className="explore-category-card-head">
                      <strong>{category.title}</strong>
                      <span className="explore-category-count">{category.count} 个模板</span>
                    </div>
                    <p>{category.description}</p>
                    <div className="explore-template-tags">
                      {category.tags.map((tag) => (
                        <span key={`${category.key}-${tag}`} className="explore-tag">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ) : (
        <section className="explore-category-shell">
          {!activeCategory ? <div className="explore-empty-card">当前分类下没有符合筛选条件的模板</div> : null}
          {activeCategory ? (
            <>
              <section className="explore-section-block">
                <div className="explore-section-heading">
                  <div>
                    <small>精选模板</small>
                    <h2>精选模板</h2>
                  </div>
                  <p>优先展示官方模板、平台精选和当前分类下最适合直接起稿的骨架。</p>
                </div>

                <div className="explore-featured-grid">
                  {featuredTemplates.map((template) => (
                    <TemplateCard
                      key={`featured-${template.id}`}
                      template={template}
                      selected={selectedTemplateId === template.id}
                      emphasis="featured"
                      onSelect={onSelectTemplate}
                    />
                  ))}
                </div>
              </section>

              {remainingTemplates.length > 0 ? (
                <section className="explore-section-block">
                  <div className="explore-section-heading">
                    <div>
                      <small>全部模板</small>
                      <h2>全部模板</h2>
                    </div>
                    <p>继续浏览当前分类下的其他模板，按来源优先级和推荐程度排序。</p>
                  </div>

                  <div className="explore-template-grid">
                    {remainingTemplates.map((template) => (
                      <TemplateCard
                        key={template.id}
                        template={template}
                        selected={selectedTemplateId === template.id}
                        onSelect={onSelectTemplate}
                      />
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="explore-section-block">
                <div className="explore-section-heading">
                  <div>
                    <small>模板详情</small>
                    <h2>模板详情</h2>
                  </div>
                  <p>
                    {selectedTemplateSummary
                      ? "当前详情在分类页内整宽展开，方便快速确认信息后继续创建项目。"
                      : "请选择一个模板查看详情。"}
                  </p>
                </div>

                {selectedTemplateSummary ? (
                  <TemplateDetailPanel
                    template={selectedTemplateSummary}
                    selectedTemplate={selectedTemplateDetail}
                    isCreating={isCreating}
                    onCreateFromTemplate={onCreateFromTemplate}
                  />
                ) : (
                  <div className="explore-empty-card">请选择一个模板查看详情</div>
                )}
              </section>
            </>
          ) : null}
        </section>
      )}
    </main>
  );
}

/*
 * Code Review:
 * - 探索页现在先展示分类、再展示模板和详情，优先满足“先选场景再挑骨架”的浏览节奏，而不是继续沿用工作台式双栏浏览器。
 * - 搜索词和来源过滤全部在前端本地完成，是因为当前模板规模很小，且分类总览需要同时感知所有分类计数；继续依赖接口过滤会让总览结构不稳定。
 * - 模板详情改为同页下方展开，明显降低了默认信息密度，但仍保留创建项目主链路和主文件预览，符合“先选模板、后读细节”的目标。
 */
