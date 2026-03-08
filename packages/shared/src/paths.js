/*
 * File: paths.js
 * Module: packages/shared (路径工具)
 *
 * Responsibility:
 *   - 统一管理仓库根目录、运行时目录、静态资源目录等核心路径。
 *   - 避免 API、Worker 和持久层重复拼接路径导致路径规则分叉。
 *
 * Runtime Logic Overview:
 *   1. 运行时模块通过本文件获取 `.runtime`、项目目录和任务目录位置。
 *   2. API 服务通过本文件定位静态前端目录并托管 Web 资源。
 *   3. Worker 通过本文件定位编译工作目录和输出目录。
 *
 * Key Data Flow:
 *   - 输入：模块所在路径。
 *   - 输出：根目录、静态目录、运行时目录及若干路径推导函数。
 *
 * Future Extension:
 *   - 可继续添加对象存储、本地缓存等路径映射。
 *   - 未来若切换为容器部署，可在此集中处理挂载目录约束。
 *
 * Dependencies:
 *   - node:path
 *   - node:url
 *
 * Last Updated:
 *   - 2026-03-08 by Codex - 新增模板镜像缓存路径
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);

export const repositoryRoot = path.resolve(currentDir, "../../..");
export const runtimeRoot = path.join(repositoryRoot, ".runtime");
export const runtimeDataRoot = path.join(runtimeRoot, "data");
export const runtimeJobsRoot = path.join(runtimeDataRoot, "jobs");
export const runtimeProjectsRoot = path.join(runtimeRoot, "projects");
export const runtimeCompileRoot = path.join(runtimeRoot, "compile");
export const runtimeCompileCacheRoot = path.join(runtimeRoot, "compile-cache");
export const runtimeCollaborationRoot = path.join(runtimeRoot, "collaboration");
export const runtimeSnapshotsRoot = path.join(runtimeRoot, "snapshots");
export const runtimeSnapshotArchivesRoot = path.join(runtimeSnapshotsRoot, "archives");
export const runtimeSnapshotMetadataRoot = path.join(runtimeSnapshotsRoot, "metadata");
export const runtimePapersRoot = path.join(runtimeRoot, "papers");
export const runtimePaperPdfCacheRoot = path.join(runtimePapersRoot, "pdf-cache");
export const runtimeTemplateCacheRoot = path.join(runtimeRoot, "template-cache");
export const webStaticRoot = path.join(repositoryRoot, "apps", "web", "dist");

export function getProjectRoot(projectId) {
  return path.join(runtimeProjectsRoot, projectId);
}

export function getJobFilePath(jobId) {
  return path.join(runtimeJobsRoot, `${jobId}.json`);
}

export function getCompileJobRoot(jobId) {
  return path.join(runtimeCompileRoot, jobId);
}

export function getCompileCacheRoot(cacheKey) {
  return path.join(runtimeCompileCacheRoot, cacheKey);
}

export function getCompileCachePdfPath(cacheKey) {
  return path.join(getCompileCacheRoot(cacheKey), "output.pdf");
}

export function getCompileCacheLogPath(cacheKey) {
  return path.join(getCompileCacheRoot(cacheKey), "compile.log");
}

export function getCollaborationProjectRoot(projectId) {
  return path.join(runtimeCollaborationRoot, projectId);
}

export function getCollaborationFileStatePath(projectId, fileId) {
  return path.join(getCollaborationProjectRoot(projectId), `${fileId}.yjs`);
}

export function getSnapshotArchivePath(projectId, snapshotId) {
  return path.join(runtimeSnapshotArchivesRoot, projectId, `${snapshotId}.tar.gz`);
}

export function getSnapshotMetadataPath(projectId) {
  return path.join(runtimeSnapshotMetadataRoot, `${projectId}.json`);
}

export function getPaperPdfCachePath(paperId) {
  return path.join(runtimePaperPdfCacheRoot, `${encodeURIComponent(paperId)}.pdf`);
}

export function getTemplateCachePath(templateId) {
  return path.join(runtimeTemplateCacheRoot, `${encodeURIComponent(templateId)}.json`);
}

/*
 * Code Review:
 * - 所有关键路径都集中在这里，后续替换运行时目录结构时不会影响上层业务逻辑。
 * - 当前实现默认仓库本地运行，若切换部署模式，应优先扩展本文件而不是散落修改调用方。
 * - 该文件不执行文件系统写入，保持为纯路径推导工具。
 * - 论文 PDF 缓存路径也在此统一定义，避免 API 与论文服务对缓存布局各自维护一套规则。
 * - 模板镜像缓存路径同样收敛在这里，后续若切换对象存储或远端缓存，可只改这一层。
 */
