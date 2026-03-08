/*
 * File: papers.js
 * Module: packages/runtime-store (项目论文库仓储)
 *
 * Responsibility:
 *   - 持久化“项目内已导入论文”的元数据与 BibTeX 信息。
 *   - 为前端论文检索/阅读面板和项目引用导入提供单一真相来源。
 *
 * Runtime Logic Overview:
 *   1. API 在导入论文后将记录写入本仓储。
 *   2. 前端进入项目时读取当前项目的论文库列表。
 *   3. 若再次导入同一论文，则按项目 + 论文 ID 做幂等更新。
 *
 * Dependencies:
 *   - node:path
 *   - packages/runtime-store/storage/metadata-store
 *   - packages/shared/paper-refs
 *   - packages/shared/paths
 *
 * Last Updated:
 *   - 2026-03-08 by Codex - 升级为多源论文记录并补齐原子写入
 */

import path from "node:path";
import { getPaperSourceLabel, normalizePaperReference, splitPaperReference } from "../../shared/src/paper-refs.js";
import { runtimeDataRoot } from "../../shared/src/paths.js";
import { ensureMetadataStorage, getMetadataStore } from "./storage/metadata-store.js";

const papersManifestPath = path.join(runtimeDataRoot, "papers.json");
const papersNamespace = "papers";

function normalizePaperRecord(record) {
  const identity = splitPaperReference(record.paperId ?? record.sourceId ?? "");

  return {
    projectId: record.projectId,
    paperId: identity.paperId,
    source: String(record.source ?? identity.source),
    sourceLabel: String(record.sourceLabel ?? getPaperSourceLabel(record.source ?? identity.source)),
    sourceId: String(record.sourceId ?? identity.sourceId),
    title: String(record.title ?? "Untitled"),
    authors: Array.isArray(record.authors) ? record.authors.map((item) => String(item)) : [],
    published: record.published ? String(record.published) : null,
    summary: String(record.summary ?? ""),
    entryId: record.entryId ? String(record.entryId) : null,
    abstractUrl: record.abstractUrl ? String(record.abstractUrl) : null,
    pdfUrl: record.pdfUrl ? String(record.pdfUrl) : null,
    doi: record.doi ? String(record.doi) : null,
    venue: record.venue ? String(record.venue) : null,
    fullTextAvailable: Boolean(record.fullTextAvailable ?? record.pdfUrl),
    accessStatus: String(record.accessStatus ?? (record.pdfUrl ? "pdf" : "abstract_only")),
    bibtex: String(record.bibtex ?? ""),
    bibtexKey: String(record.bibtexKey ?? ""),
    bibFilePath: String(record.bibFilePath ?? "refs.bib"),
    importedBy: record.importedBy ? String(record.importedBy) : null,
    importedAt: record.importedAt ?? new Date().toISOString(),
    updatedAt: record.updatedAt ?? new Date().toISOString(),
  };
}

async function readPapersManifest() {
  const store = await getMetadataStore();
  const records = await store.readManifest({
    namespace: papersNamespace,
    filePath: papersManifestPath,
    fallbackValue: [],
  });

  return records.map(normalizePaperRecord);
}

async function writePapersManifest(records) {
  const store = await getMetadataStore();
  await store.writeManifest({
    namespace: papersNamespace,
    filePath: papersManifestPath,
    value: records.map(normalizePaperRecord),
  });
}

async function patchPapersManifestAtomically(transform, fallbackValue = []) {
  const store = await getMetadataStore();
  const result = await store.patchRecordAtomically({
    namespace: papersNamespace,
    key: "__manifest__",
    filePath: papersManifestPath,
    fallbackValue,
    transform(currentRecords) {
      const normalizedRecords = Array.isArray(currentRecords) ? currentRecords.map(normalizePaperRecord) : [];
      const nextRecords = transform(normalizedRecords);

      if (nextRecords === undefined) {
        return undefined;
      }

      return nextRecords.map(normalizePaperRecord);
    },
  });

  return Array.isArray(result.value) ? result.value.map(normalizePaperRecord) : [];
}

export async function ensurePaperStorage() {
  await ensureMetadataStorage();
  const store = await getMetadataStore();
  const existing = await store.readManifest({
    namespace: papersNamespace,
    filePath: papersManifestPath,
    fallbackValue: null,
  });

  if (!existing) {
    await writePapersManifest([]);
  }
}

export async function listProjectPapers(projectId) {
  await ensurePaperStorage();
  const records = await readPapersManifest();
  return records
    .filter((record) => record.projectId === projectId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function getProjectPaper(projectId, paperId) {
  const records = await listProjectPapers(projectId);
  const normalizedPaperId = normalizePaperReference(paperId);
  const legacyPaperId = splitPaperReference(paperId).legacyId;
  return records.find((record) => record.paperId === normalizedPaperId || record.paperId === legacyPaperId) ?? null;
}

export async function upsertProjectPaper(projectId, paperRecord) {
  await ensurePaperStorage();
  const normalized = normalizePaperRecord({
    ...paperRecord,
    projectId,
    updatedAt: new Date().toISOString(),
    importedAt: paperRecord.importedAt ?? new Date().toISOString(),
  });

  await patchPapersManifestAtomically((records) =>
    records.some((record) => record.projectId === projectId && record.paperId === normalized.paperId)
      ? records.map((record) =>
          record.projectId === projectId && record.paperId === normalized.paperId ? normalized : record,
        )
      : [...records, normalized],
  );
  return normalized;
}

/*
 * Code Review:
 * - 论文记录已升级为多源统一结构，`paperId` 不再等同于某个站点的裸 ID，避免 `Semantic Scholar / PubMed` 接入后继续用单源假设污染仓储。
 * - 写入已切到原子 patch，避免多人同时导入论文时覆盖彼此的项目文献库清单。
 * - BibTeX 与论文元数据一起持久化，避免 API 每次展示项目文献库都重新请求远端；后续若补阅读状态等字段，也应继续收敛在本模块。
 */
