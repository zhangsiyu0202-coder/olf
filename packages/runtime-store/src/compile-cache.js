/*
 * File: compile-cache.js
 * Module: packages/runtime-store (编译缓存仓储)
 *
 * Responsibility:
 *   - 为编译 Worker 提供基于项目内容哈希的 PDF 与日志缓存。
 *   - 将缓存索引和缓存产物路径统一收敛到仓储层，避免 Worker 自己拼缓存文件布局。
 *
 * Runtime Logic Overview:
 *   1. Worker 根据项目内容摘要、根文件和编译引擎生成 cache key。
 *   2. 命中时直接复用缓存 PDF 和日志，跳过实际编译。
 *   3. 未命中时在编译成功后写入缓存索引和缓存产物。
 *
 * Dependencies:
 *   - node:crypto
 *   - packages/runtime-store/storage/metadata-store
 *   - packages/runtime-store/storage/blob-store
 *   - packages/shared/paths
 *
 * Last Updated:
 *   - 2026-03-08 by Codex - 初始化编译缓存仓储
 */

import crypto from "node:crypto";
import {
  getCompileCacheLogPath,
  getCompileCachePdfPath,
  runtimeCompileCacheRoot,
} from "../../shared/src/paths.js";
import {
  blobExists,
  ensureBlobDirectory,
  readTextBlob,
  writeTextBlob,
} from "./storage/blob-store.js";
import { ensureMetadataStorage, getMetadataStore } from "./storage/metadata-store.js";

const compileCacheNamespace = "compile-cache";

function getCompileCacheManifestPath(cacheKey) {
  return `${runtimeCompileCacheRoot}/${cacheKey}.json`;
}

export function buildCompileCacheKey({ contentHash, compileEngine, rootFile }) {
  return crypto
    .createHash("sha256")
    .update(`${contentHash}:${compileEngine}:${rootFile}`)
    .digest("hex");
}

export async function ensureCompileCacheStorage() {
  await ensureMetadataStorage();
  await ensureBlobDirectory(runtimeCompileCacheRoot);
}

export async function getCompileCacheEntry(cacheKey) {
  const store = await getMetadataStore();
  const entry = await store.readRecord({
    namespace: compileCacheNamespace,
    key: cacheKey,
    filePath: getCompileCacheManifestPath(cacheKey),
    fallbackValue: null,
  });

  if (!entry) {
    return null;
  }

  const pdfExists = await blobExists(entry.pdfPath);

  if (!pdfExists) {
    return null;
  }

  return entry;
}

export async function writeCompileCacheEntry(cacheKey, payload) {
  await ensureCompileCacheStorage();
  const store = await getMetadataStore();
  const entry = {
    cacheKey,
    contentHash: payload.contentHash,
    rootFile: payload.rootFile,
    compileEngine: payload.compileEngine,
    createdAt: payload.createdAt ?? new Date().toISOString(),
    pdfPath: payload.pdfPath ?? getCompileCachePdfPath(cacheKey),
    logPath: payload.logPath ?? getCompileCacheLogPath(cacheKey),
    diagnostics: payload.diagnostics ?? [],
  };

  await store.writeRecord({
    namespace: compileCacheNamespace,
    key: cacheKey,
    filePath: getCompileCacheManifestPath(cacheKey),
    value: entry,
  });

  if (payload.log !== undefined) {
    await writeTextBlob(entry.logPath, payload.log);
  }

  return entry;
}

export async function readCompileCacheLog(cacheEntry) {
  if (!(await blobExists(cacheEntry.logPath))) {
    return "";
  }

  return readTextBlob(cacheEntry.logPath);
}

/*
 * Code Review:
 * - 编译缓存当前只缓存“输入摘要 -> PDF/日志/诊断”，不尝试复用中间 aux 文件，先保证缓存命中行为可靠可解释。
 * - cache key 只依赖内容哈希、根文件和引擎，避免把项目 ID 之类与编译结果无关的维度掺进去。
 * - 缓存命中仍然通过统一 job 状态回写，对前端来说与真实编译成功没有额外协议分叉。
 */
