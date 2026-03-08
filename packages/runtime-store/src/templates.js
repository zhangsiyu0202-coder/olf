/*
 * File: templates.js
 * Module: packages/runtime-store (模板目录仓储)
 *
 * Responsibility:
 *   - 维护平台内置模板目录，作为“探索页”和“以模板创建项目”的单一真相来源。
 *   - 对外提供模板列表、模板详情和模板搜索，避免前端复制模板元数据。
 *
 * Runtime Logic Overview:
 *   1. API 启动后通过本模块读取内置模板目录。
 *   2. 探索页请求模板列表与详情，用于筛选、预览和创建项目。
 *   3. 创建项目时，API 从本模块读取模板文件清单，再交给项目仓储落盘。
 *
 * Key Data Flow:
 *   - 输入：模板筛选条件、搜索词、模板 ID。
 *   - 输出：模板摘要、模板详情、模板文件清单。
 *
 * Future Extension:
 *   - 后续可把“团队模板 / 私有模板 / 官方模板镜像同步任务”继续收敛到本模块。
 *   - 当前只提供可直接创建与可直接编辑的本地模板，不保留只跳外链的花瓶资源。
 *
 * Dependencies:
 *   - node:fs/promises
 *   - node:path
 *   - packages/shared/src/paths.js
 *
 * Last Updated:
 *   - 2026-03-08 by Codex - 接入官方 author kit 模板缓存解析能力
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getTemplateCachePath } from "../../shared/src/paths.js";

const execFileAsync = promisify(execFile);

function createPreviewSnippet(content, maxLines = 18) {
  return String(content ?? "")
    .split("\n")
    .slice(0, maxLines)
    .join("\n")
    .trim();
}

function normalizeTemplateFile(file) {
  return {
    path: String(file.path ?? "").trim(),
    content: String(file.content ?? ""),
  };
}

function buildSearchText(template) {
  return [
    template.title,
    template.description,
    template.category,
    template.sourceType,
    template.sourceLabel,
    template.providerName ?? "",
    template.trustLabel ?? "",
    template.availability ?? "",
    ...(template.tags ?? []),
    ...(template.highlights ?? []),
    ...(template.recommendedFor ?? []),
  ]
    .join(" ")
    .toLowerCase();
}

const cvprAuthorKitFileManifest = [
  "main.tex",
  "preamble.tex",
  "cvpr.sty",
  "ieeenat_fullname.bst",
  "main.bib",
  "sec/0_abstract.tex",
  "sec/1_intro.tex",
  "sec/2_formatting.tex",
  "sec/3_finalcopy.tex",
  "sec/X_suppl.tex",
  "rebuttal.tex",
];

function createCvprFamilyTemplate({ id, title, description, conferenceName, conferenceYear }) {
  return {
    id,
    title,
    description,
    category: "conference",
    categoryLabel: "官方会议模板",
    sourceType: "official",
    sourceLabel: "官方模板镜像",
    trustLabel: "官方 GitHub",
    providerName: "cvpr-org/author-kit",
    sourceUrl: "https://github.com/cvpr-org/author-kit",
    featured: true,
    updatedAt: "2026-03-08T00:00:00.000Z",
    compileEngine: "pdflatex",
    rootFile: "main.tex",
    tags: ["official", conferenceName.toLowerCase(), "author kit", "conference"],
    recommendedFor: [`${conferenceName} 投稿草稿`, `${conferenceName} 官方格式预排版`, "双栏视觉论文"],
    highlights: ["保留官方 author kit 目录结构", "默认可直接创建项目并进入编辑器", "支持 review/final 开关与补充材料文件"],
    fileCountHint: cvprAuthorKitFileManifest.length,
    remoteSource: {
      type: "github-raw",
      cacheKey: "cvpr-org-author-kit-main",
      baseUrl: "https://raw.githubusercontent.com/cvpr-org/author-kit/main",
      files: cvprAuthorKitFileManifest,
      patch: {
        kind: "cvpr-author-kit",
        conferenceName,
        conferenceYear,
      },
    },
  };
}

function createArchiveTemplate({
  id,
  title,
  description,
  category = "conference",
  categoryLabel = "官方会议模板",
  providerName,
  sourceUrl,
  archiveUrl,
  archiveType,
  rootFile,
  entries,
  cacheKey,
  tags,
  recommendedFor,
  highlights,
  patch,
}) {
  return {
    id,
    title,
    description,
    category,
    categoryLabel,
    sourceType: "official",
    sourceLabel: "官方模板镜像",
    trustLabel: archiveUrl.includes("github.com") ? "官方 GitHub" : "官方站点",
    providerName,
    sourceUrl,
    featured: true,
    updatedAt: "2026-03-08T00:00:00.000Z",
    compileEngine: "pdflatex",
    rootFile,
    tags,
    recommendedFor,
    highlights,
    fileCountHint: entries.length,
    remoteSource: {
      type: "archive",
      cacheKey: cacheKey ?? id,
      archiveType,
      archiveUrl,
      entries,
      patch: patch ?? null,
    },
  };
}

function createAclFamilyTemplate({ id, title, description, venueLabel }) {
  return createArchiveTemplate({
    id,
    title,
    description,
    category: "conference",
    categoryLabel: "官方 NLP 模板",
    providerName: "acl-org/acl-style-files",
    sourceUrl: "https://github.com/acl-org/acl-style-files",
    archiveUrl: "https://codeload.github.com/acl-org/acl-style-files/tar.gz/refs/heads/master",
    archiveType: "tar.gz",
    rootFile: "acl_latex.tex",
    entries: [
      { sourcePath: "acl-style-files-master/acl.sty", path: "acl.sty" },
      { sourcePath: "acl-style-files-master/acl_latex.tex", path: "acl_latex.tex" },
      { sourcePath: "acl-style-files-master/acl_natbib.bst", path: "acl_natbib.bst" },
      { sourcePath: "acl-style-files-master/anthology.bib.txt", path: "anthology.bib" },
      { sourcePath: "acl-style-files-master/custom.bib", path: "custom.bib" },
    ],
    cacheKey: "acl-style-files-master",
    tags: ["official", "acl", venueLabel.toLowerCase(), "nlp", "anthology"],
    recommendedFor: [`${venueLabel} 投稿草稿`, "ACL Anthology 格式预演", "NLP 会议论文"],
    highlights: ["直接镜像 ACL 官方样式仓库", "保留官方 bst 与 bib 样例", "后续扩 EMNLP / NAACL 可复用同一套缓存"],
  });
}

function createAcmVenueTemplate({
  id,
  title,
  description,
  venueLabel,
  yearLabel,
  dateLabel,
  locationLabel,
  recommendedFor,
}) {
  return {
    id,
    title,
    description,
    category: "conference",
    categoryLabel: "官方 ACM 模板",
    sourceType: "official",
    sourceLabel: "官方类包镜像",
    trustLabel: "官方类包",
    providerName: "acmart",
    featured: true,
    updatedAt: "2026-03-08T00:00:00.000Z",
    compileEngine: "pdflatex",
    rootFile: "main.tex",
    tags: ["ACM", "acmart", "sigconf", "official", venueLabel.toLowerCase()],
    recommendedFor,
    highlights: ["直接基于 acmart.cls 的 sigconf 模式", "保留会议专用元数据骨架", "适合按官方 ACM proceedings 要求起稿"],
    files: [
      {
        path: "main.tex",
        content: [
          "\\documentclass[sigconf,review]{acmart}",
          "\\setcopyright{none}",
          `\\copyrightyear{${yearLabel}}`,
          `\\acmYear{${yearLabel}}`,
          "\\acmDOI{0000000.0000000}",
          `\\acmConference[${venueLabel} '${String(yearLabel).slice(-2)}]{${venueLabel} ${yearLabel}}{${dateLabel}}{${locationLabel}}`,
          `\\acmBooktitle{${venueLabel} ${yearLabel}}`,
          "\\acmISBN{978-1-4503-XXXX-X/XX/XX}",
          "",
          `\\title{${venueLabel} Paper Title}`,
          "\\author{First Author}",
          "\\affiliation{\\institution{Example University}\\country{China}}",
          "\\email{author@example.com}",
          "",
          "\\begin{document}",
          "\\begin{abstract}",
          `Write the abstract for your ${venueLabel} submission here.`,
          "\\end{abstract}",
          "\\maketitle",
          "",
          "\\section{Introduction}",
          "Introduce the research problem, motivation, and contributions here.",
          "",
          "\\section{Method}",
          "Describe the proposed method, system, or modeling approach here.",
          "",
          "\\section{Experiments}",
          "Summarize datasets, setup, baselines, and quantitative results here.",
          "",
          "\\section{Conclusion}",
          "Close the paper with key findings and future work.",
          "",
          "\\bibliographystyle{ACM-Reference-Format}",
          "\\bibliography{refs}",
          "\\end{document}",
          "",
        ].join("\n"),
      },
      {
        path: "refs.bib",
        content: [
          `@inproceedings{${venueLabel.toLowerCase()}_sample_${yearLabel},`,
          "  title={An ACM Conference Style Sample Reference},",
          "  author={Researcher, Riley and Author, Alex},",
          `  booktitle={Proceedings of ${venueLabel} ${yearLabel}},`,
          `  year={${yearLabel}}`,
          "}",
          "",
        ].join("\n"),
      },
    ],
  };
}

async function readTemplateCache(template) {
  const cachePath = getTemplateCachePath(template.remoteSource?.cacheKey ?? template.id);

  try {
    const content = await fs.readFile(cachePath, "utf8");
    const payload = JSON.parse(content);

    if (payload.cacheVersion !== template.updatedAt || !Array.isArray(payload.files)) {
      return null;
    }

    return payload.files.map(normalizeTemplateFile);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function writeTemplateCache(template, files) {
  const cachePath = getTemplateCachePath(template.remoteSource?.cacheKey ?? template.id);
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(
    cachePath,
    JSON.stringify(
      {
        cacheVersion: template.updatedAt,
        cachedAt: new Date().toISOString(),
        files,
      },
      null,
      2,
    ),
    "utf8",
  );
}

function patchCvprAuthorKitMain(content, patchOptions) {
  const conferenceName = String(patchOptions.conferenceName ?? "CVPR");
  const conferenceYear = String(patchOptions.conferenceYear ?? "20XX");

  let nextContent = String(content ?? "");
  nextContent = nextContent.replace(/\\def\\paperID\{[^}]*\}/, "\\def\\paperID{0000}");
  nextContent = nextContent.replace(/\\def\\confName\{[^}]*\}/, `\\def\\confName{${conferenceName}}`);
  nextContent = nextContent.replace(/\\def\\confYear\{[^}]*\}/, `\\def\\confYear{${conferenceYear}}`);
  nextContent = nextContent.replace(/\\title\{[^\n]*\}/, "\\title{Project Title}");
  nextContent = nextContent.replace(
    /\\author\{[\s\S]*?\n\}\n\n\\begin\{document\}/,
    [
      "\\author{Anonymous Author(s)}",
      "",
      "\\begin{document}",
    ].join("\n"),
  );

  return nextContent;
}

function createFigurePlaceholder(widthExpression, label) {
  return `\\fbox{\\parbox[c][1.55in][c]{${widthExpression}}{\\centering ${label}}}`;
}

function patchIcmlExamplePaper(content) {
  return String(content ?? "").replace(
    /\\centerline\{\\includegraphics\[width=\\columnwidth\]\{icml_numpapers\}\}/,
    `\\centerline{${createFigurePlaceholder("0.92\\columnwidth", "Figure Placeholder")}}`,
  );
}

function patchAaaiExamplePaper(content) {
  return String(content ?? "")
    .replace(
      /\\includegraphics\[width=0\.9\\columnwidth\]\{figure1\}/,
      createFigurePlaceholder("0.82\\columnwidth", "Figure 1 Placeholder"),
    )
    .replace(
      /\\includegraphics\[width=0\.8\\textwidth\]\{figure2\}/,
      createFigurePlaceholder("0.72\\textwidth", "Figure 2 Placeholder"),
    );
}

function patchEccvMain(content) {
  return String(content ?? "").replace(
    /\\includegraphics\[height=6\.5cm\]\{eijkel2\}/,
    createFigurePlaceholder("0.82\\linewidth", "ECCV Figure Placeholder"),
  );
}

function patchRemoteTemplateFileContent(template, filePath, content) {
  if (template.remoteSource?.patch?.kind === "cvpr-author-kit" && filePath === "main.tex") {
    return patchCvprAuthorKitMain(content, template.remoteSource.patch);
  }

  if (template.remoteSource?.patch?.kind === "icml-example-paper" && filePath === "example_paper.tex") {
    return patchIcmlExamplePaper(content);
  }

  if (
    template.remoteSource?.patch?.kind === "aaai-anonymous-submission" &&
    filePath === "anonymous-submission-latex-2025.tex"
  ) {
    return patchAaaiExamplePaper(content);
  }

  if (
    template.remoteSource?.patch?.kind === "aaai-camera-ready" &&
    filePath === "Formatting-Instructions-LaTeX-2025.tex"
  ) {
    return patchAaaiExamplePaper(content);
  }

  if (template.remoteSource?.patch?.kind === "eccv-paper-template" && filePath === "main.tex") {
    return patchEccvMain(content);
  }

  return content;
}

async function downloadRemoteTemplateText(url) {
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.text();
    } catch (fetchError) {
      lastError = fetchError;

      try {
        const { stdout } = await execFileAsync("curl", ["-L", "--fail", "--silent", "--show-error", url], {
          maxBuffer: 8 * 1024 * 1024,
        });

        if (stdout) {
          return stdout;
        }
      } catch (curlError) {
        lastError = curlError;
      }
    }

    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }

  throw lastError ?? new Error(`官方模板文件拉取失败: ${url}`);
}

async function downloadRemoteArchiveFile(archiveUrl, archiveType) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "template-archive-"));
  const archiveFileName = archiveType === "tar.gz" ? "template.tar.gz" : "template.zip";
  const archivePath = path.join(tempDir, archiveFileName);

  try {
    let lastError = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(archiveUrl);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        await fs.writeFile(archivePath, buffer);
        return { tempDir, archivePath };
      } catch (fetchError) {
        lastError = fetchError;

        try {
          await execFileAsync("curl", ["-L", "--fail", "--silent", "--show-error", archiveUrl, "-o", archivePath], {
            maxBuffer: 16 * 1024 * 1024,
          });
          return { tempDir, archivePath };
        } catch (curlError) {
          lastError = curlError;
        }
      }

      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }

    throw lastError ?? new Error(`官方模板归档下载失败: ${archiveUrl}`);
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

async function readArchiveEntryText(archivePath, archiveType, sourcePath) {
  const command =
    archiveType === "tar.gz"
      ? { file: "tar", args: ["-xOf", archivePath, sourcePath] }
      : { file: "unzip", args: ["-p", archivePath, sourcePath] };
  const { stdout } = await execFileAsync(command.file, command.args, {
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

async function downloadRemoteArchiveEntries(template) {
  const { archiveUrl, archiveType, entries } = template.remoteSource;
  const { tempDir, archivePath } = await downloadRemoteArchiveFile(archiveUrl, archiveType);

  try {
    const files = [];

    for (const entry of entries) {
      const rawContent = await readArchiveEntryText(archivePath, archiveType, entry.sourcePath);
      files.push(
        normalizeTemplateFile({
          path: entry.path,
          content: rawContent,
        }),
      );
    }

    return files;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

/**
 * 解析模板文件清单。
 * 本地模板直接返回内置文件；远端官方模板优先读缓存，缓存缺失时再从官方源抓取。
 */
async function resolveTemplateFiles(template) {
  if (template.files.length > 0) {
    return template.files;
  }

  if (!template.remoteSource) {
    return [];
  }

  const cachedFiles = await readTemplateCache(template);

  if (cachedFiles) {
    return cachedFiles.map((file) =>
      normalizeTemplateFile({
        path: file.path,
        content: patchRemoteTemplateFileContent(template, file.path, file.content),
      }),
    );
  }

  try {
    const fetchedFiles =
      template.remoteSource.type === "archive"
        ? await downloadRemoteArchiveEntries(template)
        : await Promise.all(
            template.remoteSource.files.map(async (filePath) => {
              const rawContent = await downloadRemoteTemplateText(`${template.remoteSource.baseUrl}/${filePath}`);
              return normalizeTemplateFile({
                path: filePath,
                content: rawContent,
              });
            }),
          );

    await writeTemplateCache(template, fetchedFiles);
    return fetchedFiles.map((file) =>
      normalizeTemplateFile({
        path: file.path,
        content: patchRemoteTemplateFileContent(template, file.path, file.content),
      }),
    );
  } catch (error) {
    const fallbackFiles = await readTemplateCache(template);

    if (fallbackFiles) {
      return fallbackFiles.map((file) =>
        normalizeTemplateFile({
          path: file.path,
          content: patchRemoteTemplateFileContent(template, file.path, file.content),
        }),
      );
    }

    throw error;
  }
}

const builtInTemplates = [
  {
    id: "paper-article-starter",
    title: "论文通用起步模板",
    description: "适合从零开始写论文、课程报告或技术说明，内置章节拆分和参考文献文件。",
    category: "article",
    categoryLabel: "通用论文",
    sourceType: "platform",
    sourceLabel: "平台精选",
    featured: true,
    updatedAt: "2026-03-08T00:00:00.000Z",
    compileEngine: "pdflatex",
    rootFile: "main.tex",
    tags: ["article", "latex", "starter", "refs.bib"],
    recommendedFor: ["课程论文", "技术报告", "从零开始写论文"],
    highlights: ["章节按目录拆分", "预置 BibTeX 文件", "可直接进入编辑器继续写作"],
    files: [
      {
        path: "main.tex",
        content: [
          "\\documentclass[11pt]{article}",
          "\\usepackage[margin=1in]{geometry}",
          "\\usepackage{graphicx}",
          "\\usepackage{booktabs}",
          "\\usepackage{hyperref}",
          "",
          "\\title{Paper Title}",
          "\\author{Author Name}",
          "\\date{\\today}",
          "",
          "\\begin{document}",
          "\\maketitle",
          "",
          "\\begin{abstract}",
          "Replace this abstract with your own summary.",
          "\\end{abstract}",
          "",
          "\\input{sections/introduction}",
          "\\input{sections/method}",
          "\\input{sections/conclusion}",
          "",
          "\\bibliographystyle{plain}",
          "\\bibliography{refs}",
          "",
          "\\end{document}",
          "",
        ].join("\n"),
      },
      {
        path: "sections/introduction.tex",
        content: [
          "\\section{Introduction}",
          "Describe the problem, motivation, and contributions here.",
          "",
        ].join("\n"),
      },
      {
        path: "sections/method.tex",
        content: [
          "\\section{Method}",
          "Explain your method, assumptions, and implementation details here.",
          "",
        ].join("\n"),
      },
      {
        path: "sections/conclusion.tex",
        content: [
          "\\section{Conclusion}",
          "Summarize the main findings and future work here.",
          "",
        ].join("\n"),
      },
      {
        path: "refs.bib",
        content: [
          "@article{example2026starter,",
          "  title={A Starter Reference Entry},",
          "  author={Doe, Jane and Doe, John},",
          "  journal={Journal of Writing Systems},",
          "  year={2026}",
          "}",
          "",
        ].join("\n"),
      },
    ],
  },
  {
    id: "survey-paper-template",
    title: "文献综述模板",
    description: "面向 survey / related work 长文写作，强调主题分组、研究脉络和开放问题。",
    category: "article",
    categoryLabel: "论文场景模板",
    sourceType: "platform",
    sourceLabel: "平台精选",
    featured: true,
    updatedAt: "2026-03-08T00:00:00.000Z",
    compileEngine: "pdflatex",
    rootFile: "survey.tex",
    tags: ["survey", "review", "related work"],
    recommendedFor: ["文献综述论文", "领域调研长文", "Related Work 扩展稿"],
    highlights: ["按主题组织相关工作", "保留 taxonomy 与 open problems 结构", "适合论文检索模块配合写作"],
    files: [
      {
        path: "survey.tex",
        content: [
          "\\documentclass[11pt]{article}",
          "\\usepackage[margin=1in]{geometry}",
          "\\usepackage{booktabs}",
          "\\usepackage{hyperref}",
          "",
          "\\title{Survey Title}",
          "\\author{Author Name}",
          "\\date{\\today}",
          "",
          "\\begin{document}",
          "\\maketitle",
          "\\begin{abstract}",
          "Summarize the scope, taxonomy, and main insights of the survey here.",
          "\\end{abstract}",
          "\\input{sections/introduction}",
          "\\input{sections/taxonomy}",
          "\\input{sections/challenges}",
          "\\input{sections/open_problems}",
          "\\bibliographystyle{plain}",
          "\\bibliography{refs}",
          "\\end{document}",
          "",
        ].join("\n"),
      },
      { path: "sections/introduction.tex", content: "\\section{Introduction}\nExplain the survey scope and motivation here.\n" },
      { path: "sections/taxonomy.tex", content: "\\section{Taxonomy}\nGroup prior work by theme, assumption, or methodology here.\n" },
      { path: "sections/challenges.tex", content: "\\section{Challenges}\nSummarize recurring limitations and unresolved challenges here.\n" },
      { path: "sections/open_problems.tex", content: "\\section{Open Problems}\nList future research directions and open questions here.\n" },
      {
        path: "refs.bib",
        content: [
          "@article{survey_sample_2026,",
          "  title={A Survey Sample Reference},",
          "  author={Reviewer, Robin},",
          "  journal={Journal of Survey Examples},",
          "  year={2026}",
          "}",
          "",
        ].join("\n"),
      },
    ],
  },
  {
    id: "two-column-submission",
    title: "双栏投稿风格模板",
    description: "使用标准 article 双栏模式搭建投稿风格骨架，适合相关工作和实验结果密集的论文。",
    category: "conference",
    categoryLabel: "双栏投稿",
    sourceType: "platform",
    sourceLabel: "平台精选",
    featured: true,
    updatedAt: "2026-03-08T00:00:00.000Z",
    compileEngine: "pdflatex",
    rootFile: "main.tex",
    tags: ["conference", "two-column", "submission"],
    recommendedFor: ["会议投稿草稿", "双栏排版预演"],
    highlights: ["双栏布局", "实验表格示例", "投稿风格起步结构"],
    files: [
      {
        path: "main.tex",
        content: [
          "\\documentclass[10pt,twocolumn]{article}",
          "\\usepackage[a4paper,margin=0.72in]{geometry}",
          "\\usepackage{graphicx}",
          "\\usepackage{booktabs}",
          "\\usepackage{hyperref}",
          "",
          "\\title{Two-Column Submission Draft}",
          "\\author{Anonymous Author(s)}",
          "\\date{}",
          "",
          "\\begin{document}",
          "\\maketitle",
          "",
          "\\begin{abstract}",
          "Summarize your paper in 150 to 250 words.",
          "\\end{abstract}",
          "",
          "\\input{sections/introduction}",
          "\\input{sections/experiments}",
          "\\input{sections/related_work}",
          "",
          "\\bibliographystyle{plain}",
          "\\bibliography{refs}",
          "\\end{document}",
          "",
        ].join("\n"),
      },
      {
        path: "sections/introduction.tex",
        content: [
          "\\section{Introduction}",
          "State the problem, why it matters, and what your paper contributes.",
          "",
        ].join("\n"),
      },
      {
        path: "sections/experiments.tex",
        content: [
          "\\section{Experiments}",
          "\\begin{table}[t]",
          "  \\centering",
          "  \\caption{Example result table.}",
          "  \\begin{tabular}{lcc}",
          "    \\toprule",
          "    Method & Accuracy & F1 \\\\",
          "    \\midrule",
          "    Baseline & 0.71 & 0.68 \\\\",
          "    Ours & 0.84 & 0.81 \\\\",
          "    \\bottomrule",
          "  \\end{tabular}",
          "\\end{table}",
          "",
        ].join("\n"),
      },
      {
        path: "sections/related_work.tex",
        content: [
          "\\section{Related Work}",
          "Organize prior work by theme rather than by publication year only.",
          "",
        ].join("\n"),
      },
      {
        path: "refs.bib",
        content: [
          "@inproceedings{example2026submission,",
          "  title={An Example Submission Reference},",
          "  author={Author, Alice and Author, Bob},",
          "  booktitle={Conference on Example Systems},",
          "  year={2026}",
          "}",
          "",
        ].join("\n"),
      },
    ],
  },
  {
    id: "supplementary-material-template",
    title: "补充材料模板",
    description: "面向论文 supplementary material，适合附加实验、证明和额外图表。",
    category: "article",
    categoryLabel: "论文场景模板",
    sourceType: "platform",
    sourceLabel: "平台精选",
    featured: false,
    updatedAt: "2026-03-08T00:00:00.000Z",
    compileEngine: "pdflatex",
    rootFile: "supplementary.tex",
    tags: ["supplementary", "appendix", "extra experiments"],
    recommendedFor: ["投稿补充材料", "额外实验说明", "附录文档"],
    highlights: ["重点强调 appendix 和 experiment details", "便于从主论文拆分补充材料"],
    files: [
      {
        path: "supplementary.tex",
        content: [
          "\\documentclass[11pt]{article}",
          "\\usepackage[margin=1in]{geometry}",
          "\\usepackage{graphicx}",
          "\\title{Supplementary Material}",
          "\\author{Author Name}",
          "\\date{}",
          "\\begin{document}",
          "\\maketitle",
          "\\section{Additional Experimental Details}",
          "Provide the extra experiment settings and implementation notes here.",
          "\\section{Additional Results}",
          "Add more tables and ablation results here.",
          "\\appendix",
          "\\section{Proofs and Derivations}",
          "Place extended proofs or derivations here.",
          "\\end{document}",
          "",
        ].join("\n"),
      },
    ],
  },
  {
    id: "rebuttal-response-template",
    title: "审稿回复模板",
    description: "面向 rebuttal / response letter，适合逐点评审意见并组织修改说明。",
    category: "article",
    categoryLabel: "论文场景模板",
    sourceType: "platform",
    sourceLabel: "平台精选",
    featured: false,
    updatedAt: "2026-03-08T00:00:00.000Z",
    compileEngine: "pdflatex",
    rootFile: "response.tex",
    tags: ["rebuttal", "response", "reviewers"],
    recommendedFor: ["rebuttal", "审稿回复", "revision cover letter"],
    highlights: ["按 reviewer 分节", "修改摘要和逐点回复并列", "适合版本追踪和协作修改"],
    files: [
      {
        path: "response.tex",
        content: [
          "\\documentclass[11pt]{article}",
          "\\usepackage[margin=1in]{geometry}",
          "\\title{Response to Reviewers}",
          "\\author{Author Team}",
          "\\date{}",
          "\\begin{document}",
          "\\maketitle",
          "\\section*{Summary of Revisions}",
          "Briefly summarize the major changes made in the revised manuscript.",
          "\\section*{Response to Reviewer 1}",
          "\\textbf{Comment:} Copy the reviewer comment here.\\\\",
          "\\textbf{Response:} Write the response here.",
          "\\section*{Response to Reviewer 2}",
          "\\textbf{Comment:} Copy the reviewer comment here.\\\\",
          "\\textbf{Response:} Write the response here.",
          "\\end{document}",
          "",
        ].join("\n"),
      },
    ],
  },
  {
    id: "ieeetran-conference-template",
    title: "IEEEtran 会议论文模板",
    description: "基于官方 IEEEtran 类包的会议论文模板，适合按 IEEE 风格撰写和演练投稿稿件。",
    category: "conference",
    categoryLabel: "官方论文模板",
    sourceType: "official",
    sourceLabel: "官方类包镜像",
    trustLabel: "官方类包",
    providerName: "IEEEtran",
    featured: true,
    updatedAt: "2026-03-08T00:00:00.000Z",
    compileEngine: "pdflatex",
    rootFile: "main.tex",
    tags: ["IEEE", "IEEEtran", "conference", "official"],
    recommendedFor: ["IEEE 会议论文", "工程类论文投稿演练"],
    highlights: ["直接基于 IEEEtran.cls", "双栏会议风格", "可直接开始写摘要、方法和实验"],
    files: [
      {
        path: "main.tex",
        content: [
          "\\documentclass[conference]{IEEEtran}",
          "\\usepackage{cite}",
          "\\usepackage{graphicx}",
          "\\usepackage{amsmath,amssymb}",
          "\\usepackage{booktabs}",
          "",
          "\\title{IEEE Conference Paper Title}",
          "\\author{\\IEEEauthorblockN{First Author \\and Second Author}\\\\",
          "\\IEEEauthorblockA{Institution Name\\\\",
          "email@example.com}}",
          "",
          "\\begin{document}",
          "\\maketitle",
          "",
          "\\begin{abstract}",
          "Write a concise abstract describing the problem, method, and main result.",
          "\\end{abstract}",
          "",
          "\\section{Introduction}",
          "Introduce the research problem, motivation, and contributions here.",
          "",
          "\\section{Method}",
          "Describe the method, assumptions, and system design here.",
          "",
          "\\section{Experiments}",
          "Report datasets, baselines, metrics, and results here.",
          "",
          "\\section{Conclusion}",
          "Summarize the paper and future work here.",
          "",
          "\\bibliographystyle{IEEEtran}",
          "\\bibliography{refs}",
          "\\end{document}",
          "",
        ].join("\n"),
      },
      {
        path: "refs.bib",
        content: [
          "@inproceedings{ieee_sample_2026,",
          "  title={An IEEE Style Sample Reference},",
          "  author={Author, Alice and Author, Bob},",
          "  booktitle={Proceedings of the Example IEEE Conference},",
          "  year={2026}",
          "}",
          "",
        ].join("\n"),
      },
    ],
  },
  {
    id: "acmart-sigconf-template",
    title: "ACM sigconf 论文模板",
    description: "基于官方 acmart 类包的 ACM `sigconf` 模板，适合计算机领域会议论文草稿。",
    category: "conference",
    categoryLabel: "官方论文模板",
    sourceType: "official",
    sourceLabel: "官方类包镜像",
    trustLabel: "官方类包",
    providerName: "acmart",
    featured: true,
    updatedAt: "2026-03-08T00:00:00.000Z",
    compileEngine: "pdflatex",
    rootFile: "main.tex",
    tags: ["ACM", "acmart", "sigconf", "official"],
    recommendedFor: ["ACM 会议论文", "计算机领域投稿草稿"],
    highlights: ["直接基于 acmart.cls", "SIGCONF 会议版式", "预置版权与会议元数据字段"],
    files: [
      {
        path: "main.tex",
        content: [
          "\\documentclass[sigconf]{acmart}",
          "\\setcopyright{none}",
          "\\copyrightyear{2026}",
          "\\acmYear{2026}",
          "\\acmDOI{0000000.0000000}",
          "\\acmConference[ExampleConf '26]{Example Conference}{July 2026}{Shanghai, China}",
          "\\acmISBN{978-1-4503-XXXX-X/26/07}",
          "",
          "\\title{ACM Conference Paper Title}",
          "\\author{First Author}",
          "\\affiliation{\\institution{Example University}\\country{China}}",
          "\\email{author@example.com}",
          "",
          "\\begin{document}",
          "\\begin{abstract}",
          "Write the abstract for your ACM conference paper here.",
          "\\end{abstract}",
          "\\maketitle",
          "",
          "\\section{Introduction}",
          "Introduce the problem, context, and contributions here.",
          "",
          "\\section{Approach}",
          "Describe the approach, system, or method here.",
          "",
          "\\section{Evaluation}",
          "Summarize experimental settings and quantitative results here.",
          "",
          "\\section{Conclusion}",
          "Close the paper with a brief conclusion and future directions.",
          "",
          "\\bibliographystyle{ACM-Reference-Format}",
          "\\bibliography{refs}",
          "\\end{document}",
          "",
        ].join("\n"),
      },
      {
        path: "refs.bib",
        content: [
          "@inproceedings{acm_sample_2026,",
          "  title={An ACM Style Sample Reference},",
          "  author={Writer, Wendy and Builder, Ben},",
          "  booktitle={Proceedings of ExampleConf},",
          "  year={2026}",
          "}",
          "",
        ].join("\n"),
      },
    ],
  },
  {
    id: "elsarticle-journal-template",
    title: "Elsevier Journal 模板",
    description: "基于官方 elsarticle 类包的 Elsevier 期刊模板，适合期刊论文结构化写作。",
    category: "article",
    categoryLabel: "官方论文模板",
    sourceType: "official",
    sourceLabel: "官方类包镜像",
    trustLabel: "官方类包",
    providerName: "elsarticle",
    featured: true,
    updatedAt: "2026-03-08T00:00:00.000Z",
    compileEngine: "pdflatex",
    rootFile: "main.tex",
    tags: ["Elsevier", "elsarticle", "journal", "official"],
    recommendedFor: ["Elsevier 期刊论文", "结构化期刊稿件"],
    highlights: ["直接基于 elsarticle.cls", "摘要、关键词和 frontmatter 完整", "接近期刊写作结构"],
    files: [
      {
        path: "main.tex",
        content: [
          "\\documentclass[preprint,12pt]{elsarticle}",
          "\\usepackage{amssymb}",
          "\\usepackage{amsmath}",
          "\\usepackage{graphicx}",
          "",
          "\\journal{Journal Name}",
          "",
          "\\begin{document}",
          "\\begin{frontmatter}",
          "\\title{Elsevier Journal Paper Title}",
          "\\author{First Author}",
          "\\address{Example Institute}",
          "\\begin{abstract}",
          "Write the abstract for your journal paper here.",
          "\\end{abstract}",
          "\\begin{keyword}",
          "keyword1 \\sep keyword2 \\sep keyword3",
          "\\end{keyword}",
          "\\end{frontmatter}",
          "",
          "\\section{Introduction}",
          "Present the motivation, background, and paper outline here.",
          "",
          "\\section{Method}",
          "Describe the method and theoretical analysis here.",
          "",
          "\\section{Results}",
          "Summarize experiments, tables, and discussion here.",
          "",
          "\\section{Conclusion}",
          "Summarize the conclusions and broader impacts here.",
          "",
          "\\bibliographystyle{elsarticle-num}",
          "\\bibliography{refs}",
          "\\end{document}",
          "",
        ].join("\n"),
      },
      {
        path: "refs.bib",
        content: [
          "@article{elsevier_sample_2026,",
          "  title={An Elsevier Style Sample Reference},",
          "  author={Doe, Jane and Smith, John},",
          "  journal={Journal Name},",
          "  year={2026},",
          "  volume={1},",
          "  pages={1--10}",
          "}",
          "",
        ].join("\n"),
      },
    ],
  },
  {
    id: "llncs-springer-template",
    title: "Springer LNCS 模板",
    description: "基于官方 llncs 类包的 Springer Lecture Notes in Computer Science 模板。",
    category: "conference",
    categoryLabel: "官方论文模板",
    sourceType: "official",
    sourceLabel: "官方类包镜像",
    trustLabel: "官方类包",
    providerName: "llncs",
    featured: true,
    updatedAt: "2026-03-08T00:00:00.000Z",
    compileEngine: "pdflatex",
    rootFile: "main.tex",
    tags: ["Springer", "LNCS", "llncs", "official"],
    recommendedFor: ["Springer LNCS 会议论文", "计算机科学会议投稿"],
    highlights: ["直接基于 llncs.cls", "接近 Springer LNCS 会议结构", "适合算法与系统论文"],
    files: [
      {
        path: "main.tex",
        content: [
          "\\documentclass[runningheads]{llncs}",
          "\\usepackage{graphicx}",
          "",
          "\\begin{document}",
          "\\title{Springer LNCS Paper Title}",
          "\\author{First Author \\and Second Author}",
          "\\institute{Example University\\\\ \\email{author@example.com}}",
          "\\maketitle",
          "",
          "\\begin{abstract}",
          "Write the abstract for your LNCS paper here.",
          "\\keywords{keyword1 \\and keyword2 \\and keyword3}",
          "\\end{abstract}",
          "",
          "\\section{Introduction}",
          "Describe the research problem and the paper contributions here.",
          "",
          "\\section{Method}",
          "Explain the method, algorithm, or framework here.",
          "",
          "\\section{Evaluation}",
          "Report the experiment setup and key results here.",
          "",
          "\\section{Conclusion}",
          "Summarize the paper here.",
          "",
          "\\bibliographystyle{splncs04}",
          "\\bibliography{refs}",
          "\\end{document}",
          "",
        ].join("\n"),
      },
      {
        path: "refs.bib",
        content: [
          "@inproceedings{lncs_sample_2026,",
          "  title={A Springer LNCS Style Sample Reference},",
          "  author={Researcher, Riley and Author, Alex},",
          "  booktitle={Lecture Notes in Computer Science},",
          "  year={2026}",
          "}",
          "",
        ].join("\n"),
      },
    ],
  },
  {
    id: "ieeetran-journal-template",
    title: "IEEEtran 期刊论文模板",
    description: "基于官方 IEEEtran 类包的期刊论文模板，适合更正式的 journal 排版结构。",
    category: "article",
    categoryLabel: "官方论文模板",
    sourceType: "official",
    sourceLabel: "官方类包镜像",
    trustLabel: "官方类包",
    providerName: "IEEEtran",
    featured: true,
    updatedAt: "2026-03-08T00:00:00.000Z",
    compileEngine: "pdflatex",
    rootFile: "main.tex",
    tags: ["IEEE", "IEEEtran", "journal", "official"],
    recommendedFor: ["IEEE 期刊论文", "更长篇幅的工程类论文"],
    highlights: ["直接基于 IEEEtran.cls journal 模式", "适合期刊结构和长篇稿件"],
    files: [
      {
        path: "main.tex",
        content: [
          "\\documentclass[journal]{IEEEtran}",
          "\\usepackage{cite}",
          "\\usepackage{graphicx}",
          "\\usepackage{amsmath,amssymb}",
          "\\title{IEEE Journal Paper Title}",
          "\\author{First~Author,~\\IEEEmembership{Member,~IEEE}}",
          "\\begin{document}",
          "\\maketitle",
          "\\begin{abstract}",
          "Write the journal abstract here.",
          "\\end{abstract}",
          "\\section{Introduction}",
          "Present the background, prior work, and contributions here.",
          "\\section{Method}",
          "Describe the method and theoretical analysis here.",
          "\\section{Discussion}",
          "Discuss results, limitations, and implications here.",
          "\\section{Conclusion}",
          "Summarize the paper and future work here.",
          "\\bibliographystyle{IEEEtran}",
          "\\bibliography{refs}",
          "\\end{document}",
          "",
        ].join("\n"),
      },
      {
        path: "refs.bib",
        content: [
          "@article{ieee_journal_sample_2026,",
          "  title={An IEEE Journal Sample Reference},",
          "  author={Author, Ada},",
          "  journal={IEEE Transactions on Example Systems},",
          "  year={2026},",
          "  volume={1},",
          "  number={1},",
          "  pages={1--12}",
          "}",
          "",
        ].join("\n"),
      },
    ],
  },
  {
    id: "acmart-journal-template",
    title: "ACM journal 论文模板",
    description: "基于官方 acmart 类包的期刊模板，适合 ACM journal/manuscript 类稿件。",
    category: "article",
    categoryLabel: "官方论文模板",
    sourceType: "official",
    sourceLabel: "官方类包镜像",
    trustLabel: "官方类包",
    providerName: "acmart",
    featured: true,
    updatedAt: "2026-03-08T00:00:00.000Z",
    compileEngine: "pdflatex",
    rootFile: "main.tex",
    tags: ["ACM", "acmart", "journal", "official"],
    recommendedFor: ["ACM 期刊论文", "manuscript 长文稿件"],
    highlights: ["直接基于 acmart.cls manuscript 模式", "适合 ACM 长文写作"],
    files: [
      {
        path: "main.tex",
        content: [
          "\\documentclass[manuscript,screen]{acmart}",
          "\\setcopyright{none}",
          "\\title{ACM Journal Paper Title}",
          "\\author{First Author}",
          "\\affiliation{\\institution{Example University}\\country{China}}",
          "\\email{author@example.com}",
          "\\begin{document}",
          "\\begin{abstract}",
          "Write the abstract for your ACM journal paper here.",
          "\\end{abstract}",
          "\\maketitle",
          "\\section{Introduction}",
          "Describe the research problem and contributions here.",
          "\\section{Background}",
          "Summarize prior work and technical background here.",
          "\\section{Approach}",
          "Explain the approach, system, or framework here.",
          "\\section{Conclusion}",
          "Conclude the paper here.",
          "\\bibliographystyle{ACM-Reference-Format}",
          "\\bibliography{refs}",
          "\\end{document}",
          "",
        ].join("\n"),
      },
      {
        path: "refs.bib",
        content: [
          "@article{acm_journal_sample_2026,",
          "  title={An ACM Journal Sample Reference},",
          "  author={Writer, Wendy},",
          "  journal={ACM Transactions on Example Systems},",
          "  year={2026},",
          "  volume={1},",
          "  number={1},",
          "  pages={1--18}",
          "}",
          "",
        ].join("\n"),
      },
    ],
  },
  {
    id: "elsevier-cas-template",
    title: "Elsevier CAS 单栏模板",
    description: "基于官方 cas-sc 类包的 Elsevier Contemporary Article System 模板。",
    category: "article",
    categoryLabel: "官方论文模板",
    sourceType: "official",
    sourceLabel: "官方类包镜像",
    trustLabel: "官方类包",
    providerName: "cas-sc",
    featured: false,
    updatedAt: "2026-03-08T00:00:00.000Z",
    compileEngine: "pdflatex",
    rootFile: "main.tex",
    tags: ["Elsevier", "CAS", "cas-sc", "official"],
    recommendedFor: ["Elsevier CAS 单栏稿件", "期刊单栏结构化写作"],
    highlights: ["直接基于 cas-sc.cls", "适合单栏期刊风格"],
    files: [
      {
        path: "main.tex",
        content: [
          "\\documentclass[a4paper,fleqn]{cas-sc}",
          "\\usepackage[numbers]{natbib}",
          "\\begin{document}",
          "\\shorttitle{CAS Template}",
          "\\title [mode = title]{Elsevier CAS Paper Title}",
          "\\author[1]{First Author}",
          "\\address[1]{Example Institute}",
          "\\begin{abstract}",
          "Write the abstract for the Elsevier CAS manuscript here.",
          "\\end{abstract}",
          "\\begin{keywords}",
          "keyword1 \\sep keyword2 \\sep keyword3",
          "\\end{keywords}",
          "\\maketitle",
          "\\section{Introduction}",
          "Introduce the problem and scope here.",
          "\\section{Method}",
          "Describe the method and analysis here.",
          "\\section{Conclusion}",
          "Summarize the conclusions here.",
          "\\bibliographystyle{cas-model2-names}",
          "\\bibliography{refs}",
          "\\end{document}",
          "",
        ].join("\n"),
      },
      {
        path: "refs.bib",
        content: [
          "@article{cas_sample_2026,",
          "  title={An Elsevier CAS Sample Reference},",
          "  author={Sample, Sarah},",
          "  journal={Example CAS Journal},",
          "  year={2026}",
          "}",
          "",
        ].join("\n"),
      },
    ],
  },
  {
    id: "revtex-aps-template",
    title: "REVTeX 4.2 论文模板",
    description: "基于官方 revtex4-2 类包的 APS/AIP 风格论文模板，适合物理学方向稿件。",
    category: "article",
    categoryLabel: "官方论文模板",
    sourceType: "official",
    sourceLabel: "官方类包镜像",
    trustLabel: "官方类包",
    providerName: "revtex4-2",
    featured: false,
    updatedAt: "2026-03-08T00:00:00.000Z",
    compileEngine: "pdflatex",
    rootFile: "main.tex",
    tags: ["APS", "AIP", "REVTeX", "physics", "official"],
    recommendedFor: ["物理学论文", "APS/AIP 风格草稿"],
    highlights: ["直接基于 revtex4-2.cls", "适合理工科公式密集稿件"],
    files: [
      {
        path: "main.tex",
        content: [
          "\\documentclass[aps,prl,twocolumn]{revtex4-2}",
          "\\usepackage{graphicx}",
          "\\usepackage{amsmath,amssymb}",
          "\\begin{document}",
          "\\title{REVTeX Paper Title}",
          "\\author{First Author}",
          "\\affiliation{Example Institute}",
          "\\begin{abstract}",
          "Write the abstract for your APS-style paper here.",
          "\\end{abstract}",
          "\\maketitle",
          "\\section{Introduction}",
          "Describe the physical problem and context here.",
          "\\section{Theory}",
          "Present derivations, equations, and theoretical setup here.",
          "\\section{Results}",
          "Show the results and analysis here.",
          "\\bibliographystyle{apsrev4-2}",
          "\\bibliography{refs}",
          "\\end{document}",
          "",
        ].join("\n"),
      },
      {
        path: "refs.bib",
        content: [
          "@article{revtex_sample_2026,",
          "  title={A REVTeX Sample Reference},",
          "  author={Physicist, Pat},",
          "  journal={Physical Review Letters},",
          "  year={2026},",
          "  volume={1},",
          "  pages={1--4}",
          "}",
          "",
        ].join("\n"),
      },
    ],
  },
  {
    id: "aastex-astro-template",
    title: "AASTeX 6.31 天文学模板",
    description: "基于官方 aastex631 类包的天文学论文模板，适合天体物理和天文观测论文。",
    category: "article",
    categoryLabel: "官方论文模板",
    sourceType: "official",
    sourceLabel: "官方类包镜像",
    trustLabel: "官方类包",
    providerName: "aastex631",
    featured: false,
    updatedAt: "2026-03-08T00:00:00.000Z",
    compileEngine: "pdflatex",
    rootFile: "main.tex",
    tags: ["AASTeX", "astronomy", "astrophysics", "official"],
    recommendedFor: ["天文学论文", "天体物理观测论文"],
    highlights: ["直接基于 aastex631.cls", "适合天文期刊写作场景"],
    files: [
      {
        path: "main.tex",
        content: [
          "\\documentclass[twocolumn]{aastex631}",
          "\\begin{document}",
          "\\title{AASTeX Paper Title}",
          "\\author{First Author}",
          "\\affiliation{Department of Astronomy, Example University}",
          "\\begin{abstract}",
          "Write the abstract for your astronomy paper here.",
          "\\end{abstract}",
          "\\keywords{astronomy --- methods: data analysis --- techniques: photometric}",
          "\\section{Introduction}",
          "Introduce the astrophysical context and research question here.",
          "\\section{Observations}",
          "Describe the observations and data collection here.",
          "\\section{Results}",
          "Present the key findings and analysis here.",
          "\\bibliographystyle{aasjournal}",
          "\\bibliography{refs}",
          "\\end{document}",
          "",
        ].join("\n"),
      },
      {
        path: "refs.bib",
        content: [
          "@article{aastex_sample_2026,",
          "  title={An AASTeX Sample Reference},",
          "  author={Astronomer, Alex},",
          "  journal={The Astrophysical Journal},",
          "  year={2026},",
          "  volume={1},",
          "  pages={1--9}",
          "}",
          "",
        ].join("\n"),
      },
    ],
  },
  {
    id: "thesis-structure",
    title: "学位论文结构模板",
    description: "面向长文档写作的 report 模板，适合毕业论文、开题报告和长篇技术报告。",
    category: "thesis",
    categoryLabel: "学位论文",
    sourceType: "platform",
    sourceLabel: "平台精选",
    featured: true,
    updatedAt: "2026-03-08T00:00:00.000Z",
    compileEngine: "xelatex",
    rootFile: "thesis.tex",
    tags: ["thesis", "report", "chapters", "xelatex"],
    recommendedFor: ["毕业论文", "开题报告", "长篇技术报告"],
    highlights: ["章节化结构", "封面与摘要分离", "适合后续多人协作拆章节"],
    files: [
      {
        path: "thesis.tex",
        content: [
          "\\documentclass[12pt]{report}",
          "\\usepackage[margin=1in]{geometry}",
          "\\usepackage{fontspec}",
          "\\usepackage{graphicx}",
          "\\usepackage{hyperref}",
          "",
          "\\title{Thesis Title}",
          "\\author{Author Name}",
          "\\date{\\today}",
          "",
          "\\begin{document}",
          "\\maketitle",
          "\\tableofcontents",
          "",
          "\\input{chapters/abstract}",
          "\\input{chapters/introduction}",
          "\\input{chapters/methodology}",
          "\\input{chapters/conclusion}",
          "",
          "\\bibliographystyle{plain}",
          "\\bibliography{refs}",
          "\\end{document}",
          "",
        ].join("\n"),
      },
      {
        path: "chapters/abstract.tex",
        content: [
          "\\chapter*{Abstract}",
          "Write the abstract for your thesis here.",
          "",
        ].join("\n"),
      },
      {
        path: "chapters/introduction.tex",
        content: [
          "\\chapter{Introduction}",
          "Introduce the research background and thesis objectives here.",
          "",
        ].join("\n"),
      },
      {
        path: "chapters/methodology.tex",
        content: [
          "\\chapter{Methodology}",
          "Explain the methods, datasets, and experiment protocols here.",
          "",
        ].join("\n"),
      },
      {
        path: "chapters/conclusion.tex",
        content: [
          "\\chapter{Conclusion}",
          "Summarize the thesis and future work here.",
          "",
        ].join("\n"),
      },
      {
        path: "refs.bib",
        content: [
          "@book{example2026thesis,",
          "  title={The Example Thesis Book},",
          "  author={Writer, Terry},",
          "  publisher={Example Press},",
          "  year={2026}",
          "}",
          "",
        ].join("\n"),
      },
    ],
  },
  {
    id: "beamer-research-talk",
    title: "研究汇报幻灯模板",
    description: "适合论文组会、答辩预演和项目汇报的 Beamer 起步模板。",
    category: "slides",
    categoryLabel: "演示文稿",
    sourceType: "platform",
    sourceLabel: "平台精选",
    featured: false,
    updatedAt: "2026-03-08T00:00:00.000Z",
    compileEngine: "pdflatex",
    rootFile: "slides.tex",
    tags: ["beamer", "presentation", "talk"],
    recommendedFor: ["论文组会", "答辩预演", "项目汇报"],
    highlights: ["问题-方法-结果结构", "可直接加入图表截图", "适合作为论文配套汇报稿"],
    files: [
      {
        path: "slides.tex",
        content: [
          "\\documentclass{beamer}",
          "\\usetheme{Madrid}",
          "\\title{Research Talk}",
          "\\author{Author Name}",
          "\\date{\\today}",
          "",
          "\\begin{document}",
          "\\frame{\\titlepage}",
          "",
          "\\begin{frame}{Problem}",
          "State the problem and motivation here.",
          "\\end{frame}",
          "",
          "\\begin{frame}{Method}",
          "Describe the core idea in a few bullet points.",
          "\\end{frame}",
          "",
          "\\begin{frame}{Results}",
          "Add result figures or summary tables here.",
          "\\end{frame}",
          "",
          "\\end{document}",
          "",
        ].join("\n"),
      },
    ],
  },
  {
    id: "related-work-example",
    title: "相关工作写作示例",
    description: "围绕对比、归类和引用组织的相关工作章节示例，适合作为学习工程而不是投稿模板。",
    category: "example",
    categoryLabel: "功能示例",
    sourceType: "example",
    sourceLabel: "功能示例",
    featured: false,
    updatedAt: "2026-03-08T00:00:00.000Z",
    compileEngine: "pdflatex",
    rootFile: "main.tex",
    tags: ["related work", "example", "citations"],
    recommendedFor: ["学习相关工作写法", "熟悉引用与段落组织"],
    highlights: ["按主题而非年份组织", "示例化引用写法", "适合配合论文检索模块一起使用"],
    files: [
      {
        path: "main.tex",
        content: [
          "\\documentclass{article}",
          "\\usepackage[margin=1in]{geometry}",
          "\\begin{document}",
          "\\input{sections/related_work}",
          "\\bibliographystyle{plain}",
          "\\bibliography{refs}",
          "\\end{document}",
          "",
        ].join("\n"),
      },
      {
        path: "sections/related_work.tex",
        content: [
          "\\section{Related Work}",
          "Recent work can be grouped into retrieval-based pipelines \\cite{example2026retrieval} and agentic systems \\cite{example2026agent}.",
          "Compared with prior retrieval-heavy systems, our design places more emphasis on project-grounded editing loops.",
          "",
        ].join("\n"),
      },
      {
        path: "refs.bib",
        content: [
          "@article{example2026retrieval,",
          "  title={Retrieval Heavy Pipelines for Example Systems},",
          "  author={Researcher, Rita},",
          "  journal={Transactions on Example Systems},",
          "  year={2026}",
          "}",
          "",
          "@article{example2026agent,",
          "  title={Agentic Systems for Example Writing},",
          "  author={Scientist, Sam},",
          "  journal={Example Review Letters},",
          "  year={2026}",
          "}",
          "",
        ].join("\n"),
      },
    ],
  },
  {
    id: "bibtex-playground",
    title: "引用与 BibTeX 示例工程",
    description: "用于熟悉 BibTeX、引用插入和参考文献编译链路的最小示例。",
    category: "example",
    categoryLabel: "功能示例",
    sourceType: "example",
    sourceLabel: "功能示例",
    featured: false,
    updatedAt: "2026-03-08T00:00:00.000Z",
    compileEngine: "pdflatex",
    rootFile: "main.tex",
    tags: ["bibtex", "citation", "example"],
    recommendedFor: ["熟悉 refs.bib", "验证引用编译链路"],
    highlights: ["最小化文献引用示例", "适合测试论文导入模块", "便于演示 \\cite 插入"],
    files: [
      {
        path: "main.tex",
        content: [
          "\\documentclass{article}",
          "\\begin{document}",
          "A citation example appears here: \\cite{example2026citation}.",
          "",
          "\\bibliographystyle{plain}",
          "\\bibliography{refs}",
          "\\end{document}",
          "",
        ].join("\n"),
      },
      {
        path: "refs.bib",
        content: [
          "@article{example2026citation,",
          "  title={A Citation Playground Example},",
          "  author={Reference, Robin},",
          "  journal={Journal of Citation Demos},",
          "  year={2026}",
          "}",
          "",
        ].join("\n"),
      },
    ],
  },
  {
    id: "technical-report-structure",
    title: "技术报告模板",
    description: "适合实验总结、项目报告和内部技术文档，强调摘要、目录和附录结构。",
    category: "report",
    categoryLabel: "技术报告",
    sourceType: "platform",
    sourceLabel: "平台精选",
    featured: false,
    updatedAt: "2026-03-08T00:00:00.000Z",
    compileEngine: "pdflatex",
    rootFile: "report.tex",
    tags: ["report", "appendix", "internal"],
    recommendedFor: ["技术报告", "项目复盘", "内部评审材料"],
    highlights: ["摘要与目录完整", "章节和附录分离", "适合长文档组织"],
    files: [
      {
        path: "report.tex",
        content: [
          "\\documentclass[12pt]{report}",
          "\\usepackage[margin=1in]{geometry}",
          "\\usepackage{graphicx}",
          "\\usepackage{booktabs}",
          "\\usepackage{hyperref}",
          "",
          "\\title{Technical Report Title}",
          "\\author{Team Name}",
          "\\date{\\today}",
          "",
          "\\begin{document}",
          "\\maketitle",
          "\\tableofcontents",
          "",
          "\\chapter*{Executive Summary}",
          "Summarize the context, key result, and recommendation here.",
          "",
          "\\input{chapters/background}",
          "\\input{chapters/implementation}",
          "\\appendix",
          "\\input{chapters/appendix}",
          "",
          "\\end{document}",
          "",
        ].join("\n"),
      },
      { path: "chapters/background.tex", content: "\\chapter{Background}\nExplain the project context and constraints here.\n" },
      { path: "chapters/implementation.tex", content: "\\chapter{Implementation}\nDescribe architecture, experiments, and outcomes here.\n" },
      { path: "chapters/appendix.tex", content: "\\chapter{Appendix}\nAdd supplementary tables, logs, or notes here.\n" },
    ],
  },
  {
    id: "research-proposal-template",
    title: "研究计划书模板",
    description: "适合开题申请、课题申请和项目立项，强调问题、方法、里程碑和风险。",
    category: "report",
    categoryLabel: "研究提案",
    sourceType: "platform",
    sourceLabel: "平台精选",
    featured: false,
    updatedAt: "2026-03-08T00:00:00.000Z",
    compileEngine: "pdflatex",
    rootFile: "proposal.tex",
    tags: ["proposal", "research plan", "milestone"],
    recommendedFor: ["开题报告", "基金申请草稿", "课题计划书"],
    highlights: ["问题-方法-计划结构", "里程碑与风险单独成节", "适合导师评审前快速成稿"],
    files: [
      {
        path: "proposal.tex",
        content: [
          "\\documentclass[11pt]{article}",
          "\\usepackage[margin=1in]{geometry}",
          "\\usepackage{enumitem}",
          "\\usepackage{hyperref}",
          "",
          "\\title{Research Proposal Title}",
          "\\author{Applicant Name}",
          "\\date{\\today}",
          "",
          "\\begin{document}",
          "\\maketitle",
          "\\input{sections/problem}",
          "\\input{sections/method}",
          "\\input{sections/plan}",
          "\\input{sections/risk}",
          "\\end{document}",
          "",
        ].join("\n"),
      },
      { path: "sections/problem.tex", content: "\\section{Problem Statement}\nDefine the core problem and why it matters.\n" },
      { path: "sections/method.tex", content: "\\section{Methodology}\nDescribe the proposed method and expected innovation.\n" },
      { path: "sections/plan.tex", content: "\\section{Milestones}\n\\begin{itemize}\n  \\item Month 1--2: literature review\n  \\item Month 3--4: prototype and experiments\n\\end{itemize}\n" },
      { path: "sections/risk.tex", content: "\\section{Risks and Mitigation}\nList the main risks and backup plans.\n" },
    ],
  },
  {
    id: "book-manuscript-template",
    title: "书稿章节模板",
    description: "适合教材、长篇书稿和系统化技术文档，强调章节化和前言结构。",
    category: "book",
    categoryLabel: "书稿",
    sourceType: "platform",
    sourceLabel: "平台精选",
    featured: false,
    updatedAt: "2026-03-08T00:00:00.000Z",
    compileEngine: "pdflatex",
    rootFile: "book.tex",
    tags: ["book", "manuscript", "chapters"],
    recommendedFor: ["书稿起稿", "教材草稿", "体系化技术文档"],
    highlights: ["前言与章节分离", "适合长篇写作", "便于多人拆章协作"],
    files: [
      {
        path: "book.tex",
        content: [
          "\\documentclass[11pt]{book}",
          "\\usepackage[margin=1in]{geometry}",
          "\\usepackage{hyperref}",
          "",
          "\\title{Book Title}",
          "\\author{Author Name}",
          "\\date{\\today}",
          "",
          "\\begin{document}",
          "\\frontmatter",
          "\\maketitle",
          "\\tableofcontents",
          "\\mainmatter",
          "\\input{chapters/preface}",
          "\\input{chapters/chapter1}",
          "\\input{chapters/chapter2}",
          "\\backmatter",
          "\\end{document}",
          "",
        ].join("\n"),
      },
      { path: "chapters/preface.tex", content: "\\chapter{Preface}\nExplain the scope of this book and intended readers.\n" },
      { path: "chapters/chapter1.tex", content: "\\chapter{Foundations}\nIntroduce the key ideas here.\n" },
      { path: "chapters/chapter2.tex", content: "\\chapter{Applications}\nDiscuss practical applications and examples here.\n" },
    ],
  },
  {
    id: "moderncv-resume-template",
    title: "学术简历模板",
    description: "不依赖额外图标包的简历模板，适合学术申请、求职简历和个人履历 PDF。",
    category: "cv",
    categoryLabel: "简历",
    sourceType: "platform",
    sourceLabel: "平台精选",
    featured: true,
    updatedAt: "2026-03-08T00:00:00.000Z",
    compileEngine: "pdflatex",
    rootFile: "cv.tex",
    tags: ["cv", "resume", "academic"],
    recommendedFor: ["学术申请", "求职简历", "个人履历 PDF"],
    highlights: ["不依赖额外类库图标包", "联系信息与经历结构清晰", "适合后续中英文双语改写"],
    files: [
      {
        path: "cv.tex",
        content: [
          "\\documentclass[11pt]{article}",
          "\\usepackage[margin=0.8in]{geometry}",
          "\\usepackage{enumitem}",
          "\\pagestyle{empty}",
          "",
          "\\begin{document}",
          "{\\LARGE \\textbf{First Last}}\\\\",
          "Email: you@example.com \\hfill GitHub: your-handle\\\\",
          "Website: https://example.com",
          "",
          "\\vspace{1em}",
          "\\section*{Education}",
          "\\textbf{Example University} \\hfill 2022--2026\\\\",
          "Ph.D. in Something",
          "",
          "\\section*{Experience}",
          "\\textbf{Example Lab} \\hfill 2024--Now\\\\",
          "Research Intern\\\\",
          "\\begin{itemize}[leftmargin=1.2em]",
          "  \\item Worked on collaborative writing systems and experiment tooling.",
          "  \\item Built evaluation pipelines and documentation assets.",
          "\\end{itemize}",
          "",
          "\\section*{Selected Projects}",
          "\\begin{itemize}[leftmargin=1.2em]",
          "  \\item Overleaf-like collaborative LaTeX platform",
          "  \\item Research assistant for paper search and reading workflows",
          "\\end{itemize}",
          "",
          "\\section*{Skills}",
          "Python, TypeScript, C++, LaTeX, React",
          "\\end{document}",
          "",
        ].join("\n"),
      },
    ],
  },
  {
    id: "cover-letter-template",
    title: "正式信件模板",
    description: "适合投稿附信、求职附信、导师联系邮件的正式信件排版模板。",
    category: "letter",
    categoryLabel: "信件",
    sourceType: "platform",
    sourceLabel: "平台精选",
    featured: false,
    updatedAt: "2026-03-08T00:00:00.000Z",
    compileEngine: "pdflatex",
    rootFile: "letter.tex",
    tags: ["letter", "cover letter", "submission"],
    recommendedFor: ["投稿附信", "求职附信", "正式联系信"],
    highlights: ["格式简单稳定", "适合快速改写成正式信件"],
    files: [
      {
        path: "letter.tex",
        content: [
          "\\documentclass{letter}",
          "\\signature{Your Name}",
          "\\address{Your Address\\\\City, Country}",
          "",
          "\\begin{document}",
          "\\begin{letter}{Recipient Name\\\\Recipient Organization}",
          "\\opening{Dear Recipient,}",
          "I am writing to submit our manuscript and briefly explain its contributions.",
          "",
          "\\closing{Sincerely,}",
          "\\end{letter}",
          "\\end{document}",
          "",
        ].join("\n"),
      },
    ],
  },
  {
    id: "poster-template",
    title: "学术海报模板",
    description: "基于 tikzposter 的单页海报模板，适合海报展示、项目路演和答辩展板。",
    category: "poster",
    categoryLabel: "海报",
    sourceType: "platform",
    sourceLabel: "平台精选",
    featured: false,
    updatedAt: "2026-03-08T00:00:00.000Z",
    compileEngine: "pdflatex",
    rootFile: "poster.tex",
    tags: ["poster", "tikzposter", "presentation"],
    recommendedFor: ["学术海报", "项目路演", "成果展示"],
    highlights: ["单页海报布局", "块级结构适合图文混排", "适合做答辩墙报"],
    files: [
      {
        path: "poster.tex",
        content: [
          "\\documentclass[25pt,a0paper,portrait]{tikzposter}",
          "\\title{Poster Title}",
          "\\author{Author Name}",
          "\\institute{Organization Name}",
          "",
          "\\begin{document}",
          "\\maketitle",
          "\\block{Motivation}{Explain the background and motivation here.}",
          "\\block{Method}{Describe the method or system design here.}",
          "\\block{Results}{Summarize the key findings and figures here.}",
          "\\end{document}",
          "",
        ].join("\n"),
      },
    ],
  },
  {
    id: "assignment-handout-template",
    title: "作业讲义模板",
    description: "适合课程作业、实验讲义和练习题文档，强调题目结构和解答区。",
    category: "report",
    categoryLabel: "讲义作业",
    sourceType: "platform",
    sourceLabel: "平台精选",
    featured: false,
    updatedAt: "2026-03-08T00:00:00.000Z",
    compileEngine: "pdflatex",
    rootFile: "assignment.tex",
    tags: ["assignment", "handout", "course"],
    recommendedFor: ["课程作业", "实验讲义", "课堂练习文档"],
    highlights: ["题目与解答结构清晰", "适合教学场景快速复用"],
    files: [
      {
        path: "assignment.tex",
        content: [
          "\\documentclass[11pt]{article}",
          "\\usepackage[margin=1in]{geometry}",
          "\\usepackage{enumitem}",
          "",
          "\\title{Assignment Title}",
          "\\author{Course Name}",
          "\\date{\\today}",
          "",
          "\\begin{document}",
          "\\maketitle",
          "\\section*{Instructions}",
          "List the assignment rules and deadlines here.",
          "",
          "\\section*{Problems}",
          "\\begin{enumerate}[label=Problem \\arabic*:]",
          "  \\item State the first problem here.",
          "  \\item State the second problem here.",
          "\\end{enumerate}",
          "\\end{document}",
          "",
        ].join("\n"),
      },
    ],
  },
  {
    id: "meeting-notes-template",
    title: "会议纪要模板",
    description: "适合组会纪要、项目同步记录和读书会总结，强调日期、议题和行动项。",
    category: "report",
    categoryLabel: "会议纪要",
    sourceType: "platform",
    sourceLabel: "平台精选",
    featured: false,
    updatedAt: "2026-03-08T00:00:00.000Z",
    compileEngine: "pdflatex",
    rootFile: "notes.tex",
    tags: ["meeting", "notes", "action items"],
    recommendedFor: ["组会纪要", "项目同步", "读书会记录"],
    highlights: ["议题、决议与行动项分离", "适合团队共享与追踪"],
    files: [
      {
        path: "notes.tex",
        content: [
          "\\documentclass[11pt]{article}",
          "\\usepackage[margin=1in]{geometry}",
          "\\begin{document}",
          "\\section*{Meeting Information}",
          "Date: \\\\ Participants: \\\\ Topic:",
          "",
          "\\section*{Discussion}",
          "\\begin{itemize}",
          "  \\item Key discussion point 1.",
          "  \\item Key discussion point 2.",
          "\\end{itemize}",
          "",
          "\\section*{Action Items}",
          "\\begin{enumerate}",
          "  \\item Owner A -- next step.",
          "  \\item Owner B -- next step.",
          "\\end{enumerate}",
          "\\end{document}",
          "",
        ].join("\n"),
      },
    ],
  },
];

const remoteOfficialTemplates = [
  createCvprFamilyTemplate({
    id: "cvpr-author-kit-template",
    title: "CVPR 官方 Author Kit",
    description: "基于 CVPR 官方 GitHub author kit 镜像，保留 review / final 开关、补充材料文件与官方双栏结构。",
    conferenceName: "CVPR",
    conferenceYear: "2026",
  }),
  createCvprFamilyTemplate({
    id: "iccv-author-kit-template",
    title: "ICCV 官方 Author Kit",
    description: "复用 CVPR / ICCV / 3DV 官方统一 author kit，默认保留 ICCV 投稿骨架，年份需按当届要求调整。",
    conferenceName: "ICCV",
    conferenceYear: "20XX",
  }),
  createCvprFamilyTemplate({
    id: "3dv-author-kit-template",
    title: "3DV 官方 Author Kit",
    description: "复用 CVPR / ICCV / 3DV 官方统一 author kit，适合作为 3DV 投稿起步模板和格式预演。",
    conferenceName: "3DV",
    conferenceYear: "20XX",
  }),
  createArchiveTemplate({
    id: "neurips-2025-template",
    title: "NeurIPS 2025 官方模板",
    description: "基于 NeurIPS 2025 官网 Styles.zip 镜像，保留官方匿名投稿示例与样式文件。",
    providerName: "NeurIPS 2025 官方站点",
    sourceUrl: "https://neurips.cc/Conferences/2025/CallForPapers",
    archiveUrl: "https://media.neurips.cc/Conferences/NeurIPS2025/Styles.zip",
    archiveType: "zip",
    rootFile: "neurips_2025.tex",
    entries: [
      { sourcePath: "Styles/neurips_2025.sty", path: "neurips_2025.sty" },
      { sourcePath: "Styles/neurips_2025.tex", path: "neurips_2025.tex" },
    ],
    cacheKey: "neurips-2025-styles",
    tags: ["official", "neurips", "submission", "anonymous"],
    recommendedFor: ["NeurIPS 投稿草稿", "NeurIPS 官方格式预演", "机器学习会议论文"],
    highlights: ["直接镜像自 NeurIPS 官网 Styles.zip", "仅保留可直接编辑的文本文件", "无需外链跳转即可创建项目"],
  }),
  createArchiveTemplate({
    id: "icml-2025-template",
    title: "ICML 2025 官方模板",
    description: "基于 ICML 2025 官方样式 zip 镜像，保留官方 example paper、样式与参考文献骨架。",
    providerName: "ICML 2025 官方站点",
    sourceUrl: "https://icml.cc/Conferences/2025/author-information",
    archiveUrl: "https://media.icml.cc/Conferences/ICML2025/Styles/icml2025.zip",
    archiveType: "zip",
    rootFile: "example_paper.tex",
    entries: [
      { sourcePath: "icml2025/example_paper.bib", path: "example_paper.bib" },
      { sourcePath: "icml2025/fancyhdr.sty", path: "fancyhdr.sty" },
      { sourcePath: "icml2025/algorithmic.sty", path: "algorithmic.sty" },
      { sourcePath: "icml2025/icml2025.sty", path: "icml2025.sty" },
      { sourcePath: "icml2025/example_paper.tex", path: "example_paper.tex" },
      { sourcePath: "icml2025/icml2025.bst", path: "icml2025.bst" },
      { sourcePath: "icml2025/algorithm.sty", path: "algorithm.sty" },
    ],
    cacheKey: "icml-2025-author-kit",
    tags: ["official", "icml", "submission", "ml"],
    recommendedFor: ["ICML 投稿草稿", "ICML 官方格式预演", "机器学习论文"],
    highlights: ["直接镜像自 ICML 官方作者说明", "移除二进制示例图依赖后仍保持可编译", "保留官方样式、BST 与示例正文"],
    patch: {
      kind: "icml-example-paper",
    },
  }),
  createArchiveTemplate({
    id: "iclr-2026-template",
    title: "ICLR 2026 官方模板",
    description: "基于 ICLR 官方 Master-Template 仓库中的 iclr2026 模板目录镜像。",
    providerName: "ICLR/Master-Template",
    sourceUrl: "https://github.com/ICLR/Master-Template",
    archiveUrl: "https://codeload.github.com/ICLR/Master-Template/tar.gz/refs/heads/master",
    archiveType: "tar.gz",
    rootFile: "iclr2026_conference.tex",
    entries: [
      { sourcePath: "Master-Template-master/iclr2026/fancyhdr.sty", path: "fancyhdr.sty" },
      { sourcePath: "Master-Template-master/iclr2026/iclr2026_conference.bib", path: "iclr2026_conference.bib" },
      { sourcePath: "Master-Template-master/iclr2026/iclr2026_conference.bst", path: "iclr2026_conference.bst" },
      { sourcePath: "Master-Template-master/iclr2026/iclr2026_conference.sty", path: "iclr2026_conference.sty" },
      { sourcePath: "Master-Template-master/iclr2026/iclr2026_conference.tex", path: "iclr2026_conference.tex" },
      { sourcePath: "Master-Template-master/iclr2026/math_commands.tex", path: "math_commands.tex" },
      { sourcePath: "Master-Template-master/iclr2026/natbib.sty", path: "natbib.sty" },
    ],
    cacheKey: "iclr-master-template-2026",
    tags: ["official", "iclr", "submission", "ml"],
    recommendedFor: ["ICLR 投稿草稿", "ICLR 官方格式预演", "OpenReview 会议论文"],
    highlights: ["直接镜像官方 GitHub 仓库的 2026 目录", "保留官方数学命令与参考文献样式", "默认即可作为模板创建项目"],
  }),
  createArchiveTemplate({
    id: "aaai-2025-anonymous-template",
    title: "AAAI 2025 官方匿名投稿模板",
    description: "基于 AAAI 2025 官方 AuthorKit 中的匿名投稿 LaTeX 目录镜像。",
    providerName: "AAAI 2025 官方站点",
    sourceUrl: "https://aaai.org/authorkit25/",
    archiveUrl: "https://aaai.org/wp-content/uploads/2024/05/AuthorKit25.zip",
    archiveType: "zip",
    rootFile: "anonymous-submission-latex-2025.tex",
    entries: [
      { sourcePath: "AuthorKit25/AnonymousSubmission/LaTeX/aaai25.bst", path: "aaai25.bst" },
      { sourcePath: "AuthorKit25/AnonymousSubmission/LaTeX/aaai25.sty", path: "aaai25.sty" },
      { sourcePath: "AuthorKit25/AnonymousSubmission/LaTeX/anonymous-submission-latex-2025.tex", path: "anonymous-submission-latex-2025.tex" },
      { sourcePath: "AuthorKit25/AnonymousSubmission/LaTeX/aaai25.bib", path: "aaai25.bib" },
    ],
    cacheKey: "aaai-2025-anonymous-author-kit",
    tags: ["official", "aaai", "submission", "anonymous"],
    recommendedFor: ["AAAI 匿名投稿", "AAAI 官方格式预演", "人工智能会议论文"],
    highlights: ["直接镜像 AAAI 官方 AuthorKit", "移除二进制示例图依赖后保持可编译", "适合作为匿名稿起步模板"],
    patch: {
      kind: "aaai-anonymous-submission",
    },
  }),
  createArchiveTemplate({
    id: "aaai-2025-camera-ready-template",
    title: "AAAI 2025 官方终稿模板",
    description: "基于 AAAI 2025 官方 AuthorKit 中的 camera-ready LaTeX 目录镜像。",
    providerName: "AAAI 2025 官方站点",
    sourceUrl: "https://aaai.org/authorkit25/",
    archiveUrl: "https://aaai.org/wp-content/uploads/2024/05/AuthorKit25.zip",
    archiveType: "zip",
    rootFile: "Formatting-Instructions-LaTeX-2025.tex",
    entries: [
      { sourcePath: "AuthorKit25/CameraReady/LaTeX/Formatting-Instructions-LaTeX-2025.tex", path: "Formatting-Instructions-LaTeX-2025.tex" },
      { sourcePath: "AuthorKit25/CameraReady/LaTeX/aaai25.bst", path: "aaai25.bst" },
      { sourcePath: "AuthorKit25/CameraReady/LaTeX/aaai25.sty", path: "aaai25.sty" },
      { sourcePath: "AuthorKit25/CameraReady/LaTeX/aaai25.bib", path: "aaai25.bib" },
    ],
    cacheKey: "aaai-2025-camera-ready-author-kit",
    tags: ["official", "aaai", "camera-ready", "final"],
    recommendedFor: ["AAAI 终稿整理", "AAAI camera-ready 格式预演", "投稿后定稿排版"],
    highlights: ["与匿名稿共享同一份官方 AuthorKit 缓存", "适合作为 camera-ready 起步模板", "保持平台内直接创建与编辑体验"],
    patch: {
      kind: "aaai-camera-ready",
    },
  }),
  createAclFamilyTemplate({
    id: "acl-anthology-template",
    title: "ACL Anthology 官方模板",
    description: "基于 ACL 官方 style-files 仓库镜像，适合作为 ACL Anthology 系会议投稿起步模板。",
    venueLabel: "ACL",
  }),
  createAclFamilyTemplate({
    id: "emnlp-template",
    title: "EMNLP 官方模板",
    description: "复用 ACL 官方 style-files 仓库，适合作为 EMNLP 投稿与格式预演模板。",
    venueLabel: "EMNLP",
  }),
  createAclFamilyTemplate({
    id: "naacl-template",
    title: "NAACL 官方模板",
    description: "复用 ACL 官方 style-files 仓库，适合作为 NAACL 投稿与格式预演模板。",
    venueLabel: "NAACL",
  }),
  createArchiveTemplate({
    id: "eccv-2026-template",
    title: "ECCV 2026 官方模板",
    description: "基于 ECCV 2026 官方 paper-template 仓库镜像，保留官方主文档、样式与 LNCS 相关文件。",
    providerName: "paolo-favaro/paper-template",
    sourceUrl: "https://eccv.ecva.net/Conferences/2026/SubmissionPolicies",
    archiveUrl: "https://github.com/paolo-favaro/paper-template/archive/refs/tags/Latest.zip",
    archiveType: "zip",
    rootFile: "main.tex",
    entries: [
      { sourcePath: "paper-template-Latest/eccv.sty", path: "eccv.sty" },
      { sourcePath: "paper-template-Latest/eccvabbrv.sty", path: "eccvabbrv.sty" },
      { sourcePath: "paper-template-Latest/llncs.cls", path: "llncs.cls" },
      { sourcePath: "paper-template-Latest/main.bib", path: "main.bib" },
      { sourcePath: "paper-template-Latest/main.tex", path: "main.tex" },
      { sourcePath: "paper-template-Latest/splncs04.bst", path: "splncs04.bst" },
    ],
    cacheKey: "eccv-2026-paper-template",
    tags: ["official", "eccv", "cv", "submission", "springer"],
    recommendedFor: ["ECCV 投稿草稿", "ECCV 官方格式预演", "视觉会议论文"],
    highlights: ["直接镜像 ECCV 官网指向的官方模板仓库", "保留 ECCV 专用 sty 与 LNCS 组合", "示例二进制图已替换为文本占位以适配平台模板模型"],
    patch: {
      kind: "eccv-paper-template",
    },
  }),
  createArchiveTemplate({
    id: "aistats-2025-template",
    title: "AISTATS 2025 官方模板",
    description: "基于 AISTATS 2025 官网 paper pack 镜像，保留官方样式、示例论文和补充材料骨架。",
    providerName: "AISTATS 2025 官方站点",
    sourceUrl: "https://aistats.org/aistats2025/call-for-papers.html",
    archiveUrl: "https://aistats.org/aistats2025/AISTATS2025PaperPack.zip",
    archiveType: "zip",
    rootFile: "sample_paper.tex",
    entries: [
      { sourcePath: "AISTATS2025PaperPack/fancyhdr.sty", path: "fancyhdr.sty" },
      { sourcePath: "AISTATS2025PaperPack/sample_paper.tex", path: "sample_paper.tex" },
      { sourcePath: "AISTATS2025PaperPack/supplement.tex", path: "supplement.tex" },
      { sourcePath: "AISTATS2025PaperPack/aistats2025.sty", path: "aistats2025.sty" },
    ],
    cacheKey: "aistats-2025-paper-pack",
    tags: ["official", "aistats", "ml", "conference", "supplement"],
    recommendedFor: ["AISTATS 投稿草稿", "AISTATS 官方格式预演", "统计机器学习论文"],
    highlights: ["直接镜像 AISTATS 官网 paper pack", "同时保留主文稿与 supplement 骨架", "全部为文本文件，可直接创建项目编辑"],
  }),
  createArchiveTemplate({
    id: "colm-2026-template",
    title: "COLM 2026 官方模板",
    description: "基于 COLM 官方 GitHub release 模板镜像，保留官方样式、数学命令和参考文献骨架。",
    providerName: "COLM-org/Template",
    sourceUrl: "https://colmweb.org/AuthorGuide.html",
    archiveUrl: "https://github.com/COLM-org/Template/archive/refs/tags/2026.zip",
    archiveType: "zip",
    rootFile: "colm2026_conference.tex",
    entries: [
      { sourcePath: "Template-2026/colm2026_conference.bib", path: "colm2026_conference.bib" },
      { sourcePath: "Template-2026/colm2026_conference.bst", path: "colm2026_conference.bst" },
      { sourcePath: "Template-2026/colm2026_conference.sty", path: "colm2026_conference.sty" },
      { sourcePath: "Template-2026/colm2026_conference.tex", path: "colm2026_conference.tex" },
      { sourcePath: "Template-2026/fancyhdr.sty", path: "fancyhdr.sty" },
      { sourcePath: "Template-2026/math_commands.tex", path: "math_commands.tex" },
      { sourcePath: "Template-2026/natbib.sty", path: "natbib.sty" },
    ],
    cacheKey: "colm-2026-template",
    tags: ["official", "colm", "ml", "conference", "openreview"],
    recommendedFor: ["COLM 投稿草稿", "COLM 官方格式预演", "大模型会议论文"],
    highlights: ["直接镜像 COLM 官方 GitHub release", "保留官方 math commands 与 natbib 依赖", "已在本机真实编译通过"],
  }),
  createAcmVenueTemplate({
    id: "kdd-2025-template",
    title: "KDD 2025 官方 ACM 模板",
    description: "基于官方 acmart 类包的 KDD 会议模板，适合数据挖掘方向投稿草稿与格式预演。",
    venueLabel: "KDD",
    yearLabel: "2025",
    dateLabel: "2025",
    locationLabel: "TBD",
    recommendedFor: ["KDD 投稿草稿", "KDD 官方格式预演", "数据挖掘会议论文"],
  }),
  createAcmVenueTemplate({
    id: "www-2026-template",
    title: "TheWebConf 2026 官方 ACM 模板",
    description: "基于官方 acmart 类包的 TheWebConf 模板，对齐官网要求的 sigconf review 设定。",
    venueLabel: "TheWebConf",
    yearLabel: "2026",
    dateLabel: "2026",
    locationLabel: "TBD",
    recommendedFor: ["TheWebConf 投稿草稿", "WWW / WebConf 官方格式预演", "Web 会议论文"],
  }),
  createAcmVenueTemplate({
    id: "sigir-2025-template",
    title: "SIGIR 2025 官方 ACM 模板",
    description: "基于官方 acmart 类包的 SIGIR 模板，适合作为信息检索方向论文投稿骨架。",
    venueLabel: "SIGIR",
    yearLabel: "2025",
    dateLabel: "2025",
    locationLabel: "TBD",
    recommendedFor: ["SIGIR 投稿草稿", "SIGIR 官方格式预演", "信息检索会议论文"],
  }),
  createAcmVenueTemplate({
    id: "cikm-2025-template",
    title: "CIKM 2025 官方 ACM 模板",
    description: "基于官方 acmart 类包的 CIKM 模板，适合作为知识发现与信息管理方向投稿起步模板。",
    venueLabel: "CIKM",
    yearLabel: "2025",
    dateLabel: "2025",
    locationLabel: "TBD",
    recommendedFor: ["CIKM 投稿草稿", "CIKM 官方格式预演", "知识发现与信息管理会议论文"],
  }),
];

const templateCatalog = [...builtInTemplates, ...remoteOfficialTemplates];

function normalizeTemplate(template) {
  const files = Array.isArray(template.files) ? template.files.map(normalizeTemplateFile) : [];

  return {
    ...template,
    availability: "local",
    trustLabel: String(template.trustLabel ?? "平台维护"),
    providerName: template.providerName ? String(template.providerName) : null,
    sourceUrl: template.sourceUrl ? String(template.sourceUrl) : null,
    files,
    fileCountHint: Number(template.fileCountHint ?? files.length),
    remoteSource: template.remoteSource ?? null,
  };
}

function serializeTemplateSummary(template) {
  return {
    id: template.id,
    title: template.title,
    description: template.description,
    category: template.category,
    categoryLabel: template.categoryLabel,
    sourceType: template.sourceType,
    sourceLabel: template.sourceLabel,
    availability: template.availability,
    trustLabel: template.trustLabel,
    providerName: template.providerName,
    sourceUrl: template.sourceUrl,
    featured: template.featured,
    updatedAt: template.updatedAt,
    compileEngine: template.compileEngine,
    rootFile: template.rootFile,
    tags: [...template.tags],
    recommendedFor: [...template.recommendedFor],
    highlights: [...template.highlights],
    fileCount: template.fileCountHint,
  };
}

function serializeTemplateDetail(template) {
  return {
    ...serializeTemplateSummary(template),
    previewSnippet:
      createPreviewSnippet(
        template.files.find((file) => file.path === template.rootFile)?.content ?? template.files[0]?.content ?? "",
      ) || `${template.providerName ?? template.sourceLabel}\n\n${template.description}`,
    files: template.files.map((file) => ({
      path: file.path,
      preview: createPreviewSnippet(file.content, 12),
    })),
  };
}

function matchesTemplate(template, { query, category, sourceType }) {
  if (category && category !== "all" && template.category !== category) {
    return false;
  }

  if (sourceType && sourceType !== "all" && template.sourceType !== sourceType) {
    return false;
  }

  if (!query) {
    return true;
  }

  return buildSearchText(template).includes(query.toLowerCase());
}

function getTemplatePriorityScore(template) {
  const paperLikeCategories = new Set(["article", "conference", "thesis"]);

  if (template.sourceType === "official") {
    return 0;
  }

  if (paperLikeCategories.has(template.category)) {
    return 1;
  }

  if (template.category === "example") {
    return 3;
  }

  return 2;
}

export async function listTemplates({ query = "", category = "all", sourceType = "all", limit = 100 } = {}) {
  const normalizedTemplates = templateCatalog.map(normalizeTemplate);
  return normalizedTemplates
    .filter((template) => matchesTemplate(template, { query: query.trim(), category, sourceType }))
    .sort((left, right) => {
      const priorityDelta = getTemplatePriorityScore(left) - getTemplatePriorityScore(right);

      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      const featuredDelta = Number(right.featured) - Number(left.featured);

      if (featuredDelta !== 0) {
        return featuredDelta;
      }

      return left.title.localeCompare(right.title);
    })
    .slice(0, limit)
    .map(serializeTemplateSummary);
}

export async function searchTemplates(query, limit = 6) {
  return listTemplates({
    query,
    limit,
  });
}

export async function getTemplate(templateId) {
  const template = templateCatalog.map(normalizeTemplate).find((entry) => entry.id === templateId) ?? null;

  if (!template) {
    return null;
  }

  const resolvedFiles = await resolveTemplateFiles(template);
  const resolvedTemplate = {
    ...template,
    files: resolvedFiles,
    fileCountHint: resolvedFiles.length || template.fileCountHint,
  };

  return {
    ...serializeTemplateDetail(resolvedTemplate),
    files: resolvedTemplate.files.map((file) => ({
      path: file.path,
      content: file.content,
      preview: createPreviewSnippet(file.content, 12),
    })),
  };
}

/*
 * Code Review:
 * - 当前模板目录同时承载“内置模板”和“官方模板镜像”，但对上层仍保持统一的模板摘要/详情接口。
 * - 模板详情同时返回文件清单与预览片段，避免前端复制同样的推导逻辑。
 * - 远端官方模板先拉取到本地缓存后再交给项目创建链路，继续满足“探索页内模板必须可直接编辑”的产品约束。
 */
